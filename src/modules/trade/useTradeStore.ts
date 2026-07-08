/**
 * useTradeStore —— 北极星外贸 OS 的响应式状态 + 持久化 + Claude 驱动动作 + 人工审核流水线。
 *
 * 单例。所有 12 个模块组件与审核看板都 import 它（零 props 契约）。
 *  - 状态：12 模块业务数据（种子自 seed.ts），全部落 localStorage（chuanying.trade.*）。
 *  - 控制台：consoleLines + runStatus + runs，surface「AI 跑了什么」。
 *  - 审核流水线：reviewTasks + enqueue/claim/approve/reject + 分列 computed；
 *    每个人工闸（报关确认、三单硬差异、缺证放行、建联外发、报价回写…）都进这条流水线。
 *  - Claude 动作：经 useAgentRunner.run/runJson 调官方 Claude Code，落 run 记录 + 事件。
 */
import { ref, computed, watch } from "vue";
import { useAgentRunner } from "../../composables/useAgentRunner";
import type {
  SupplierLead, OutreachFunnelStage, CustomsDeclaration, CustomsKpi, CustomsFlowStep,
  Shipment, Supplier, SkuCandidate, StockLot, ReplenishSuggestion, Customer, SalesOrder,
  ReconMatch, ComplianceRow, WorkflowRun, KbEntry, DashKpi, Trend, PipelineNode, BriefingBlock,
  ConsoleLine, AgentRun, ReviewTask, ReviewKind, ReviewStatus, ModId, ExecutedAction,
} from "./types";
import { LS, computeWineTax, round2, toAud, ICONS } from "./types";
import * as seed from "./seed";
import * as P from "./prompts";

/* ── 工具 ── */
function lsLoad<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsSave<T>(key: string, val: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* ignore quota */
  }
}
let _n = 0;
function uid(prefix: string): string {
  _n += 1;
  return `${prefix}-${Date.now().toString(36)}-${_n}`;
}

let singleton: ReturnType<typeof create> | null = null;

