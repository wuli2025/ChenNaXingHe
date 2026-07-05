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
    const t = findTask(store, "doc-consistency");
    store.approveReview(t.id);
    const dec = store.declarations.value.find((d: any) => d.id === "0625");
    expect(dec.status).toBe("released");
    expect(store.executedActions.value.some((a: any) => a.kind === "doc-consistency")).toBe(true);
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

  it("M5→M6：receiveArrival 开 GRN 入库 + 幂等", () => {
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
