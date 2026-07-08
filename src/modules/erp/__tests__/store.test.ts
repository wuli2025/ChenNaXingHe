/**
 * 星河无头ERP store 单元测试 —— 聚焦四条主线：
 *  1) 动作策略引擎 decide()：自动/审批分流 + 强制人工清单红线
 *  2) 保本硬底线：低于红线价的调价被核心层钳制，AI/人工都绕不过
 *  3) 核准即执行：14 种审批 kind 的确定性回写
 *  4) 驳回带批注自动重跑 + 响应式落盘
 * agent runner 被 mock，逻辑可确定性验证。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { nextTick } from "vue";

/* ── mock useAgentRunner ── */
const h = vi.hoisted(() => ({
  runResult: { value: "MOCK-TEXT" },
  runJsonResult: { value: {} as Record<string, unknown> },
  calls: [] as { fn: "run" | "runJson"; prompt: string }[],
}));

vi.mock("../../../composables/useAgentRunner", () => ({
  useAgentRunner: () => ({
    running: { value: false },
    run: async (opts: { prompt: string }) => {
      h.calls.push({ fn: "run", prompt: opts.prompt });
      return { raw: h.runResult.value };
    },
    runJson: async (opts: { prompt: string }) => {
      h.calls.push({ fn: "runJson", prompt: opts.prompt });
      return { data: h.runJsonResult.value, raw: JSON.stringify(h.runJsonResult.value) };
    },
  }),
}));

type Store = Awaited<ReturnType<typeof freshStore>>;

async function freshStore() {
  vi.resetModules();
  localStorage.clear();
  h.calls.length = 0;
  const mod = await import("../useErpStore");
  return mod.useErpStore();
}

function findTask(store: any, kind: string, status = "pending") {
  return store.reviewTasks.value.find((t: any) => t.kind === kind && t.status === status);
}

describe("初始化与派生", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("首次加载铺入 6 张种子审批卡片（含 2 张强制人工硬闸）", () => {
    expect(store.reviewTasks.value.length).toBe(6);
    const hard = store.reviewTasks.value.filter((t: any) => t.hardGate);
    expect(hard.length).toBe(2);
    expect(hard.some((t: any) => t.kind === "po-payment")).toBe(true);
    expect(hard.some((t: any) => t.kind === "export-rebate")).toBe(true);
  });

  it("驾驶舱 KPI 从真实状态派生（待审批数与流水线一致）", () => {
    const k = store.dashKpi.value.find((x: any) => x.l === "待你审批");
    expect(k?.v).toBe(String(store.pendingCount.value));
  });

  it("初始无人化率为 0", () => {
    expect(store.autonomyStats.value.total).toBe(0);
    expect(store.autonomyStats.value.autoRate).toBe(0);
  });

  it("种子审批卡片首载即落盘（防「看一眼就关」永久丢失）", () => {
    const raw = localStorage.getItem("cnxh.erp.reviews.v1");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).length).toBe(6);
  });
});

describe("策略引擎 decide() · 有界自治", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("强制人工清单（付款/报税/退税）无条件 review+hardGate", () => {
    for (const kind of ["po-payment", "tax-filing", "export-rebate"] as const) {
      const d = store.decide(kind, { amountUsd: 0.01 });
      expect(d.mode).toBe("review");
      expect(d.hardGate).toBe(true);
    }
  });

  it("金额超过 autoAmountCapUsd → review（通用上限，适用于无专属阈值的 kind）", () => {
    expect(store.decide("claim-send", { amountUsd: 10 }).mode).toBe("auto");
    expect(store.decide("claim-send", { amountUsd: 999 }).mode).toBe("review");
  });

  it("logistics-channel 用专属高值阈值（$800），不被通用 $500 上限短路", () => {
    // 600 在通用上限之上、高值阈值之下 —— 专属规则先判，应自动
    expect(store.decide("logistics-channel", { amountUsd: 600 }).mode).toBe("auto");
    expect(store.decide("logistics-channel", { amountUsd: 850 }).mode).toBe("review");
  });

  it("退款分流：≤上限自动 / 超限审批", () => {
    expect(store.decide("order-refund", { amountUsd: 30 }).mode).toBe("auto");
    expect(store.decide("order-refund", { amountUsd: 120 }).mode).toBe("review");
  });

  it("调价带宽：±8% 内自动 / 超幅审批", () => {
    expect(store.decide("price-change", { pct: 5 }).mode).toBe("auto");
    expect(store.decide("price-change", { pct: -12 }).mode).toBe("review");
  });

  it("OCR 分流：置信/金额双闸", () => {
    expect(store.decide("ocr-book", { conf: 99, amountCny: 100 }).mode).toBe("auto");
    expect(store.decide("ocr-book", { conf: 90, amountCny: 100 }).mode).toBe("review");
    expect(store.decide("ocr-book", { conf: 99, amountCny: 99999 }).mode).toBe("review");
  });
});

