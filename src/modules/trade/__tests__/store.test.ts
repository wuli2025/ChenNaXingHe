/**
 * 外贸 OS store 单元测试 —— 聚焦 P0「核准即执行」的回写正确性、链路接通、
 * 驳回自动重跑、派生数据、响应式落盘。agent runner 被 mock，逻辑可确定性验证。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { nextTick } from "vue";

/* ── mock useAgentRunner：run 返回文本，runJson 返回可控 data ── */
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
  const mod = await import("../useTradeStore");
  return mod.useTradeStore();
}

/** 取某状态下某 kind 的第一个任务 id。 */
function findTask(store: any, kind: string, status = "pending") {
  return store.reviewTasks.value.find((t: any) => t.kind === kind && t.status === status);
}

describe("外贸 OS store · 初始化与派生", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("首次加载铺入 6 个种子审核任务（含 2 硬闸）", () => {
    expect(store.reviewTasks.value.length).toBe(6);
    const hard = store.reviewTasks.value.filter((t: any) => t.hardGate);
    expect(hard.length).toBe(2);
  });

  it("驾驶舱 KPI 从真实状态派生（待处理硬闸=2）", () => {
    const hardKpi = store.dashKpi.value.find((k: any) => k.l === "待处理硬闸");
    expect(hardKpi?.v).toBe("2");
    expect(store.pendingHardGates.value.length).toBe(2);
  });

  it("流水线在库批次与 stock 长度一致", () => {
    const node = store.pipeline.value.find((p: any) => p.l === "在库批次");
    expect(node?.c).toBe(String(store.stock.value.length));
  });

  it("初始无人化率为 0（尚无已执行动作）", () => {
    expect(store.autonomyStats.value.total).toBe(0);
    expect(store.autonomyStats.value.autoRate).toBe(0);
  });
});

