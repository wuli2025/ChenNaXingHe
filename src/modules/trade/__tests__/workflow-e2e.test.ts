/**
 * 外贸 OS · 端到端工作流可行性测试
 * ─────────────────────────────────────────────────────────────
 * 验证主链路从「AI 采集」→「人工审批回写」→「置信分流」→「硬闸拦截」→
 * 「驳回自动重跑」整条流是否可行、状态守恒、且不被脏数据击穿。
 * agent runner 被 mock 成「可编排队列」，逻辑确定性验证。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { nextTick } from "vue";

/* ── mock useAgentRunner：runJson 从队列 shift 出预置 data；run 返回可控文本；两者都记 prompt ── */
const h = vi.hoisted(() => ({
  jsonQueue: [] as Record<string, unknown>[],
  textQueue: [] as string[],
  calls: [] as { fn: "run" | "runJson"; prompt: string }[],
}));

vi.mock("../../../composables/useAgentRunner", () => ({
  useAgentRunner: () => ({
    running: { value: false },
    run: async (opts: { prompt: string }) => {
      h.calls.push({ fn: "run", prompt: opts.prompt });
      return { raw: h.textQueue.shift() ?? "MOCK-TEXT" };
    },
    runJson: async (opts: { prompt: string }) => {
      h.calls.push({ fn: "runJson", prompt: opts.prompt });
      const data = h.jsonQueue.shift() ?? {};
      return { data, raw: JSON.stringify(data) };
    },
  }),
}));

type Store = Awaited<ReturnType<typeof freshStore>>;

async function freshStore() {
  vi.resetModules();
  localStorage.clear();
  h.calls.length = 0;
  h.jsonQueue.length = 0;
  h.textQueue.length = 0;
  const mod = await import("../useTradeStore");
  return mod.useTradeStore();
}

const pushJson = (...xs: Record<string, unknown>[]) => h.jsonQueue.push(...xs);
const pushText = (...xs: string[]) => h.textQueue.push(...xs);

function findTask(store: any, kind: string, status = "pending") {
  return store.reviewTasks.value.find((t: any) => t.kind === kind && t.status === status);
}
function lastPrompt(fn?: "run" | "runJson") {
  const arr = fn ? h.calls.filter((c) => c.fn === fn) : h.calls;
  return arr[arr.length - 1]?.prompt ?? "";
}

describe("外贸 OS 端到端 · 采集与转化", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("寻源链路可行：AI 采集回写 SKU（provenance=ai / state=candidate）", async () => {
    const before = store.skus.value.length;
    pushJson({ skus: [
      { name: "Barossa Reserve", region: "南澳 · Barossa", priceBand: "$$", certs: "有机", conf: 88 },
      { name: "Yarra Pinot", region: "维州 · Yarra", priceBand: "$$$", certs: "—", conf: 72 },
    ] });
    const n = await store.runSourcing({ keywords: "干红", region: "AU", category: "wine", limit: 10 });
    expect(n).toBe(2);
    expect(store.skus.value.length).toBe(before + 2);
    const fresh = store.skus.value[0];
    expect(fresh.provenance).toBe("ai");
    expect(fresh.state).toBe("candidate");
  });

  it("触达进外发闸 + 核准即执行回写", async () => {
    // 造一个候选并转建联
    pushJson({ skus: [{ name: "TestCo Wines", region: "南澳 · Barossa", priceBand: "$$", certs: "有机", conf: 90 }] });
    await store.runSourcing({ keywords: "x", region: "AU", category: "wine", limit: 1 });
    const sku = store.skus.value.find((s: any) => s.name === "TestCo Wines")!;
    const lead = store.promoteSkuToLead(sku)!;
    expect(lead).toBeTruthy();

    pushText("Dear TestCo, ...");
    await store.runOutreach(lead.id, "EN");
    const task = findTask(store, "outreach-send");
    expect(task).toBeTruthy();
    expect(task.risk).toBe("normal");

    const actsBefore = store.executedActions.value.length;
    store.approveReview(task.id, "可以外发");
    expect(store.reviewTasks.value.find((t: any) => t.id === task.id).status).toBe("approved");
    // 核准即执行：新增一条 by:human 的外发台账
    expect(store.executedActions.value.length).toBe(actsBefore + 1);
    expect(store.executedActions.value[0].by).toBe("human");
  });
});

describe("外贸 OS 端到端 · HS 置信分流", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("低置信（<85）转人工复核闸，且不记自动动作", async () => {
    const dec = store.declarations.value[0];
    const autoBefore = store.autonomyStats.value.auto;
    pushJson({ hsCode: "2204.21", reasoning: "起泡酒归类", dutyRate: "5%", hsConf: 60, dutyConf: 70 });
    const ok = await store.runHsClassify(dec.id);
    expect(ok).toBe(true);
    const task = findTask(store, "hs-review");
    expect(task).toBeTruthy();
    expect(task.risk).toBe("high");
    expect(store.autonomyStats.value.auto).toBe(autoBefore); // 未自动放行
  });

  it("高置信（≥85）不入闸，直接记 by:auto 自动动作", async () => {
    const dec = store.declarations.value[0];
    const autoBefore = store.autonomyStats.value.auto;
    pushJson({ hsCode: "2204.21", reasoning: "静止葡萄酒", dutyRate: "5%", hsConf: 95, dutyConf: 92 });
    const ok = await store.runHsClassify(dec.id);
    expect(ok).toBe(true);
    expect(findTask(store, "hs-review")).toBeFalsy(); // 不入闸
    expect(store.autonomyStats.value.auto).toBe(autoBefore + 1);
    expect(store.executedActions.value[0].by).toBe("auto");
  });
});