describe("定价 · 保本硬底线（AI 无法绕过）", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("带宽内且高于底线 → 自动生效并留 auto 台账", () => {
    const card = store.prices.value.find((c: any) => c.sku === "P-002" && c.platform === "Amazon US");
    const r = store.proposePriceChange("P-002", "Amazon US", 15.49, "竞品微降跟随");
    expect(r).toBe("auto");
    expect(card.currentUsd).toBe(15.49);
    const act = store.executedActions.value.find((a: any) => a.kind === "price-change");
    expect(act?.by).toBe("auto");
  });

  it("低于保本底线的拟价 → 硬闸审批；批准后仍被钳制到底线之上", () => {
    const card = store.prices.value.find((c: any) => c.sku === "P-002" && c.platform === "Amazon US");
    const floor = store.floorPrice(card);
    const r = store.proposePriceChange("P-002", "Amazon US", 5, "清仓甩卖");
    expect(r).toBe("review");
    const t = findTask(store, "price-change");
    expect(t.hardGate).toBe(true);
    store.approveReview(t.id, "同意清仓");
    // 核心层钳制：即使人工批准 $5，最终价也不低于红线价
    expect(card.currentUsd).toBeGreaterThanOrEqual(Math.floor(floor * 100) / 100);
    expect(card.currentUsd).toBeGreaterThan(5);
    expect(card.lastChange.reason).toContain("钳制");
  });

  it("超幅但高于底线 → 普通审批，批准后按拟价生效", () => {
    const card = store.prices.value.find((c: any) => c.sku === "P-001" && c.platform === "Amazon US");
    const r = store.proposePriceChange("P-001", "Amazon US", 21.99, "大促压价"); // −15.4% 超带宽
    expect(r).toBe("review");
    const t = findTask(store, "price-change");
    expect(t.hardGate).toBeFalsy();
    store.approveReview(t.id);
    expect(card.currentUsd).toBe(21.99);
  });

  it("AI 置信不足 80 → 即使带宽内也转审批", () => {
    const r = store.proposePriceChange("P-002", "Amazon US", 15.49, "低置信提案", 60);
    expect(r).toBe("review");
  });

  it("重复入闸 → 刷新为最新提案，批准执行的是新 payload", () => {
    store.proposePriceChange("P-001", "Amazon US", 21.99, "第一轮提案"); // 超带宽 → review
    store.proposePriceChange("P-001", "Amazon US", 23.49, "第二轮提案"); // 同对象再入闸
    const tasks = store.reviewTasks.value.filter((t: any) => t.kind === "price-change" && t.status === "pending");
    expect(tasks.length).toBe(1); // 不产生第二张卡
    store.approveReview(tasks[0].id);
    const card = store.prices.value.find((c: any) => c.sku === "P-001" && c.platform === "Amazon US");
    expect(card.currentUsd).toBe(23.49); // 执行的是最新提案，不是旧 $21.99
  });
});