describe("核准即执行 · onReviewDecided 13 kind 回写", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("customs-draft 核准 → 报关放行 + 推进流程步 + 台账", () => {
    const t = findTask(store, "customs-draft");
    expect(t).toBeTruthy();
    store.approveReview(t.id);
    const dec = store.declarations.value.find((d: any) => d.id === "0617");
    expect(dec.status).toBe("released");
    expect(store.customsFlow.value.find((s: any) => s.n === 5).state).toBe("done");
    expect(store.customsFlow.value.find((s: any) => s.n === 6).state).toBe("active");
    expect(store.executedActions.value.some((a: any) => a.kind === "customs-draft")).toBe(true);
  });

  it("doc-consistency 硬闸：核准=放行；(另一次)驳回=退回 draft", () => {
    const dec = store.declarations.value.find((d: any) => d.id === "0625");
    // 0625 种子 hs:""，缺 HS 不得放行（即使裁决硬差异）；先完成 HS 归类再裁决放行（真实前置）。
    dec.lines[0].hs = "2204.29.00";
    const t = findTask(store, "doc-consistency");
    store.approveReview(t.id);
    expect(dec.status).toBe("released");
    expect(store.executedActions.value.some((a: any) => a.kind === "doc-consistency")).toBe(true);
  });

  it("doc-consistency 缺 HS 时即使裁决硬差异也不得放行", () => {
    const dec = store.declarations.value.find((d: any) => d.id === "0625");
    expect(dec.lines[0].hs).toBe(""); // 种子无 HS
    const t = findTask(store, "doc-consistency");
    store.approveReview(t.id);
    expect(dec.status).not.toBe("released"); // 缺 HS 被拦
  });

  it("doc-consistency 驳回 → 退回 draft，不记执行台账", async () => {
    const s2 = await freshStore();
    const t = findTask(s2, "doc-consistency");
    s2.rejectReview(t.id, "发票重开");
    const dec = s2.declarations.value.find((d: any) => d.id === "0625");
    expect(dec.status).toBe("draft");
    expect(s2.executedActions.value.some((a: any) => a.kind === "doc-consistency")).toBe(false);
  });

  it("compliance-release 核准 → 可放行", () => {
    const t = findTask(store, "compliance-release");
    store.approveReview(t.id);
    const c = store.compliance.value.find((x: any) => x.container === "0625");
    expect(c.ok).toBe(true);
    expect(c.release).toBe("可放行");
  });

  it("lead-convert 核准 → 供应商入公海", () => {
    const before = store.suppliers.value.length;
    const t = findTask(store, "lead-convert");
    store.approveReview(t.id);
    expect(store.suppliers.value.length).toBe(before + 1);
    expect(store.suppliers.value.some((s: any) => s.name === "Viña Aurora")).toBe(true);
  });

  it("recon-match 核准 → 账项已匹配", () => {
    const t = findTask(store, "recon-match");
    store.approveReview(t.id);
    const r = store.recon.value.find((x: any) => x.item === "货代账单 INV-FRT-0617");
    expect(r.status).toBe("已匹配");
  });

  it("recon-match 幂等：重复 approve 只回写一次台账", () => {
    const t = findTask(store, "recon-match");
    store.approveReview(t.id);
    const cntAfterFirst = store.executedActions.value.filter((a: any) => a.kind === "recon-match").length;
    store.approveReview(t.id); // 已 approved，幂等守卫拦截
    expect(store.executedActions.value.filter((a: any) => a.kind === "recon-match").length).toBe(cntAfterFirst);
  });

  it("recon-match 脏卡兜底：未达/无候选账项批准不假闭合为已匹配", () => {
    const row = store.recon.value.find((x: any) => x.item === "报关行费 BRK-0621"); // 未达 · 无候选
    expect(row.status).toBe("未达");
    store.enqueueReview({
      mod: "m8", kind: "recon-match", title: "脏对账卡", refId: "报关行费 BRK-0621",
      summary: "x", facts: [], risk: "normal", payload: { item: "报关行费 BRK-0621" },
    });
    const t = store.reviewTasks.value.find((x: any) => x.kind === "recon-match" && x.refId === "报关行费 BRK-0621" && x.status === "pending");
    store.approveReview(t.id);
    expect(row.status).toBe("未达"); // 未被假闭合
  });

  it("replenish 核准 → 标记已下单（ordered）", () => {
    const t = findTask(store, "replenish");
    store.approveReview(t.id);
    const rs = store.replenish.value.find((x: any) => x.sku === "SKU-CHRD-23");
    expect(rs.ordered).toBe(true);
  });

  it("outreach-send 核准 → 写入往来线程 + 台账（曾经空转，现真回写）", () => {
    const lead = store.leads.value.find((l: any) => l.id === "L-2202"); // contacted, 1 thread
    const before = lead.thread.length;
    store.enqueueReview({
      mod: "m2", kind: "outreach-send", title: "测试外发", refId: "L-2202",
      summary: "x", facts: [], risk: "normal",
      payload: { leadId: "L-2202", lang: "en", body: "Dear Johann, this is the approved letter." },
    });
    const t = findTask(store, "outreach-send");
    store.approveReview(t.id);
    expect(lead.thread.length).toBe(before + 1);
    expect(lead.thread[lead.thread.length - 1].text).toContain("approved letter");
    expect(store.executedActions.value.some((a: any) => a.kind === "outreach-send")).toBe(true);
  });

  it("rfq-send 核准 → 记录已群发台账（曾经空转）", () => {
    store.enqueueReview({
      mod: "m3", kind: "rfq-send", title: "询价群发", summary: "x", facts: [], risk: "normal",
      payload: { targets: ["A 酒庄", "B 酒庄"] },
    });
    const t = findTask(store, "rfq-send");
    store.approveReview(t.id);
    const act = store.executedActions.value.find((a: any) => a.kind === "rfq-send");
    expect(act).toBeTruthy();
    expect(act.detail).toContain("A 酒庄");
  });

  it("quote-out 核准 → 生成销售订单（曾经空转）", () => {
    const before = store.salesOrders.value.length;
    store.enqueueReview({
      mod: "m7", kind: "quote-out", title: "报价外发", summary: "x", facts: [], risk: "normal",
      payload: { customer: "Dan Murphy's", lines: "Shiraz ×100", incl: 3300 },
    });
    const t = findTask(store, "quote-out");
    store.approveReview(t.id);
    expect(store.salesOrders.value.length).toBe(before + 1);
    expect(store.salesOrders.value[0].status).toBe("报价已发");
  });

  it("milestone-anomaly 核准 → 写入异常里程碑 + 滞期升级为高（曾经空转）", () => {
    const sh = store.shipments.value.find((s: any) => s.id === "0625");
    const before = sh.milestones.length;
    store.enqueueReview({
      mod: "m5", kind: "milestone-anomaly", title: "异常", refId: "0625",
      summary: "x", facts: [], risk: "normal", payload: { anomaly: "滞港" },
    });
    const t = findTask(store, "milestone-anomaly");
    store.approveReview(t.id);
    expect(sh.milestones.length).toBe(before + 1);
    expect(sh.demurrage).toBe("高");
  });
});