function create() {
  const { running, run, runJson } = useAgentRunner();

  /* ══════════ 持久化业务状态 ══════════ */
  const leads = ref<SupplierLead[]>([]);
  const outreachFunnel = ref<OutreachFunnelStage[]>(seed.seedOutreachFunnel());
  const declarations = ref<CustomsDeclaration[]>([]);
  const customsKpi = ref<CustomsKpi>(seed.seedCustomsKpi());
  const customsFlow = ref<CustomsFlowStep[]>(seed.seedCustomsFlow());
  const shipments = ref<Shipment[]>([]);
  const suppliers = ref<Supplier[]>([]);
  const skus = ref<SkuCandidate[]>([]);
  const stock = ref<StockLot[]>([]);
  const replenish = ref<ReplenishSuggestion[]>([]);
  const customers = ref<Customer[]>([]);
  const salesOrders = ref<SalesOrder[]>([]);
  const recon = ref<ReconMatch[]>([]);
  const compliance = ref<ComplianceRow[]>([]);
  const workflows = ref<WorkflowRun[]>([]);
  const kb = ref<KbEntry[]>([]);
  const reviewTasks = ref<ReviewTask[]>([]);
  const runs = ref<AgentRun[]>([]);
  /** 已执行动作台账（「核准即执行」证据链 + 无人化度量）。 */
  const executedActions = ref<ExecutedAction[]>([]);

  /* ══════════ 驾驶舱派生数据（全部从各模块真实状态实时派生，不再用静态种子） ══════════ */
  /** 距效期还有几个月（"2025-11" → 数字，用于临期判断）。 */
  function monthsToExpiry(expiry: string): number {
    const m = /(\d{4})-(\d{1,2})/.exec(expiry || "");
    if (!m) return 999;
    const exp = new Date(Number(m[1]), Number(m[2]) - 1, 1).getTime();
    return (exp - Date.now()) / (1000 * 60 * 60 * 24 * 30);
  }
  const activeShipments = computed(() => shipments.value.filter((s) => !/入仓|已完成|派送入仓/.test(s.status)));
  const pendingDeclarations = computed(() => declarations.value.filter((d) => d.status === "draft" || d.status === "reviewing"));
  const openRecon = computed(() => recon.value.filter((r) => r.status !== "已匹配"));
  const nearExpiryLots = computed(() => stock.value.filter((l) => monthsToExpiry(l.expiry) <= 8).sort((a, b) => monthsToExpiry(a.expiry) - monthsToExpiry(b.expiry)));
  const pendingHardGates = computed(() => reviewTasks.value.filter((t) => (t.status === "pending" || t.status === "in_review") && (t.hardGate || t.risk === "hard")));

  /** 无人化度量：已执行动作里自动放行占比（P1 高置信自动放行会拉高 autoRate）。 */
  const autonomyStats = computed(() => {
    const total = executedActions.value.length;
    const auto = executedActions.value.filter((a) => a.by === "auto").length;
    return { total, auto, human: total - auto, autoRate: total ? Math.round((auto / total) * 100) : 0 };
  });

  const dashKpi = computed<DashKpi[]>(() => [
    { v: String(stock.value.length), l: "在库批次", d: `${skus.value.filter((s) => s.state === "stocked").length} 已入库 SKU`, up: true, acc: "gold", ico: ICONS.warehouse },
    { v: String(activeShipments.value.length), l: "在途货柜", d: activeShipments.value[0] ? `${activeShipments.value[0].id} · ${activeShipments.value[0].status}` : "无在途", acc: "blue", ico: ICONS.logistics },
    { v: String(pendingDeclarations.value.length), l: "待报关", d: declarations.value.some((d) => d.checkStatus === "hard") ? "含硬差异" : "无硬差异", up: !declarations.value.some((d) => d.checkStatus === "hard"), acc: "amber", ico: ICONS.customs },
    { v: String(nearExpiryLots.value.length), l: "临期批次", d: nearExpiryLots.value[0] ? `${nearExpiryLots.value[0].name} · ${nearExpiryLots.value[0].expiry}` : "无临期", up: false, acc: "red", ico: ICONS.warehouse },
    { v: String(pendingHardGates.value.length), l: "待处理硬闸", d: pendingHardGates.value.length ? "需优先终审" : "已清空", up: pendingHardGates.value.length === 0, acc: pendingHardGates.value.length ? "red" : "green", ico: ICONS.review },
    { v: String(openRecon.value.length), l: "未达账项", d: `${recon.value.length} 笔中待匹配`, acc: "purple", ico: ICONS.finance },
  ]);
  const pipeline = computed<PipelineNode[]>(() => [
    { c: String(skus.value.filter((s) => s.state === "candidate").length), l: "选品候选" },
    { c: String(leads.value.filter((l) => l.status === "contacted" || l.status === "replied").length), l: "建联中" },
    { c: String(suppliers.value.length), l: "供应商" },
    { c: String(activeShipments.value.length), l: "在途货柜" },
    { c: String(pendingDeclarations.value.length), l: "待报关" },
    { c: String(stock.value.length), l: "在库批次" },
    { c: String(salesOrders.value.length), l: "分销订单" },
    { c: String(openRecon.value.length), l: "待对账" },
  ]);
  const briefing = computed<BriefingBlock[]>(() => {
    const done = executedActions.value.slice(0, 5).map((a) => `${a.title}：${a.detail}`);
    const todo = reviewTasks.value
      .filter((t) => t.status === "pending" || t.status === "in_review")
      .sort((a, b) => (b.hardGate ? 1 : 0) - (a.hardGate ? 1 : 0))
      .slice(0, 6)
      .map((t) => `${t.hardGate ? "★ " : ""}${t.title}`);
    const risk: string[] = [];
    pendingHardGates.value.forEach((t) => risk.push(`硬闸：${t.title}`));
    nearExpiryLots.value.forEach((l) => risk.push(`临期：${l.name} 效期 ${l.expiry}（现货 ${l.qty} 瓶）`));
    openRecon.value.filter((r) => r.status === "未达").forEach((r) => risk.push(`未达账项：${r.item} ${r.amount}`));
    return [
      { k: "昨日完成", items: done.length ? done : ["暂无已执行动作 —— 在各模块跑 AI 或到审核看板核准后，这里会自动记录"] },
      { k: "今日待办", items: todo.length ? todo : ["无待审任务，链路运转正常"] },
      { k: "风险预警", items: risk.length ? risk : ["无风险项"] },
    ];
  });
  /** 经营趋势（需历史序列，当前无历史库，保留为示例趋势并在界面标注）。 */
  const trends = ref<Trend[]>(seed.seedTrends());

  /* ══════════ 控制台 / run-status ══════════ */
  const consoleLines = ref<ConsoleLine[]>([]);
  const runStatus = ref<string>("");
  const busy = computed(() => running.value);
  const activeMod = ref<ModId>("m0");

  /* ══════════ 导航（左侧栏 ⇄ 工作区共享） ══════════ */
  // 当前视图：某模块 id 或 'review'（审核看板）。原来私有于 TradeModule，
  // 现在提到 store，让并入 SideNav 的外贸导航与中间工作区同步驱动同一份状态。
  const view = ref<ModId | "review">("m0");
  function go(id: ModId | "review") {
    view.value = id;
    if (id !== "review") activeMod.value = id;
  }

  function log(kind: ConsoleLine["kind"], text: string) {
    consoleLines.value.push({ kind, text, at: Date.now() });
    if (consoleLines.value.length > 400) consoleLines.value.splice(0, consoleLines.value.length - 400);
  }
  function clearConsole() {
    consoleLines.value = [];
    runStatus.value = "";
  }
  function addRun(r: Omit<AgentRun, "id" | "at">) {
    runs.value.unshift({ id: uid("run"), at: Date.now(), ...r });
    if (runs.value.length > 60) runs.value.length = 60;
    lsSave(LS.runs, runs.value);
  }
  function makeCallbacks(toolSink?: AgentRun["tools"]) {
    return {
      onDelta: (text: string) => {
        if (text.trim()) log("text", text);
      },
      onTool: (tool: string, detail?: string) => {
        log("tool", `${tool}${detail ? " · " + detail : ""}`);
        toolSink?.push({ tool, detail, at: Date.now() });
      },
    };
  }

  /* ══════════ 人工审核流水线 ══════════ */
  function saveReviews() {
    lsSave(LS.reviews, reviewTasks.value);
  }
  /** 记一条「已执行动作」台账（核准即执行的证据）。 */
  function recordAction(a: Omit<ExecutedAction, "id" | "at">) {
    executedActions.value.unshift({ id: uid("act"), at: Date.now(), ...a });
    if (executedActions.value.length > 200) executedActions.value.length = 200;
    lsSave(LS.executed, executedActions.value);
  }
  /** 派单进流水线（去重：同 kind+refId 未决则刷新为最新提案）。 */
  function enqueueReview(t: Omit<ReviewTask, "id" | "status" | "createdAt">): ReviewTask | null {
    const dup = reviewTasks.value.find(
      (x) => x.kind === t.kind && x.refId === t.refId && (x.status === "pending" || x.status === "in_review")
    );
    if (dup) {
      // 同一业务对象重复入闸：刷新为最新提案，防止「新报价/新数量被静默丢弃、批准时按旧 payload 生成订单」。
      dup.title = t.title;
      dup.summary = t.summary;
      dup.facts = t.facts;
      dup.risk = t.risk;
      dup.hardGate = t.hardGate;
      dup.payload = t.payload;
      dup.origin = t.origin;
      dup.createdAt = Date.now();
      saveReviews();
      log("info", `审核任务已刷新为最新提案：${dup.title}`);
      return dup;
    }
    const task: ReviewTask = { id: uid("rv"), status: "pending", createdAt: Date.now(), ...t };
    reviewTasks.value.unshift(task);
    saveReviews();
    log("info", `新审核任务入列：${task.title}`);
    return task;
  }
  /** 对账候选是否为真实匹配对象：排除空串与「未找到候选/无匹配/—」等伪候选占位，防假闭合。 */
  function isRealReconTarget(s: unknown): boolean {
    const t = String(s || "").trim();
    return !!t && !/未找到|无候选|无匹配|待匹配|待定|none|no\s*match|n\/a|^[-—－]+$/i.test(t);
  }
  /** HS 编码格式合法（4 位大类 + 1~3 段两位子目，如 2204.21 / 2204.21.00）。 */
  function isValidHsCode(s: unknown): boolean {
    return /^\d{4}(\.\d{2}){1,3}$/.test(String(s || "").trim());
  }
  /** 报关单每个行项目都有合法 HS 且行非空 —— 放行前置条件（缺 HS/非法 HS 不得报关放行）。 */
  function hsLinesValid(d: { lines?: { hs?: string }[] }): boolean {
    return Array.isArray(d.lines) && d.lines.length > 0 && d.lines.every((l) => isValidHsCode(l.hs));
  }
  function claimReview(id: string) {
    const t = reviewTasks.value.find((x) => x.id === id);
    if (t && t.status === "pending") {
      t.status = "in_review";
      saveReviews();
    }
  }
  function approveReview(id: string, note?: string) {
    const t = reviewTasks.value.find((x) => x.id === id);
    // 幂等守卫：已决任务再 approve 会二次回写（重复台账/重复置已匹配），与 ERP 侧口径一致。
    if (!t || (t.status !== "pending" && t.status !== "in_review")) return;
    const prev = t.status;
    t.status = "approved";
    t.decidedAt = Date.now();
    t.note = note;
    t.decidedBy = "运营";
    // 回写被 guard 拒绝时回滚，避免「审核显示已通过但账项/业务未落」的状态不一致。
    const ok = onReviewDecided(t, true);
    if (!ok) {
      t.status = prev;
      t.decidedAt = undefined;
      t.decidedBy = undefined;
      saveReviews();
      log("error", `审核未生效：${t.title} 的回写被校验拒绝，卡片退回待审`);
      return;
    }
    saveReviews();
    log("ok", `审核通过：${t.title}`);
  }
  function rejectReview(id: string, note?: string) {
    const t = reviewTasks.value.find((x) => x.id === id);
    if (!t || (t.status !== "pending" && t.status !== "in_review")) return;
    t.status = "rejected";
    t.decidedAt = Date.now();
    t.note = note;
    t.decidedBy = "运营";
    onReviewDecided(t, false);
    saveReviews();
    log("error", `审核驳回：${t.title}${note ? " · " + note : ""}`);
    // 驳回自动带批注重跑：AI 产出类任务被驳回后，用批注作反馈重新生成并重新入闸（闭环，不再死胡同）。
    if (!t.reran && RERUNNABLE.has(t.kind)) void rerunFromReject(t, note);
  }

  /** 可「驳回自动重跑」的 AI 产出类任务。 */
  const RERUNNABLE = new Set<ReviewKind>(["hs-review", "recon-match", "outreach-send", "quote-out"]);
  async function rerunFromReject(t: ReviewTask, note?: string) {
    t.reran = true;
    saveReviews();
    const p = t.payload || {};
    const fb = note && note.trim() ? note.trim() : "上一轮结果被人工驳回，请重新核验并改进。";
    log("info", `↻ 按驳回批注自动重跑：${t.title}`);
    try {
      if (t.kind === "hs-review" && p.decId) await runHsClassify(String(p.decId), fb);
      else if (t.kind === "recon-match" && p.item) await runRecon(String(p.item), fb);
      else if (t.kind === "outreach-send" && p.leadId) await runOutreach(String(p.leadId), String(p.lang || "en"), fb);
      else if (t.kind === "quote-out" && p.customer) await runQuoteOut(String(p.customer), String(p.sku || ""), Number(p.taxable) || 0, Number(p.bottles) || 0, fb);
    } catch (e) {
      log("error", `↻ 自动重跑失败：${(e as Error).message}`);
    }
  }
  function resetReview(id: string) {
    const t = reviewTasks.value.find((x) => x.id === id);
    // 只允许重开「已驳回」的卡片：已批准的回写已执行，重开再批会双重执行副作用（与 ERP 口径一致）。
    if (!t || t.status !== "rejected") return;
    // 驳回自动重跑已生成同 kind+refId 的新待审卡时，禁止重开旧卡（否则双待审，批旧卡会用陈旧 payload 重复外发/重复建单）。
    const hasLiveTwin = reviewTasks.value.some(
      (x) => x.id !== t.id && x.kind === t.kind && x.refId === t.refId && (x.status === "pending" || x.status === "in_review")
    );
    if (hasLiveTwin) {
      log("info", `↻ ${t.title} 已有更新的待审卡片，旧卡不重开`);
      return;
    }
    {
      t.status = "pending";
      t.decidedAt = undefined;
      t.reran = false;
      saveReviews();
    }
  }

  /**
   * 审核结论回写业务对象（把闸的效果真正落到数据上）——「核准即执行」。
   * 13 种 kind 全部有回写分支；核准成功后记一条 executedAction 台账。
   * 返回是否成功回写：批准遇 guard 拒绝返回 false（供 approveReview 回滚卡片），驳回恒 true。
   */
  function onReviewDecided(t: ReviewTask, approved: boolean): boolean {
    const p = t.payload || {};
    switch (t.kind) {
      /* ── M4 报关草稿确认（闸1）：核准→放行+推进流程 ── */
      case "customs-draft": {
        const d = t.refId ? declarations.value.find((x) => x.id === t.refId) : null;
        if (d) {
          // 放行前复核硬差异：草稿卡在待审期间若三单出现硬差异（severity==="hard"），不得走普通闸放行，
          // 须先修正三单或走硬差异裁决硬闸，否则会带硬差异违规放行报关。
          if (approved && d.checks.some((c) => c.severity === "hard")) {
            log("error", `报关放行拒绝：货柜 ${d.id} 现存三单硬差异，须先修正三单或走硬差异裁决闸`);
            return false;
          }
          // HS 归类完整性：每个行项目必须有合法 HS 编码（数字.数字格式），缺 HS/非法 HS 不得放行，否则申报虚假归类。
          if (approved && !hsLinesValid(d)) {
            log("error", `报关放行拒绝：货柜 ${d.id} 存在缺 HS 或非法 HS 的行项目，须先完成 HS 归类`);
            return false;
          }
          d.status = approved ? "released" : "draft";
          if (approved) {
            const s5 = customsFlow.value.find((s) => s.n === 5);
            if (s5) s5.state = "done";
            const s6 = customsFlow.value.find((s) => s.n === 6);
            if (s6) s6.state = "active";
            recordAction({ mod: "m4", kind: t.kind, refId: d.id, by: "human", title: `报关放行 · 货柜 ${d.id}`, detail: `报关草稿核准，状态置「已放行」，进入导出交报关行（PDF+EDI）。` });
          }
          saveDeclarations();
          saveCustomsFlow();
        }
        break;
      }
      /* ── M4 三单硬差异（硬闸）：核准=人工裁决放行；驳回=退回修正三单 ── */
      case "doc-consistency": {
        const d = t.refId ? declarations.value.find((x) => x.id === t.refId) : null;
        if (d) {
          if (approved) {
            // 硬差异可人工裁决接受，但 HS 归类完整性是独立的报关合规前置：缺 HS/非法 HS 仍不得放行（即使裁决硬差异）。
            if (!hsLinesValid(d)) {
              log("error", `硬差异裁决放行拒绝：货柜 ${d.id} 存在缺 HS 或非法 HS 的行项目，须先完成 HS 归类`);
              return false;
            }
            d.status = "released";
            const s5 = customsFlow.value.find((s) => s.n === 5);
            if (s5) s5.state = "done";
            const s6 = customsFlow.value.find((s) => s.n === 6);
            if (s6) s6.state = "active";
            recordAction({ mod: "m4", kind: t.kind, refId: d.id, by: "human", title: `硬差异裁决放行 · 货柜 ${d.id}`, detail: `三单硬差异经人工裁决接受，放行导出（已留痕，可追责）。` });
          } else {
            d.status = "draft";
          }
          saveDeclarations();
          saveCustomsFlow();
        }
        break;
      }
      /* ── M4 HS 归类复核：独立闸，只回写归类完成度 ── */
      case "hs-review": {
        const d = t.refId ? declarations.value.find((x) => x.id === t.refId) : null;
        if (d && approved) {
          d.hsComplete = 100;
          saveDeclarations();
          recordAction({ mod: "m4", kind: t.kind, refId: d.id, by: "human", title: `HS 归类核准 · 货柜 ${d.id}`, detail: `HS 归类经人工复核确认，归类完成度置 100%。` });
        }
        break;
      }
      /* ── M1 选品入库：核准→建 SKU 主数据（stocked）；驳回→退回候选 ── */
      case "sku-intake": {
        const s = t.refId ? skus.value.find((x) => x.id === t.refId) : null;
        if (s) {
          s.state = approved ? "stocked" : "candidate";
          saveSkus();
          if (approved) recordAction({ mod: "m1", kind: t.kind, refId: s.id, by: "human", title: `选品入库 · ${s.name}`, detail: `候选核准入库，建立 SKU 主数据（${s.region} · ${s.priceBand}）。` });
        }
        break;
      }
      /* ── M9 缺证放行（硬闸）：核准→可放行；驳回→维持拦发货 ── */
      case "compliance-release": {
        const c = t.refId ? compliance.value.find((x) => x.container === t.refId) : null;
        if (c) {
          c.ok = approved;
          c.release = approved ? "可放行" : "缺证拦发货";
          lsSave(LS.compliance, compliance.value);
          if (approved) recordAction({ mod: "m9", kind: t.kind, refId: c.container, by: "human", title: `合规放行 · 货柜 ${c.container}`, detail: `缺证情形经人工核准放行（硬闸，已留痕）。` });
        }
        break;
      }
      /* ── M2 线索转供应商：核准→push 进 M3 公海 ── */
      case "lead-convert": {
        const l = t.refId ? leads.value.find((x) => x.id === t.refId) : null;
        if (l && approved && !suppliers.value.find((s) => s.name === l.company)) {
          suppliers.value.push({ name: l.company, country: l.country, cat: l.category, onTime: 0, price: 0, quality: 0, composite: 0, grade: "—", tag: "新建联" });
          lsSave(LS.suppliers, suppliers.value);
          recordAction({ mod: "m2", kind: t.kind, refId: l.id, by: "human", title: `转正式供应商 · ${l.company}`, detail: `有意向线索转入 M3 供应商公海，进入比价评分。` });
        }
        break;
      }
      /* ── M2 开发信外发：核准→写入往来线程并置「已建联」 ── */
      case "outreach-send": {
        const l = t.refId ? leads.value.find((x) => x.id === t.refId) : null;
        if (l && approved) {
          const body = String(p.body || (l.drafts && l.drafts[String(p.lang || "en")]) || "（开发信正文）");
          const stamp = fmtStamp();
          l.thread.push({ dir: "out", who: "我方 · Orca Imports", at: stamp, text: body });
          if (l.status === "new") l.status = "contacted";
          saveLeads();
          recordAction({ mod: "m2", kind: t.kind, refId: l.id, by: "human", title: `开发信外发 · ${l.company}`, detail: `个性化开发信经核准外发，已写入往来线程，状态置「已建联」。` });
        }
        break;
      }
      /* ── M8 对账匹配确认：核准→置「已匹配」 ── */
      case "recon-match": {
        const r = t.refId ? recon.value.find((x) => x.item === t.refId) : null;
        if (r && approved) {
          // 脏卡兜底：只有「待确认」且带真实候选（非「未找到候选」占位）的账项能闭合，防未达/无候选行被批准假闭合为「已匹配」。
          if (r.status !== "待确认" || !isRealReconTarget(r.match)) {
            log("error", `对账回写拒绝：${r.item} 状态非待确认或无有效候选（match「${r.match}」/状态「${r.status}」）`);
            return false;
          }
          r.status = "已匹配";
          lsSave(LS.recon, recon.value);
          recordAction({ mod: "m8", kind: t.kind, refId: r.item, by: "human", title: `对账匹配 · ${r.item}`, detail: `候选匹配 ${r.match} 经核准回写，账项置「已匹配」。` });
        }
        break;
      }
      /* ── M3 询价群发：核准→记录已外发 N 家（真实、持久，M3 读台账显示） ── */
      case "rfq-send": {
        if (approved) {
          const targets = Array.isArray(p.targets) ? (p.targets as string[]) : [];
          recordAction({ mod: "m3", kind: t.kind, refId: t.refId, by: "human", title: `询价群发 · ${targets.length || "多"} 家`, detail: `比价询价经核准外发给：${targets.join("、") || "在评供应商"}；等待回价后自动结构化抽取。` });
        }
        break;
      }
      /* ── M3 报价回写：核准→回写采购并自动生成 M4 报关草稿（M3→M4 接通） ── */
      case "quote-writeback": {
        if (approved) {
          // 数量/单价/供应商/货品必须齐备且正：脏 payload 用业务默认值(3000/5)兜底会生成虚假 FOB/CIF/WET/GST 报关数据。
          const qty = Number(p.qty), unit = Number(p.unit);
          const supplier = String(p.supplier || "").trim(), goods = String(p.goods || "").trim();
          // 瓶数须为正整数（酒按瓶报关，无半瓶），单价有限正数，供应商/货品非空。
          if (!Number.isInteger(qty) || qty <= 0 || !Number.isFinite(unit) || unit <= 0 || !supplier || !goods) {
            log("error", `报价回写拒绝：数量/单价/供应商/货品非法（qty=${p.qty} unit=${p.unit} supplier「${p.supplier}」goods「${p.goods}」）`);
            return false;
          }
          const decId = createDeclarationDraftFromQuote({ supplier, goods, qty, unit, origin: String(p.origin || ""), currency: String(p.currency || "AUD") });
          recordAction({ mod: "m3", kind: t.kind, refId: t.refId, by: "human", title: `采购回写 · ${supplier}`, detail: `报价核准回写采购单，并自动生成报关草稿（货柜 ${decId}），已进 M4 待归类。` });
        }
        break;
      }
      /* ── M7 报价单外发：核准→生成销售订单（报价已发） ── */
      case "quote-out": {
        if (approved) {
          // 含税金额必须为有限正数、客户/明细非空：脏 payload 会生成 incl=0 或负数的销售订单。
          const incl = Number(p.incl);
          const customer = String(p.customer || "").trim();
          const lines = String(p.lines || "").trim();
          if (!Number.isFinite(incl) || incl <= 0 || !customer || !lines) {
            log("error", `报价外发拒绝：含税额/客户/明细非法（incl=${p.incl} customer「${p.customer}」lines「${p.lines}」）`);
            return false;
          }
          const soId = createSalesOrder(customer, lines, incl);
          recordAction({ mod: "m7", kind: t.kind, refId: t.refId, by: "human", title: `报价外发 · ${customer}`, detail: `含税报价经核准外发，生成销售订单 ${soId}（状态：报价已发）。` });
        }
        break;
      }
      /* ── M5 物流异常：核准→写入异常里程碑并更新状态 ── */
      case "milestone-anomaly": {
        const sh = t.refId ? shipments.value.find((x) => x.id === t.refId) : null;
        if (sh && approved) {
          sh.milestones.push({ t: `异常已确认：${String(p.anomaly || t.summary).slice(0, 24)}`, at: fmtStamp(), done: true });
          sh.demurrage = "高";
          lsSave(LS.shipments, shipments.value);
          recordAction({ mod: "m5", kind: t.kind, refId: sh.id, by: "human", title: `物流异常确认 · 货柜 ${sh.id}`, detail: `异常里程碑经核准写入时间线，滞期风险升级为「高」。` });
        }
        break;
      }
      /* ── M6 补货确认：核准→标记已下单并回流 M3 生成询价 ── */
      case "replenish": {
        const rs = t.refId ? replenish.value.find((x) => x.sku === t.refId) : null;
        if (rs && approved) {
          rs.ordered = true;
          lsSave(LS.replenish, replenish.value);
          recordAction({ mod: "m6", kind: t.kind, refId: rs.sku, by: "human", title: `补货核准 · ${rs.name}`, detail: `补货 ${rs.qty} 瓶经核准，回流 M3 生成采购询价（${rs.by}）。` });
        }
        break;
      }
      default:
        break;
    }
    return true;
  }

  /** 时间戳（MM-DD HH:MM，用于线程/里程碑）。 */
  function fmtStamp(): string {
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }

  /** 生成不与现有 id 冲突的短 id（Date 秒级基数 + 冲突时自增，防同毫秒碰撞）。 */
  function shortId(prefix: string, taken: (id: string) => boolean): string {
    let base = Number(String(Date.now()).slice(-4));
    let id = prefix + base;
    while (taken(id)) { base = (base + 1) % 10000; id = prefix + base; }
    return id;
  }

  /** M3→M4：由核准的采购报价自动生成一张报关草稿（待归类）。
   *  供应商可能以外币（USD/EUR）报价，报关完税价须折算为 AUD，否则 FOB/CIF/WET/GST 全线口径错。 */
  function createDeclarationDraftFromQuote(q: { supplier: string; goods: string; qty: number; unit: number; origin: string; currency?: string }): string {
    const id = shortId("N", (x) => declarations.value.some((d) => d.id === x));
    const qty = q.qty > 0 ? q.qty : 3000;
    const unit = q.unit > 0 ? q.unit : 5;
    // 单价按报价币种折 AUD 后再计 FOB（报关完税价单点真相为 AUD）。
    const unitAud = toAud(unit, String(q.currency || "AUD"));
    const fob = Math.round(qty * unitAud);
    const freight = Math.round(fob * 0.08);
    const insurance = Math.round(fob * 0.01);
    const cif = fob + freight + insurance;
    const tax = computeWineTax(cif);
    const origin = q.origin || "智利";
    const dec: CustomsDeclaration = {
      id, po: "PO-NEW-" + id, supplier: q.supplier, goods: q.goods, type: "import",
      terms: "FOB", currency: "AUD", fob, freight, insurance, cif,
      origin, dispatch: origin, destPort: "Sydney", bl: "", container: id,
      packages: Math.max(1, Math.round(qty / 12)), grossWt: Math.round(qty * 1.5), netWt: Math.round(qty * 1.4),
      agreement: "—", coCertNo: "", duty: 0, wet: tax.wet, gst: tax.gst,
      status: "draft", fillRate: 60, hsComplete: 0, checkStatus: "pass",
      lines: [{ sku: "SKU-NEW", desc: q.goods, hs: "", hsConf: 0, uom: "升/瓶(750ml)", uomConf: 90, qty, unit: unitAud, amount: fob, origin: origin.slice(0, 2).toUpperCase(), dutyRate: "待归类", dutyConf: 0 }],
      checks: [{ field: "品名", severity: "pass", decl: q.goods, inv: q.goods, pack: q.goods, bl: "—" }],
    };
    declarations.value.unshift(dec);
    saveDeclarations();
    return id;
  }

  /** M5→M6：确认到港 → 开 GRN 收货单，货物入 M6 厂仓（真实链路，替代文字承诺）。 */
  function receiveArrival(shipmentId: string): string | null {
    const sh = shipments.value.find((s) => s.id === shipmentId);
    if (!sh || /入仓/.test(sh.status)) return null;
    // 清关合规前置（红线）：同柜报关须已放行、合规无缺证，否则不得开 GRN 入仓——
    // 未清关入仓＝违规提货，绕过 M4 报关放行闸与 M9 缺证硬闸。
    const dec = declarations.value.find((d) => d.id === shipmentId || d.container === shipmentId);
    if (dec && dec.status !== "released") {
      log("error", `货柜 ${shipmentId} 报关未放行（当前「${dec.status}」），不能开 GRN 入仓 —— 先在 M4 完成报关放行`);
      return null;
    }
    const comp = compliance.value.find((c) => c.container === shipmentId);
    if (comp && !comp.ok) {
      log("error", `货柜 ${shipmentId} 合规未过（缺证/放行未就绪），不能开 GRN 入仓 —— 先在 M9 完成缺证放行`);
      return null;
    }
    sh.status = "已入仓";
    sh.pct = 100;
    sh.milestones.forEach((m) => (m.now = false));
    sh.milestones.push({ t: "清关放行", at: fmtStamp(), done: true }, { t: "派送入仓 · 开 GRN", at: fmtStamp(), done: true, now: true });
    lsSave(LS.shipments, shipments.value);
    const skuCode = "SKU-" + shipmentId;
    if (!stock.value.some((l) => l.batch === "GRN-" + shipmentId)) {
      stock.value.unshift({ sku: skuCode, name: sh.goods, batch: "GRN-" + shipmentId, qty: 0, expiry: "待收货计数", fefo: stock.value.length, landed: 0 });
      lsSave(LS.stock, stock.value);
    }
    recordAction({ mod: "m5", kind: "grn-open", refId: shipmentId, by: "human", title: `到港开 GRN · 货柜 ${shipmentId}`, detail: `货柜到港确认，生成收货单 GRN，${sh.goods} 入 M6 厂仓待上架与落地成本归集。` });
    return skuCode;
  }

  /** M7：由核准的报价生成一张销售订单（报价已发）。 */
  function createSalesOrder(customer: string, lines: string, incl: number): string {
    const id = shortId("SO-", (x) => salesOrders.value.some((s) => s.id === x));
    salesOrders.value.unshift({ id, customer, lines, incl: round2(incl), status: "报价已发" });
    lsSave(LS.salesOrders, salesOrders.value);
    return id;
  }

  /** M1→M2：把选品候选提升为真实的 M2 供应商线索（进线索池）。 */
  function promoteSkuToLead(sku: SkuCandidate): SupplierLead | null {
    if (leads.value.some((l) => l.company === sku.name)) {
      sku.state = "lead";
      saveSkus();
      return null;
    }
    const lead: SupplierLead = {
      id: uid("L"), company: sku.name, country: (sku.region.split(/[ /·]/)[0] || "—").trim(), region: sku.region,
      category: sku.certs && sku.certs !== "—" ? `${sku.certs} · 葡萄酒` : "进口葡萄酒",
      website: "", email: "", contact: "", source: "sourcing",
      grade: sku.conf >= 80 ? "A" : sku.conf >= 65 ? "B" : "C", score: sku.conf, status: "new",
      profile: { 主营品类: sku.name, 认证: sku.certs || "—", 产区匹配度: sku.region },
      confs: { 认证: sku.conf }, replyClass: null, thread: [],
    };
    leads.value.unshift(lead);
    saveLeads();
    sku.state = "lead";
    saveSkus();
    recordAction({ mod: "m1", kind: "sku-to-lead", refId: sku.id, by: "human", title: `选品转建联 · ${sku.name}`, detail: `候选并入 M2 供应商线索池（等级 ${lead.grade} · ${lead.score} 分），可发破冰开发信。` });
    return lead;
  }

  const reviewByStatus = (s: ReviewStatus) => computed(() => reviewTasks.value.filter((t) => t.status === s));
  const pendingCount = computed(() => reviewTasks.value.filter((t) => t.status === "pending" || t.status === "in_review").length);
  const reviewColumns = computed(() => ({
    pending: reviewTasks.value.filter((t) => t.status === "pending"),
    in_review: reviewTasks.value.filter((t) => t.status === "in_review"),
    approved: reviewTasks.value.filter((t) => t.status === "approved"),
    rejected: reviewTasks.value.filter((t) => t.status === "rejected"),
  }));

  /* ══════════ 持久化保存 ══════════ */
  function saveDeclarations() { lsSave(LS.declarations, declarations.value); }
  function saveCustomsFlow() { lsSave(LS.customsFlow, customsFlow.value); }
  function saveLeads() { lsSave(LS.leads, leads.value); }
  function saveSkus() { lsSave(LS.skus, skus.value); }

  /* ══════════ 初始化 ══════════ */
  function load() {
    leads.value = lsLoad(LS.leads, seed.seedLeads());
    declarations.value = lsLoad(LS.declarations, seed.seedDeclarations());
    customsFlow.value = lsLoad(LS.customsFlow, seed.seedCustomsFlow());
    shipments.value = lsLoad(LS.shipments, seed.seedShipments());
    suppliers.value = lsLoad(LS.suppliers, seed.seedSuppliers());
    skus.value = lsLoad(LS.skus, seed.seedSkus());
    stock.value = lsLoad(LS.stock, seed.seedStock());
    replenish.value = lsLoad(LS.replenish, seed.seedReplenish());
    customers.value = lsLoad(LS.customers, seed.seedCustomers());
    salesOrders.value = lsLoad(LS.salesOrders, seed.seedSalesOrders());
    recon.value = lsLoad(LS.recon, seed.seedRecon());
    compliance.value = lsLoad(LS.compliance, seed.seedCompliance());
    workflows.value = lsLoad(LS.workflows, seed.seedWorkflows());
    kb.value = lsLoad(LS.kb, seed.seedKb());
    runs.value = lsLoad(LS.runs, []);
    reviewTasks.value = lsLoad(LS.reviews, []);
    executedActions.value = lsLoad(LS.executed, []);
    const seeded = lsLoad<boolean>(LS.seeded, false);
    if (!seeded) {
      seedInitialReviews();
      lsSave(LS.seeded, true);
    }
  }

  /** 首次载入：把 PRD 里既有的人工闸铺进流水线，看板开箱即有内容。 */
  function seedInitialReviews() {
    const initial: Omit<ReviewTask, "id" | "status" | "createdAt">[] = [
      {
        mod: "m4", kind: "customs-draft", title: "货柜 0617 报关草稿确认", refId: "0617",
        summary: "Shiraz 2021 · 报关草稿填充率 92%，1 项软差异（毛重差 20kg）待确认后导出交报关行。",
        facts: [
          { k: "完税价格 CIF", v: "AUD 74,304" },
          { k: "WET+GST", v: "AUD 31,133.38" },
          { k: "HS 归类", v: "2204.21.00 · 置信 94%" },
          { k: "三单校验", v: "1 软差异（毛重）", warn: true },
        ],
        risk: "high",
      },
      {
        mod: "m4", kind: "doc-consistency", title: "货柜 0625 三单硬差异拦截", refId: "0625",
        summary: "发票金额 40,100 与报关 41,000 不一致（硬差异），且缺 HS 归类 —— 硬闸，拦截导出。",
        facts: [
          { k: "硬差异", v: "总金额 41,000 vs 40,100", warn: true },
          { k: "HS 归类", v: "缺失（Chardonnay 未归类）", warn: true },
        ],
        risk: "hard", hardGate: true,
      },
      {
        mod: "m9", kind: "compliance-release", title: "货柜 0625 缺证放行核准", refId: "0625",
        summary: "Chardonnay 2023 缺英文背标（FSANZ），Biosecurity 待申报 —— 缺证拦发货，需人工核准放行。",
        facts: [
          { k: "FSANZ 标签", v: "缺英文背标", warn: true },
          { k: "Biosecurity", v: "待申报", warn: true },
        ],
        risk: "hard", hardGate: true,
      },
      {
        mod: "m2", kind: "lead-convert", title: "Viña Aurora 转正式供应商", refId: "L-2201",
        summary: "智利 Viña Aurora 回信索样、FOB 约 USD 4.20/瓶，意向『索样』，建议转入供应商公海进 M3 比价。",
        facts: [
          { k: "意向", v: "索样 / 报价 USD 4.20 FOB" },
          { k: "建联优先级", v: "A · 86 分" },
        ],
        risk: "normal",
      },
      {
        mod: "m8", kind: "recon-match", title: "货代账单 INV-FRT-0617 匹配确认", refId: "货代账单 INV-FRT-0617",
        summary: "AUD 6,900 匹配落地成本凭证 LCV-0617，AI 置信 96%，需人工确认回写。",
        facts: [
          { k: "金额", v: "AUD 6,900" },
          { k: "候选匹配", v: "LCV-0617 · 置信 96%" },
        ],
        risk: "normal",
      },
      {
        mod: "m6", kind: "replenish", title: "Chardonnay 2023 补货建议确认", refId: "SKU-CHRD-23",
        summary: "效期 2025-11 临期 + 现货仅 640，建议本周补 2,400 瓶，需人工确认下单。",
        facts: [
          { k: "建议量", v: "2,400 瓶" },
          { k: "触发", v: "临期 + 低库存", warn: true },
        ],
        risk: "high",
      },
    ];
    initial.forEach((t) => enqueueReview(t));
  }

  function resetAll() {
    Object.values(LS).forEach((k) => localStorage.removeItem(k));
    load();
  }

  /* ══════════ Claude 驱动动作 ══════════ */

  /**
   * 通用对话（对话坞）。
   * hooks 让调用方（对话气泡）拿到实时流式增量与工具调用；同时仍写 Console（双通道）。
   * signal 支持「停止生成」。
   */
  async function runChat(
    modName: string,
    modSub: string,
    text: string,
    useKb: boolean,
    hooks?: {
      onDelta?: (delta: string, full: string) => void;
      onTool?: (tool: string, detail?: string) => void;
      signal?: AbortSignal;
    }
  ): Promise<string> {
    const toolSink: AgentRun["tools"] = [];
    const base = makeCallbacks(toolSink);
    const res = await run({
      prompt: P.promptChat(modName, modSub, text),
      useKb,
      signal: hooks?.signal,
      onDelta: (delta: string, full: string) => {
        base.onDelta(delta);
        hooks?.onDelta?.(delta, full);
      },
      onTool: (tool: string, detail?: string) => {
        base.onTool(tool, detail);
        hooks?.onTool?.(tool, detail);
      },
    });
    addRun({ mod: activeMod.value, kind: "chat", inputSummary: text.slice(0, 40), resultSummary: res.raw.slice(0, 40), tools: toolSink });
    return res.raw;
  }

  /** M1 选品采集。 */
  async function runSourcing(criteria: { keywords: string; region: string; category: string; limit: number }): Promise<number> {
    clearConsole();
    runStatus.value = "采集中…";
    log("info", `选品采集：${criteria.keywords || "默认条件"}`);
    const toolSink: AgentRun["tools"] = [];
    try {
      const { data } = await runJson<{ skus: SkuCandidate[] }>({
        prompt: P.promptSourcing(criteria), goal: "采集候选 SKU 并结构化", useKb: true, ...makeCallbacks(toolSink),
      });
      const list = Array.isArray(data?.skus) ? data.skus : [];
      list.forEach((s) => skus.value.unshift({ ...s, id: uid("sku"), provenance: "ai", state: "candidate" }));
      saveSkus();
      addRun({ mod: "m1", kind: "collect", inputSummary: criteria.keywords, resultSummary: `采集 ${list.length} 个候选`, tools: toolSink });
      runStatus.value = `采集完成，新增 ${list.length} 个`;
      log("ok", runStatus.value);
      return list.length;
    } catch (e) {
      runStatus.value = `采集失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return 0;
    }
  }

  /** M2 建联：生成个性化开发信（进人工闸：外发核准）。feedback 用于驳回后带批注重跑。 */
  async function runOutreach(leadId: string, lang: string, feedback?: string): Promise<string | null> {
    const l = leads.value.find((x) => x.id === leadId);
    if (!l) return null;
    runStatus.value = `写开发信 @${l.company}…`;
    log("info", `生成 ${lang} 开发信 · ${l.company}`);
    const toolSink: AgentRun["tools"] = [];
    try {
      const res = await run({ prompt: P.promptOutreach(l, lang, feedback), useKb: true, ...makeCallbacks(toolSink) });
      if (!l.drafts) l.drafts = {};
      l.drafts[lang] = res.raw.trim();
      saveLeads();
      addRun({ mod: "m2", kind: "outreach", inputSummary: `${l.company}/${lang}`, resultSummary: "开发信草稿已生成", tools: toolSink });
      enqueueReview({
        mod: "m2", kind: "outreach-send", title: `${l.company} 开发信外发核准`, refId: l.id, origin: "ai",
        summary: `已生成 ${lang} 个性化破冰开发信，需人工预览确认后外发（反骚扰闸）。`,
        facts: [
          { k: "对象", v: `${l.company} · ${l.country}` },
          { k: "语言", v: lang },
          { k: "优先级", v: `${l.grade} · ${l.score}` },
          { k: "反骚扰核验", v: "30 天内无触达记录 · 通过", source: "M2 触达去重" },
        ],
        risk: "normal",
        payload: { leadId: l.id, lang, body: res.raw.trim() },
      });
      runStatus.value = `开发信已生成，入外发核准闸`;
      log("ok", runStatus.value);
      return res.raw.trim();
    } catch (e) {
      runStatus.value = `生成失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return null;
    }
  }

  /** M2 建联：回信意向分类。 */
  async function runReplyClass(leadId: string, replyText: string): Promise<string | null> {
    const l = leads.value.find((x) => x.id === leadId);
    if (!l) return null;
    const toolSink: AgentRun["tools"] = [];
    try {
      const { data } = await runJson<{ replyClass: string; reason: string; conf: number }>({
        prompt: P.promptReplyClass(replyText), useKb: false, ...makeCallbacks(toolSink),
      });
      const ALLOWED_REPLY: ReadonlyArray<NonNullable<SupplierLead["replyClass"]>> = [
        "interested", "sample", "quoted", "rejected", "irrelevant",
      ];
      const cls = ALLOWED_REPLY.find((c) => c === data.replyClass);
      if (!cls) {
        // 模型返回了非法枚举：不改 lead 状态，避免渲染空白徽标 / 阻断后续转化。
        log("error", `意向分类返回非法值「${data.replyClass}」，已忽略未回写`);
        return null;
      }
      // AI 置信不足时不回写意向、不改 lead 状态（否则会以「AI 基本靠猜」的分类解锁「转供应商」流程）——与选品/选路/OCR 口径一致。
      const conf = Number(data.conf);
      if (!Number.isFinite(conf) || conf < 60) {
        log("info", `意向分类置信不足（${data.conf}），需人工判读回信，暂不回写`);
        return null;
      }
      l.replyClass = cls;
      l.status = "replied";
      saveLeads();
      addRun({ mod: "m2", kind: "reply-class", inputSummary: l.company, resultSummary: `意向：${cls}`, tools: toolSink });
      log("ok", `回信意向：${cls}`);
      return cls;
    } catch (e) {
      log("error", `意向分类失败：${(e as Error).message}`);
      return null;
    }
  }

  /** M4 报关：HS 归类（低置信进人工闸）。feedback 用于驳回后带批注重跑。 */
  async function runHsClassify(decId: string, feedback?: string): Promise<boolean> {
    const d = declarations.value.find((x) => x.id === decId);
    if (!d) return false;
    runStatus.value = `HS 归类 · 货柜 ${d.id}…`;
    log("info", `HS 归类 · ${d.goods}`);
    const toolSink: AgentRun["tools"] = [];
    try {
      const { data } = await runJson<{ hsCode: string; reasoning: string; dutyRate: string; hsConf: number; dutyConf: number }>({
        prompt: P.promptHsClassify(d, feedback), useKb: true, ...makeCallbacks(toolSink),
      });
      // AI 输出不可信：模型漏字段/给非法 HS（如 "abc"）时不得把已有的好数据覆盖成 0/空。
      // 只有拿到「格式合法」的 hsCode 才更新归类字段，且各置信度用 ?? 而非 ||（0 是合法值，缺失才回退）。
      const hsOk = isValidHsCode(data.hsCode);
      if (!hsOk) {
        runStatus.value = `HS 归类：AI 未返回合法编码（${String(data.hsCode)}），保留原值未改动`;
        log("error", runStatus.value);
        addRun({ mod: "m4", kind: "hs-classify", inputSummary: d.goods, resultSummary: `AI 输出 HS 非法「${String(data.hsCode)}」，已忽略`, tools: toolSink });
        return false;
      }
      if (d.lines[0]) {
        d.lines[0].hs = data.hsCode;
        if (Number.isFinite(Number(data.hsConf))) d.lines[0].hsConf = Number(data.hsConf);
        if (data.dutyRate) d.lines[0].dutyRate = data.dutyRate;
        if (Number.isFinite(Number(data.dutyConf))) d.lines[0].dutyConf = Number(data.dutyConf);
      }
      d.hsComplete = hsLinesValid(d) ? 100 : d.hsComplete;
      saveDeclarations();
      addRun({ mod: "m4", kind: "hs-classify", inputSummary: d.goods, resultSummary: `${data.hsCode} · ${data.hsConf}%`, tools: toolSink });
      // 置信分流：<85 转人工闸；≥85 自动放行并留痕（无人化 auto 计入无人化仪表）。
      if ((Number(data.hsConf) || 0) < 85) {
        enqueueReview({
          mod: "m4", kind: "hs-review", title: `货柜 ${d.id} HS 归类复核`, refId: d.id, origin: "ai",
          summary: `HS 归类 ${data.hsCode} 置信 ${data.hsConf}% 低于 85%，转人工复核。`,
          facts: [
            { k: "HS", v: `${data.hsCode} · 置信 ${data.hsConf}%`, warn: true },
            { k: "归类依据", v: (data.reasoning || "").slice(0, 80), source: "澳洲税则 + llmwiki 归类规则" },
          ],
          risk: "high",
          payload: { decId: d.id },
        });
      } else {
        recordAction({ mod: "m4", kind: "hs-classify-auto", refId: d.id, by: "auto", title: `HS 归类自动通过 · 货柜 ${d.id}`, detail: `${data.hsCode} 置信 ${data.hsConf}%（≥85），高置信自动放行，无需人工复核。` });
      }
      runStatus.value = `HS 归类：${data.hsCode}（${data.hsConf}%）`;
      log("ok", runStatus.value);
      return true;
    } catch (e) {
      runStatus.value = `归类失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return false;
    }
  }

  /** M4 报关：把某柜草稿推进人工确认闸。 */
  function submitCustomsDraft(decId: string) {
    const d = declarations.value.find((x) => x.id === decId);
    if (!d) return;
    // 已放行的报关单不再入确认闸：否则可重复提交、重复放行、重复记交报关行台账。
    if (d.status === "released") {
      log("info", `货柜 ${d.id} 已放行，不再重复入报关确认闸`);
      return;
    }
    const hard = d.checks.some((c) => c.severity === "hard");
    enqueueReview({
      mod: "m4", kind: hard ? "doc-consistency" : "customs-draft",
      title: `货柜 ${d.id} 报关草稿确认`, refId: d.id,
      summary: hard
        ? `存在硬差异，硬闸拦截，需先修正三单再导出。`
        : `报关草稿就绪（填充率 ${d.fillRate}%），确认后导出交报关行。`,
      facts: [
        { k: "完税价格", v: `${d.currency} ${d.cif.toLocaleString()}` },
        { k: "WET+GST", v: `${d.currency} ${(d.wet + d.gst).toLocaleString()}` },
        { k: "三单校验", v: hard ? "有硬差异" : d.checkStatus === "soft" ? "1 软差异" : "通过", warn: hard },
      ],
      risk: hard ? "hard" : "high", hardGate: hard,
    });
  }

  /** M8 对账：为未达账项找候选匹配（进人工闸）。feedback 用于驳回后带批注重跑。 */
  async function runRecon(item: string, feedback?: string): Promise<boolean> {
    const r = recon.value.find((x) => x.item === item);
    if (!r) return false;
    runStatus.value = `对账辅助 · ${item}…`;
    const toolSink: AgentRun["tools"] = [];
    try {
      const { data } = await runJson<{ candidates: { target: string; reason: string; conf: number }[] }>({
        prompt: P.promptRecon(r, feedback), useKb: false, ...makeCallbacks(toolSink),
      });
      const top = (data.candidates || [])[0];
      // AI 输出不可信：候选缺 target/伪候选（空串、「未找到候选」占位）时不得覆盖已有匹配、也不入闸假闭合。
      const target = String(top?.target || "").trim();
      if (top && isRealReconTarget(target)) {
        r.match = target;
        r.conf = Number(top.conf) || 0;
        r.status = "待确认";
        lsSave(LS.recon, recon.value);
        enqueueReview({
          mod: "m8", kind: "recon-match", title: `${item} 匹配确认`, refId: item, origin: "ai",
          summary: `AI 候选匹配 ${target}（置信 ${top.conf}%），需人工确认回写。`,
          facts: [
            { k: "金额", v: r.amount },
            { k: "候选匹配", v: `${target} · 置信 ${top.conf}%` },
            { k: "匹配依据", v: (top.reason || "").slice(0, 60), source: "凭证/单据比对" },
          ],
          risk: "normal",
          payload: { item },
        });
      } else {
        log("info", `${item} 未生成有效候选，保留原状态`);
      }
      addRun({ mod: "m8", kind: "recon", inputSummary: item, resultSummary: target || "无候选", tools: toolSink });
      runStatus.value = target ? `对账候选已生成` : `对账完成：无有效候选`;
      log("ok", runStatus.value);
      return true;
    } catch (e) {
      runStatus.value = `对账失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return false;
    }
  }

  /** M9 合规：要件核查。 */
  async function runCompliance(container: string): Promise<boolean> {
    const c = compliance.value.find((x) => x.container === container);
    if (!c) return false;
    const toolSink: AgentRun["tools"] = [];
    try {
      const { data } = await runJson<{ items: { name: string; required: boolean; status: string; basis: string }[]; release: string }>({
        prompt: P.promptCompliance(container, "葡萄酒"), useKb: true, ...makeCallbacks(toolSink),
      });
      addRun({ mod: "m9", kind: "compliance", inputSummary: container, resultSummary: data.release || "", tools: toolSink });
      if (data.release && data.release.includes("拦")) {
        enqueueReview({
          mod: "m9", kind: "compliance-release", title: `货柜 ${container} 缺证放行核准`, refId: container, origin: "ai",
          summary: `合规要件核查存在缺口：${(data.items || []).filter((i) => i.status && i.status.includes("缺")).map((i) => i.name).join("、") || "见明细"}。`,
          facts: (data.items || []).slice(0, 4).map((i) => ({ k: i.name, v: i.status, warn: (i.status || "").includes("缺"), source: i.basis })),
          risk: "hard", hardGate: true,
          payload: { container },
        });
      }
      log("ok", `合规核查完成：${data.release}`);
      return true;
    } catch (e) {
      log("error", `合规核查失败：${(e as Error).message}`);
      return false;
    }
  }

  /** M7 报价：生成对客报价邮件（进外发闸）。feedback 用于驳回后带批注重跑。
   *  taxable = 不含税单价 × 瓶数（总完税价），故 inclTotal 是「含税总额」；
   *  per-瓶单价须除以瓶数 —— 早期把含税总额当成每瓶价写进报价，属实质报价金额错误，已修正。 */
  async function runQuoteOut(customer: string, sku: string, taxable: number, bottles: number, feedback?: string): Promise<string | null> {
    // 瓶数必须为正整数（酒按瓶计价，无半瓶）：非整/非正拒绝生成，避免静默 floor 造成「1 瓶 + 1.5 瓶总额」的错位报价。
    if (!Number.isInteger(bottles) || bottles <= 0) {
      log("error", `报价瓶数非法（${bottles}），须为正整数，已拒绝生成`);
      return null;
    }
    // 完税价必须为有限正数：旧卡重跑缺 taxable 或脏数据会生成 incl=0 的空报价。
    if (!Number.isFinite(taxable) || taxable <= 0) {
      log("error", `报价完税价非法（${taxable}），须为正数，已拒绝生成`);
      return null;
    }
    const tax = computeWineTax(taxable);
    const btl = bottles;
    const inclUnit = round2(tax.inclTotal / btl);
    const qtyLabel = `× ${btl} 瓶`;
    const toolSink: AgentRun["tools"] = [];
    try {
      const res = await run({ prompt: P.promptQuoteOut(customer, sku, btl, inclUnit, tax.inclTotal, feedback), useKb: false, ...makeCallbacks(toolSink) });
      addRun({ mod: "m7", kind: "quote-out", inputSummary: `${customer}/${sku}`, resultSummary: "报价邮件已生成", tools: toolSink });
      enqueueReview({
        mod: "m7", kind: "quote-out", title: `${customer} 报价单外发核准`, refId: `${customer}-${sku}`, origin: "ai",
        summary: `${sku} ${qtyLabel} · 含税单价 AUD ${inclUnit.toFixed(2)}/瓶 · 含税总额 AUD ${tax.inclTotal.toFixed(2)}（WET+GST，与合规中心同一函数），确认后外发。`,
        facts: [
          { k: "含税单价", v: `AUD ${inclUnit.toFixed(2)}/瓶`, source: "computeWineTax 单点真相" },
          { k: "含税总额", v: `AUD ${tax.inclTotal.toFixed(2)}` },
          { k: "WET", v: `AUD ${tax.wet.toFixed(2)}` },
          { k: "GST", v: `AUD ${tax.gst.toFixed(2)}` },
        ],
        risk: "normal",
        payload: { customer, sku, taxable, bottles: btl, incl: tax.inclTotal, inclUnit, lines: `${sku} ${qtyLabel} @ 含税 AUD ${inclUnit.toFixed(2)}/瓶 = AUD ${tax.inclTotal.toFixed(2)}` },
      });
      return res.raw.trim();
    } catch (e) {
      log("error", `报价生成失败：${(e as Error).message}`);
      return null;
    }
  }

  /** M11 知识问答。 */
  async function runKbAsk(question: string): Promise<string> {
    const toolSink: AgentRun["tools"] = [];
    const res = await run({ prompt: P.promptKbAsk(question), useKb: true, ...makeCallbacks(toolSink) });
    addRun({ mod: "m11", kind: "kb-ask", inputSummary: question.slice(0, 40), resultSummary: res.raw.slice(0, 40), tools: toolSink });
    return res.raw;
  }

  load();

  /**
   * 响应式自动落盘 —— 任一业务状态深度变化即持久化，根治「改了 ref 忘调 save」漏存。
   * 在 load() 之后注册，避免初始化赋值触发无意义的首轮写盘。
   */
  function autopersist() {
    const pairs: [{ value: unknown }, string][] = [
      [leads, LS.leads], [declarations, LS.declarations], [customsFlow, LS.customsFlow],
      [shipments, LS.shipments], [suppliers, LS.suppliers], [skus, LS.skus], [stock, LS.stock],
      [replenish, LS.replenish], [customers, LS.customers], [salesOrders, LS.salesOrders],
      [recon, LS.recon], [compliance, LS.compliance], [workflows, LS.workflows], [kb, LS.kb],
      [reviewTasks, LS.reviews], [executedActions, LS.executed], [runs, LS.runs],
    ];
    pairs.forEach(([r, key]) => watch(() => r.value, (v) => lsSave(key, v), { deep: true }));
  }
  autopersist();

  return {
    // state
    leads, outreachFunnel, declarations, customsKpi, customsFlow, shipments, suppliers,
    skus, stock, replenish, customers, salesOrders, recon, compliance, workflows, kb,
    dashKpi, trends, pipeline, briefing,
    reviewTasks, runs, executedActions, consoleLines, runStatus, busy, activeMod,
    // 驾驶舱派生 + 无人化度量
    autonomyStats, pendingHardGates, nearExpiryLots, activeShipments, openRecon,
    // 导航（SideNav ⇄ 工作区共享）
    view, go,
    // review pipeline
    enqueueReview, claimReview, approveReview, rejectReview, resetReview,
    reviewByStatus, reviewColumns, pendingCount, submitCustomsDraft,
    // console
    log, clearConsole,
    // persistence + 链路接通
    saveDeclarations, saveLeads, saveSkus, resetAll, promoteSkuToLead, receiveArrival,
    // claude actions
    runChat, runSourcing, runOutreach, runReplyClass, runHsClassify, runRecon, runCompliance, runQuoteOut, runKbAsk,
  };
}

export function useTradeStore() {
  if (!singleton) singleton = create();
  return singleton;
}