describe("票据 OCR · 置信分流 + 查重拦截", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("高置信小额票据 → 自动入账 + 凭证生成 + auto 台账", () => {
    const beforeJ = store.journal.value.length;
    const doc = store.intakeDoc({
      type: "receipt", party: "顺丰同城", no: "SF-TEST-1", date: "2026-07-07",
      amount: 88, currency: "CNY", conf: 99, lowFields: [],
    });
    expect(doc.booked).toBe(true);
    expect(store.journal.value.length).toBe(beforeJ + 1);
    expect(store.executedActions.value.find((a: any) => a.kind === "ocr-book")?.by).toBe("auto");
  });

  it("低置信票据 → 进入账确认闸，批准后才入账", () => {
    const doc = store.intakeDoc({
      type: "logistics-bill", party: "云途物流", no: "YT-TEST-2", date: "2026-07-07",
      amount: 300, currency: "CNY", conf: 80, lowFields: ["金额"],
    });
    expect(doc.booked).toBe(false);
    const t = store.reviewTasks.value.find((x: any) => x.kind === "ocr-book" && x.refId === doc.id);
    expect(t).toBeTruthy();
    store.approveReview(t.id);
    expect(doc.booked).toBe(true);
  });

  it("重复票号 → 查重标记 dup 并拦截，不自动入账", () => {
    const doc = store.intakeDoc({
      type: "vat-invoice", party: "佛山市顺德区宠悦电器", no: "044002400111", date: "2026-07-07",
      amount: 100, currency: "CNY", conf: 99, lowFields: [],
    });
    expect(doc.dupCheck).toBe("dup");
    expect(doc.booked).toBe(false);
  });
});

describe("核准即执行 · 回写正确性", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("po-payment（强制人工）批准 → PO 置已付", () => {
    const t = findTask(store, "po-payment");
    store.approveReview(t.id);
    const po = store.pos.value.find((x: any) => x.id === "PO-2407");
    expect(po.status).toBe("paid");
    expect(store.executedActions.value.find((a: any) => a.kind === "po-payment")?.by).toBe("human");
  });

  it("export-rebate（强制人工）批准 → 申报置已提交", () => {
    const t = findTask(store, "export-rebate");
    store.approveReview(t.id);
    const f = store.filings.value.find((x: any) => x.id === "F-63");
    expect(f.status).toBe("submitted");
  });

  it("listing-publish 批准 → 应用 payload 并上线", () => {
    const t = findTask(store, "listing-publish");
    t.payload = { ...t.payload, title: "NEW TITLE", bullets: ["a", "b"], keywords: "kw" };
    store.approveReview(t.id);
    const l = store.listings.value.find((x: any) => x.id === "L-103");
    expect(l.status).toBe("live");
    expect(l.title).toBe("NEW TITLE");
  });

  it("month-close 批准 → 月度锁账", () => {
    const t = findTask(store, "month-close");
    store.approveReview(t.id);
    const rep = store.reports.value.find((x: any) => x.month === "2026-06");
    expect(rep.closed).toBe(true);
  });

  it("replenish-po 批准 → 生成 PO + 自动入付款强制人工闸（链路接通）", () => {
    const beforePos = store.pos.value.length;
    store.enqueueReview({
      mod: "e6", kind: "replenish-po", title: "补货 PO 确认 · 测试", refId: "P-002", origin: "ai",
      summary: "x", facts: [], risk: "high",
      payload: { sku: "P-002", goods: "猫胸背带", qty: 1000, unitCny: 16.5, supplier: "义乌恒达" },
    });
    const t = findTask(store, "replenish-po");
    store.approveReview(t.id);
    expect(store.pos.value.length).toBe(beforePos + 1);
    const newPo = store.pos.value[0];
    expect(newPo.status).toBe("pending_pay");
    expect(newPo.amountCny).toBe(16500);
    // 付款闸自动入列且是硬闸
    const pay = store.reviewTasks.value.find((x: any) => x.kind === "po-payment" && x.refId === newPo.id);
    expect(pay).toBeTruthy();
    expect(pay.hardGate).toBe(true);
  });

  it("recon-open 批准 → 账项回写已匹配", () => {
    const t = findTask(store, "recon-open");
    store.approveReview(t.id);
    const r = store.recon.value.find((x: any) => x.id === "R-22");
    expect(r.status).toBe("已匹配");
  });

  it("费用挂账类对账 → 凭证带真实解析金额（非 0）", () => {
    store.enqueueReview({
      mod: "e7", kind: "recon-open", title: "汇差挂账", refId: "R-23", origin: "ai",
      summary: "x", facts: [], risk: "normal", payload: { reconId: "R-23" },
    });
    const t = store.reviewTasks.value.find((x: any) => x.kind === "recon-open" && x.refId === "R-23");
    store.approveReview(t.id);
    const j = store.journal.value.find((x: any) => x.summary.includes("汇差"));
    expect(j.amountCny).toBeCloseTo(1285.10, 2);
  });

  it("已批准的卡片不可重开（防副作用双重执行）", () => {
    const t = findTask(store, "month-close");
    store.approveReview(t.id);
    store.resetReview(t.id);
    expect(t.status).toBe("approved"); // 保持不变
    // 已驳回的可以重开
    const t2 = findTask(store, "recon-open");
    store.rejectReview(t2.id, "候选不对");
    store.resetReview(t2.id);
    expect(t2.status).toBe("pending");
  });

  it("EUR 票据的策略闸与记账用同一汇率口径（闸不被绕过）", () => {
    // EUR 660 折 CNY ≈ 660×7.12×1.08 = 5,075 > 上限 5,000 → 必须进闸，不得自动入账
    const doc = store.intakeDoc({
      type: "vat-invoice", party: "DE Supplier GmbH", no: "DE-EUR-1", date: "2026-07-07",
      amount: 660, currency: "EUR", conf: 99, lowFields: [],
    });
    expect(doc.booked).toBe(false);
    expect(store.reviewTasks.value.some((x: any) => x.kind === "ocr-book" && x.refId === doc.id)).toBe(true);
  });

  it("风控放行走台账（人工决策可追溯）", () => {
    expect(store.releaseRiskOrder("TM-4471")).toBe(true);
    const o = store.orders.value.find((x: any) => x.id === "TM-4471");
    expect(o.status).toBe("pending");
    expect(store.executedActions.value.some((a: any) => a.kind === "risk-release" && a.by === "human")).toBe(true);
    // 非 risk_hold 单不可重复放行
    expect(store.releaseRiskOrder("TM-4471")).toBe(false);
  });
});