describe("外贸 OS store · 财务/审批纵深守卫（codex 终审）", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("M7 报价：含税单价 = 含税总额 / 瓶数（不再把总额当每瓶价）", async () => {
    // taxable = 单价 33 × 100 瓶 = 3300（总完税价）
    await store.runQuoteOut("Dan Murphy's", "Shiraz-2021", 3300, 100);
    const t = store.reviewTasks.value.find((x: any) => x.kind === "quote-out");
    const incl = Number(t.payload.incl);       // 含税总额
    const inclUnit = Number(t.payload.inclUnit); // 含税单价/瓶
    expect(inclUnit).toBeCloseTo(incl / 100, 2);
    expect(inclUnit).toBeLessThan(incl); // 单价必然远小于总额
    expect(t.summary).toContain("/瓶");
    expect(t.summary).toContain("含税总额");
  });

  it("enqueueReview 同 kind+refId 未决卡刷新为最新提案（新报价不被静默丢弃）", async () => {
    await store.runQuoteOut("Dan Murphy's", "Shiraz-2021", 3300, 100);
    const first = store.reviewTasks.value.find((x: any) => x.kind === "quote-out");
    const firstIncl = Number(first.payload.incl);
    await store.runQuoteOut("Dan Murphy's", "Shiraz-2021", 6600, 100); // 数量/价改了
    const cards = store.reviewTasks.value.filter((x: any) => x.kind === "quote-out" && x.refId === first.refId);
    expect(cards.length).toBe(1); // 仍是一张卡
    expect(Number(cards[0].payload.incl)).not.toBe(firstIncl); // 已刷新为新提案
  });

  it("recon-match 脏卡批准被拒时卡片回滚（不停留在 approved 假象）", () => {
    store.enqueueReview({
      mod: "m8", kind: "recon-match", title: "脏对账卡", refId: "报关行费 BRK-0621",
      summary: "x", facts: [], risk: "normal", payload: { item: "报关行费 BRK-0621" },
    });
    const t = store.reviewTasks.value.find((x: any) => x.kind === "recon-match" && x.refId === "报关行费 BRK-0621");
    store.approveReview(t.id);
    expect(t.status).not.toBe("approved"); // 回滚
    const row = store.recon.value.find((x: any) => x.item === "报关行费 BRK-0621");
    expect(row.status).toBe("未达");
  });

  it("resetReview 拒绝重开已有更新待审 twin 的旧驳回卡", () => {
    const t1 = store.enqueueReview({
      mod: "m8", kind: "recon-match", title: "旧对账卡", refId: "twin-item",
      summary: "x", facts: [], risk: "normal", payload: { item: "twin-item" },
    })!;
    store.rejectReview(t1.id, "驳回");
    expect(t1.status).toBe("rejected");
    const t2 = store.enqueueReview({
      mod: "m8", kind: "recon-match", title: "新对账卡", refId: "twin-item",
      summary: "y", facts: [], risk: "normal", payload: { item: "twin-item" },
    })!;
    expect(t2.status).toBe("pending");
    store.resetReview(t1.id);
    expect(t1.status).toBe("rejected"); // 未重开
  });

  it("M7 报价：非整数瓶数（1.5）被拒绝生成", async () => {
    const res = await store.runQuoteOut("Dan Murphy's", "Shiraz-2021", 49.5, 1.5);
    expect(res).toBeNull();
    expect(store.reviewTasks.value.some((x: any) => x.kind === "quote-out")).toBe(false);
  });

  it("recon-match 伪候选「未找到候选」不写回、不入闸", async () => {
    const row = store.recon.value.find((x: any) => x.item === "报关行费 BRK-0621")!; // 未达
    const gatesBefore = store.reviewTasks.value.length;
    h.runJsonResult.value = { candidates: [{ target: "未找到候选", reason: "确实没有", conf: 60 }] };
    await store.runRecon("报关行费 BRK-0621");
    expect(row.status).toBe("未达");
    expect(store.reviewTasks.value.length).toBe(gatesBefore);
  });

  it("M7 quote-out 批准：脏 payload（incl<=0/空客户）拒绝生成销售订单并回滚", () => {
    const before = store.salesOrders.value.length;
    store.enqueueReview({
      mod: "m7", kind: "quote-out", title: "脏报价", summary: "x", facts: [], risk: "normal",
      payload: { customer: "", lines: "", incl: -100 },
    });
    const t = findTask(store, "quote-out");
    store.approveReview(t.id);
    expect(store.salesOrders.value.length).toBe(before); // 未生成
    expect(t.status).not.toBe("approved"); // 回滚
  });

  it("M3 quote-writeback 批准：脏 payload（负数量/空供应商）拒绝生成报关草稿", () => {
    const before = store.declarations.value.length;
    store.enqueueReview({
      mod: "m3", kind: "quote-writeback", title: "脏报价回写", summary: "x", facts: [], risk: "normal",
      payload: { supplier: "", goods: "", qty: -10, unit: 0, origin: "" },
    });
    const t = findTask(store, "quote-writeback");
    store.approveReview(t.id);
    expect(store.declarations.value.length).toBe(before); // 未生成虚假报关数据
    expect(t.status).not.toBe("approved");
  });

  it("M4 customs-draft 批准：待审期间出现硬差异则拒绝放行", () => {
    const dec = store.declarations.value.find((d: any) => d.id === "0617")!;
    dec.checks.push({ field: "毛重", severity: "hard", decl: "1000kg", inv: "1200kg", pack: "1200kg", bl: "1200kg" });
    const t = findTask(store, "customs-draft");
    store.approveReview(t.id);
    expect(dec.status).not.toBe("released"); // 未违规放行
    expect(t.status).not.toBe("approved");
  });

  it("M3→M4：USD 报价按汇率折 AUD 入报关（不再 1:1 当 AUD）", () => {
    const beforeDec = store.declarations.value.length;
    store.enqueueReview({
      mod: "m3", kind: "quote-writeback", title: "USD 报价回写", summary: "x", facts: [], risk: "normal",
      payload: { supplier: "Viña Aurora", goods: "Carmenère", qty: 100, unit: 4.2, currency: "USD", origin: "智利" },
    });
    const t = findTask(store, "quote-writeback");
    store.approveReview(t.id);
    expect(store.declarations.value.length).toBe(beforeDec + 1);
    const dec = store.declarations.value[0];
    // 100 瓶 × USD 4.2 × 1.52 ≈ AUD 638（若 1:1 当 AUD 则只有 420）
    expect(dec.fob).toBeGreaterThan(600);
    expect(dec.currency).toBe("AUD");
  });

  it("M4 报关放行前置：缺 HS 的报关草稿不得放行", () => {
    // 用 M3 报价回写生成一张 hs:"" 的报关草稿
    store.enqueueReview({
      mod: "m3", kind: "quote-writeback", title: "新柜", summary: "x", facts: [], risk: "normal",
      payload: { supplier: "Test Vin", goods: "红酒", qty: 1000, unit: 5, currency: "USD", origin: "智利" },
    });
    store.approveReview(findTask(store, "quote-writeback").id);
    const dec = store.declarations.value[0];
    expect(dec.lines[0].hs).toBe(""); // 新柜无 HS
    store.submitCustomsDraft(dec.id);
    const t = store.reviewTasks.value.find((x: any) => x.refId === dec.id && (x.kind === "customs-draft" || x.kind === "doc-consistency"));
    store.approveReview(t.id);
    expect(dec.status).not.toBe("released"); // 缺 HS 不得放行
  });

  it("M4 HS 归类：AI 返回非法 HS（abc）时拒绝、不覆盖、返回 false", async () => {
    const dec = store.declarations.value[0];
    const originHs = dec.lines[0].hs;
    h.runJsonResult.value = { hsCode: "abc", reasoning: "乱归类", dutyRate: "5%", hsConf: 99, dutyConf: 90 };
    const ok = await store.runHsClassify(dec.id);
    expect(ok).toBe(false);
    expect(dec.lines[0].hs).toBe(originHs); // 未被非法值覆盖
  });

  it("M4 已放行报关不可再入确认闸（防重复放行）", () => {
    const t = findTask(store, "customs-draft");
    store.approveReview(t.id); // 0617 → released
    const dec = store.declarations.value.find((d: any) => d.id === "0617");
    expect(dec.status).toBe("released");
    const gatesBefore = store.reviewTasks.value.filter((x: any) => x.kind === "customs-draft" || x.kind === "doc-consistency").length;
    store.submitCustomsDraft("0617"); // 已放行，不应再入闸
    const gatesAfter = store.reviewTasks.value.filter((x: any) => x.kind === "customs-draft" || x.kind === "doc-consistency").length;
    expect(gatesAfter).toBe(gatesBefore);
  });
});