describe("外贸 OS 端到端 · 脏数据鲁棒性（可行性关键）", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("HS：AI 漏返 hsCode 时不覆盖原值、不入闸、返回 false", async () => {
    const dec = store.declarations.value[0];
    const originHs = dec.lines[0]?.hs;
    pushJson({ hsConf: 90, dutyConf: 88 }); // 缺 hsCode
    const ok = await store.runHsClassify(dec.id);
    expect(ok).toBe(false);
    expect(store.declarations.value[0].lines[0]?.hs).toBe(originHs); // 未被覆盖
    expect(findTask(store, "hs-review")).toBeFalsy();
  });

  it("回复分类：非法枚举被忽略，不污染 lead 状态", async () => {
    // 造一个 lead
    pushJson({ skus: [{ name: "EnumCo", region: "南澳", priceBand: "$", certs: "—", conf: 80 }] });
    await store.runSourcing({ keywords: "x", region: "AU", category: "wine", limit: 1 });
    const sku = store.skus.value.find((s: any) => s.name === "EnumCo")!;
    const lead = store.promoteSkuToLead(sku)!;
    const statusBefore = lead.status;

    pushJson({ replyClass: "банан", reason: "乱码", conf: 99 }); // 非法枚举
    const res = await store.runReplyClass(lead.id, "we are interested");
    expect(res).toBeNull();
    const after = store.leads.value.find((l: any) => l.id === lead.id);
    expect(after.replyClass).toBeNull();      // 未写入非法值
    expect(after.status).toBe(statusBefore);  // 状态未被改动
  });
});

describe("外贸 OS 端到端 · 硬闸与驳回重跑", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("报关三单硬差异 → 硬闸拦截（hardGate=true）", () => {
    // 种子柜 0625 含硬差异（发票金额与报关不一致）
    const dec = store.declarations.value.find((d: any) => d.checks.some((c: any) => c.severity === "hard"));
    expect(dec).toBeTruthy();
    store.submitCustomsDraft(dec.id);
    const task = findTask(store, "doc-consistency");
    expect(task).toBeTruthy();
    expect(task.hardGate).toBe(true);
  });

  it("驳回自动带批注重跑：批注拼进重跑 prompt", async () => {
    // 造 lead → outreach 入闸
    pushJson({ skus: [{ name: "RerunCo", region: "南澳", priceBand: "$$", certs: "有机", conf: 85 }] });
    await store.runSourcing({ keywords: "x", region: "AU", category: "wine", limit: 1 });
    const sku = store.skus.value.find((s: any) => s.name === "RerunCo")!;
    const lead = store.promoteSkuToLead(sku)!;
    pushText("draft v1");
    await store.runOutreach(lead.id, "EN");
    const task = findTask(store, "outreach-send");
    expect(task).toBeTruthy();

    const runsBefore = store.runs.value.length;
    pushText("draft v2 更正式"); // 重跑用的新草稿
    const note = "语气再正式些";
    store.rejectReview(task.id, note);
    await nextTick();
    // 重跑是 async（void），等微任务队列排空
    await new Promise((r) => setTimeout(r, 0));

    expect(store.runs.value.length).toBeGreaterThan(runsBefore); // 发生了重跑
    expect(lastPrompt("run")).toContain(note);                   // 批注拼进 prompt
  });
});

describe("外贸 OS 端到端 · 全链不变量守恒", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("跑完混合链路后：autonomy 与 review 列守恒", async () => {
    // 高置信 HS（auto）
    pushJson({ hsCode: "2204.21", reasoning: "r", dutyRate: "5%", hsConf: 96, dutyConf: 90 });
    await store.runHsClassify(store.declarations.value[0].id);
    // 低置信 HS（human 闸）→ 核准（human 动作）
    pushJson({ hsCode: "2204.29", reasoning: "r", dutyRate: "5%", hsConf: 55, dutyConf: 60 });
    await store.runHsClassify(store.declarations.value[1].id);
    const hsTask = findTask(store, "hs-review");
    if (hsTask) store.approveReview(hsTask.id);
    // 对账候选入闸
    pushJson({ candidates: [{ target: "PO-XYZ", reason: "金额吻合", conf: 90 }] });
    await store.runRecon(store.recon.value[0].item);

    const s = store.autonomyStats.value;
    expect(s.total).toBe(s.auto + s.human);
    expect(s.total).toBe(store.executedActions.value.length);

    const c = store.reviewColumns.value;
    const sum = c.pending.length + c.in_review.length + c.approved.length + c.rejected.length;
    expect(sum).toBe(store.reviewTasks.value.length);
  });
});