describe("售后 · 退款分流", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("阈值内退款自动执行并关单", () => {
    const r = store.proposeAfterSale("AS-31"); // $32.99 < $40
    expect(r).toBe("auto");
    const as = store.afterSales.value.find((x: any) => x.id === "AS-31");
    expect(as.status).toBe("done");
    const o = store.orders.value.find((x: any) => x.id === "112-655");
    expect(o.status).toBe("closed");
  });

  it("超阈值退款 → 进审批闸；驳回后订单不卡死在退款中", () => {
    const o = store.orders.value.find((x: any) => x.id === "112-655"); // seed 即 refunding
    store.afterSales.value.unshift({
      id: "AS-99", orderId: "112-655", type: "refund", reason: "整单退货", amountUsd: 120, status: "open",
    });
    const r = store.proposeAfterSale("AS-99");
    expect(r).toBe("review");
    const t = store.reviewTasks.value.find((x: any) => x.kind === "order-refund" && x.refId === "AS-99");
    expect(t).toBeTruthy();
    store.rejectReview(t.id, "凭证不足，先补发");
    expect(o.status).toBe("delivered"); // 退款不做 → 回到已妥投，不再是 refunding
  });
});

describe("参数校验 · 非法值被核心层拒绝", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("0 / 负数 / NaN 一律 invalid 且不生效（防汇率清零爆 Infinity）", () => {
    expect(store.setParam("usdCny", 0)).toBe("invalid");
    expect(store.setParam("usdCny", -3)).toBe("invalid");
    expect(store.setParam("usdCny", NaN)).toBe("invalid");
    expect(store.params.value.usdCny).toBe(7.12);
  });

  it("localStorage 参数投毒被加载入口拦截（C08-P1-02 加固）", async () => {
    // 直接往 localStorage 塞越界/非法值，模拟绕过 UI 的投毒
    localStorage.setItem("cnxh.erp.params.v1", JSON.stringify({
      autoRefundCapUsd: 9_999_999,   // 想放宽退款自动执行
      usdCny: 0,                      // 想制造除零
      ocrAutoBookConf: -1,            // 想让所有票据自动入账
      priceAutoBandPct: "hack",       // 非数
      evilKey: 123,                   // 白名单外的键
    }));
    const s2 = await freshStore();
    // 越界/非法全部回落默认值，未知键被丢弃
    expect(s2.params.value.autoRefundCapUsd).toBe(40);
    expect(s2.params.value.usdCny).toBe(7.12);
    expect(s2.params.value.ocrAutoBookConf).toBe(98);
    expect(s2.params.value.priceAutoBandPct).toBe(8);
    expect((s2.params.value as Record<string, unknown>).evilKey).toBeUndefined();
  });
});