describe("外贸 OS · 财务精度", () => {
  it("round2 修正 IEEE 分位误差（computeWineTax 含税总额半分进位）", async () => {
    const { round2, computeWineTax } = await import("../types");
    expect(round2(1.005)).toBe(1.01);
    expect(round2(10.075)).toBe(10.08);
    expect(computeWineTax(105).inclTotal).toBe(149); // 曾算成 148.99
  });
});

describe("链路接通 · M1→M2 / M3→M4 / M5→M6", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("M1→M2：promoteSkuToLead 把候选并入线索池，去重", () => {
    const sku = store.skus.value[0];
    const beforeLeads = store.leads.value.length;
    const lead = store.promoteSkuToLead(sku);
    expect(lead).toBeTruthy();
    expect(store.leads.value.length).toBe(beforeLeads + 1);
    expect(sku.state).toBe("lead");
    // 再次调用同名候选 → 去重返回 null
    const dup = store.promoteSkuToLead(sku);
    expect(dup).toBeNull();
    expect(store.leads.value.length).toBe(beforeLeads + 1);
  });

  it("M3→M4：quote-writeback 核准生成报关草稿", () => {
    const beforeDec = store.declarations.value.length;
    store.enqueueReview({
      mod: "m3", kind: "quote-writeback", title: "报价回写", summary: "x", facts: [], risk: "normal",
      payload: { supplier: "Viña Aurora", goods: "Carmenère 红酒", qty: 12000, unit: 4.2, origin: "智利" },
    });
    const t = findTask(store, "quote-writeback");
    store.approveReview(t.id);
    expect(store.declarations.value.length).toBe(beforeDec + 1);
    const dec = store.declarations.value[0];
    expect(dec.supplier).toBe("Viña Aurora");
    expect(dec.status).toBe("draft");
    expect(dec.wet).toBeGreaterThan(0); // computeWineTax 生效
  });

  it("两笔 quote-writeback 连续核准 → 生成两张不同 id 的报关草稿（防碰撞）", () => {
    const beforeDec = store.declarations.value.length;
    for (const s of ["供应商甲", "供应商乙"]) {
      store.enqueueReview({
        mod: "m3", kind: "quote-writeback", title: `回写 ${s}`, refId: s, summary: "x", facts: [], risk: "normal",
        payload: { supplier: s, goods: "红酒", qty: 6000, unit: 5, origin: "智利" },
      });
    }
    // 全部 pending 的 quote-writeback 逐一核准
    store.reviewTasks.value
      .filter((t: any) => t.kind === "quote-writeback" && t.status === "pending")
      .forEach((t: any) => store.approveReview(t.id));
    const added = store.declarations.value.length - beforeDec;
    expect(added).toBe(2);
    const ids = store.declarations.value.slice(0, 2).map((d: any) => d.id);
    expect(new Set(ids).size).toBe(2); // 两个 id 不相同
  });

  it("M5→M6：receiveArrival 开 GRN 入库 + 幂等（须先清关放行）", () => {
    // 清关前置：未放行/未合规时不得入仓（合规红线）
    expect(store.receiveArrival("0617")).toBeNull();
    // 完成 M4 报关放行 + M9 合规通过后才能开 GRN
    const dec = store.declarations.value.find((d: any) => d.id === "0617");
    dec.status = "released";
    const comp = store.compliance.value.find((c: any) => c.container === "0617");
    if (comp) comp.ok = true;
    const beforeStock = store.stock.value.length;
    const sku = store.receiveArrival("0617");
    expect(sku).toBe("SKU-0617");
    const sh = store.shipments.value.find((s: any) => s.id === "0617");
    expect(sh.status).toBe("已入仓");
    expect(store.stock.value.length).toBe(beforeStock + 1);
    expect(store.executedActions.value.some((a: any) => a.kind === "grn-open")).toBe(true);
    // 幂等：再次调用返回 null，不重复入库
    const again = store.receiveArrival("0617");
    expect(again).toBeNull();
    expect(store.stock.value.length).toBe(beforeStock + 1);
  });
});