describe("参数中心 · 宪法级参数走审批", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("普通参数直接生效并记版本", () => {
    const r = store.setParam("safetyStockDays", 25);
    expect(r).toBe("applied");
    expect(store.params.value.safetyStockDays).toBe(25);
    expect(store.paramLog.value[0].key).toBe("safetyStockDays");
  });

  it("红线参数 → 审批，批准后才生效", () => {
    const r = store.setParam("autoRefundCapUsd", 200);
    expect(r).toBe("review");
    expect(store.params.value.autoRefundCapUsd).toBe(40); // 未生效
    const t = findTask(store, "param-change");
    store.approveReview(t.id);
    expect(store.params.value.autoRefundCapUsd).toBe(200);
  });

  it("改了参数也改不掉强制人工：付款依旧 hardGate", () => {
    store.setParam("safetyStockDays", 25);
    const d = store.decide("po-payment", { amountUsd: 1 });
    expect(d.hardGate).toBe(true);
  });
});

describe("AI 动作 · 驳回带批注自动重跑", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("listing-publish 驳回 → 自动重跑且批注拼进 prompt", async () => {
    const t = findTask(store, "listing-publish");
    h.runJsonResult.value = { title: "T2", bullets: ["1"], keywords: "k", rationale: "改进" };
    const callsBefore = h.calls.length;
    store.rejectReview(t.id, "标题太长，重写");
    await new Promise((r) => setTimeout(r, 0));
    expect(h.calls.length).toBeGreaterThan(callsBefore);
    expect(h.calls[h.calls.length - 1].prompt).toContain("标题太长");
    expect(t.reran).toBe(true);
  });

  it("非重跑类（po-payment）驳回不触发 AI", async () => {
    const t = findTask(store, "po-payment");
    const callsBefore = h.calls.length;
    store.rejectReview(t.id, "缓付");
    await new Promise((r) => setTimeout(r, 0));
    expect(h.calls.length).toBe(callsBefore);
  });
});

describe("持久化", () => {
  it("mutate 业务 ref → watch 自动写 localStorage", async () => {
    const store = await freshStore();
    store.products.value.unshift({
      id: "P-TEST", name: "自动落盘测试品", nameEn: "AutoPersist", category: "测试",
      state: "candidate", costCny: 10, shipUsd: 1, priceUsd: 9.99, rivalUsd: 10,
      monthlySales: 0, marginPct: 20, score: 60, reason: "x", provenance: "user", platforms: [],
    });
    await nextTick();
    const raw = localStorage.getItem("cnxh.erp.products.v1");
    expect(raw).toContain("自动落盘测试品");
  });

  it("resetAll 清空并重载种子", async () => {
    const store = await freshStore();
    store.products.value.unshift({ id: "X" } as any);
    store.resetAll();
    expect(store.products.value.some((p: any) => p.id === "X")).toBe(false);
    expect(store.products.value.length).toBeGreaterThan(0);
  });
});