describe("AI 动作 · 置信分流 + 驳回自动重跑", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("HS 归类置信 ≥85 → 自动放行留痕（by:auto），不入闸", async () => {
    h.runJsonResult.value = { hsCode: "2204.21.30", reasoning: "税则第22章", dutyRate: "5%", hsConf: 92, dutyConf: 90 };
    await store.runHsClassify("0621");
    expect(findTask(store, "hs-review")).toBeUndefined();
    const auto = store.executedActions.value.find((a: any) => a.kind === "hs-classify-auto");
    expect(auto).toBeTruthy();
    expect(auto.by).toBe("auto");
    expect(store.autonomyStats.value.auto).toBe(1);
  });

  it("HS 归类置信 <85 → 转人工闸，带 payload", async () => {
    h.runJsonResult.value = { hsCode: "2204.29", reasoning: "存疑", dutyRate: "5%", hsConf: 70, dutyConf: 60 };
    await store.runHsClassify("0621");
    const t = findTask(store, "hs-review");
    expect(t).toBeTruthy();
    expect(t.payload.decId).toBe("0621");
    expect(t.facts.some((f: any) => f.source)).toBe(true); // 出处字段存在
  });

  it("驳回 hs-review → 自动带批注重跑（再次调用 runJson）", async () => {
    h.runJsonResult.value = { hsCode: "2204.29", reasoning: "x", dutyRate: "5%", hsConf: 70, dutyConf: 60 };
    await store.runHsClassify("0621");
    const t = findTask(store, "hs-review");
    const callsBefore = h.calls.length;
    store.rejectReview(t.id, "应归 2204.21");
    // rerun 是异步 fire-and-forget，等微任务
    await new Promise((r) => setTimeout(r, 0));
    expect(h.calls.length).toBeGreaterThan(callsBefore);
    const last = h.calls[h.calls.length - 1];
    expect(last.prompt).toContain("应归 2204.21"); // 批注拼进 prompt
    expect(t.reran).toBe(true);
  });

  it("非重跑类（compliance-release）驳回不触发 AI 重跑", async () => {
    const t = findTask(store, "compliance-release");
    const callsBefore = h.calls.length;
    store.rejectReview(t.id, "维持拦发货");
    await new Promise((r) => setTimeout(r, 0));
    expect(h.calls.length).toBe(callsBefore);
  });
});

describe("持久化 · 响应式自动落盘", () => {
  it("mutate 业务 ref → watch 自动写 localStorage", async () => {
    const store = await freshStore();
    store.leads.value.push({
      id: "L-TEST", company: "AutoPersist Co", country: "智利", region: "x", category: "x",
      website: "", email: "", contact: "", source: "manual", grade: "B", score: 60,
      status: "new", profile: {}, confs: {}, replyClass: null, thread: [],
    } as any);
    await nextTick();
    const raw = localStorage.getItem("chuanying.trade.leads.v1");
    expect(raw).toContain("AutoPersist Co");
  });

  it("resetAll 清空并重载种子", async () => {
    const store = await freshStore();
    store.leads.value.push({ id: "X" } as any);
    store.resetAll();
    expect(store.leads.value.some((l: any) => l.id === "X")).toBe(false);
    expect(store.leads.value.length).toBeGreaterThan(0);
  });
});
