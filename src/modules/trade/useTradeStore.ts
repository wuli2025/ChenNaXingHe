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
import { ref, computed } from "vue";
import { useAgentRunner } from "../../composables/useAgentRunner";
import type {
  SupplierLead, OutreachFunnelStage, CustomsDeclaration, CustomsKpi, CustomsFlowStep,
  Shipment, Supplier, SkuCandidate, StockLot, ReplenishSuggestion, Customer, SalesOrder,
  ReconMatch, ComplianceRow, WorkflowRun, KbEntry, DashKpi, Trend, PipelineNode, BriefingBlock,
  ConsoleLine, AgentRun, ReviewTask, ReviewKind, ReviewRisk, ReviewStatus, ModId,
} from "./types";
import { LS, computeWineTax } from "./types";
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

  /* 只读派生数据（驾驶舱） */
  const dashKpi = ref<DashKpi[]>(seed.seedDashKpi());
  const trends = ref<Trend[]>(seed.seedTrends());
  const pipeline = ref<PipelineNode[]>(seed.seedPipeline());
  const briefing = ref<BriefingBlock[]>(seed.seedBriefing());

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
        log("tool", `🔧 ${tool}${detail ? " · " + detail : ""}`);
        toolSink?.push({ tool, detail, at: Date.now() });
      },
    };
  }

  /* ══════════ 人工审核流水线 ══════════ */
  function saveReviews() {
    lsSave(LS.reviews, reviewTasks.value);
  }
  /** 派单进流水线（去重：同 kind+refId 未决则不重复入列）。 */
  function enqueueReview(t: Omit<ReviewTask, "id" | "status" | "createdAt">): ReviewTask | null {
    const dup = reviewTasks.value.find(
      (x) => x.kind === t.kind && x.refId === t.refId && (x.status === "pending" || x.status === "in_review")
    );
    if (dup) return dup;
    const task: ReviewTask = { id: uid("rv"), status: "pending", createdAt: Date.now(), ...t };
    reviewTasks.value.unshift(task);
    saveReviews();
    log("info", `📋 新审核任务入列：${task.title}`);
    return task;
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
    if (!t) return;
    t.status = "approved";
    t.decidedAt = Date.now();
    t.note = note;
    t.decidedBy = "运营";
    onReviewDecided(t, true);
    saveReviews();
    log("ok", `✅ 审核通过：${t.title}`);
  }
  function rejectReview(id: string, note?: string) {
    const t = reviewTasks.value.find((x) => x.id === id);
    if (!t) return;
    t.status = "rejected";
    t.decidedAt = Date.now();
    t.note = note;
    t.decidedBy = "运营";
    onReviewDecided(t, false);
    saveReviews();
    log("error", `⛔ 审核驳回：${t.title}${note ? " · " + note : ""}`);
  }
  function resetReview(id: string) {
    const t = reviewTasks.value.find((x) => x.id === id);
    if (t) {
      t.status = "pending";
      t.decidedAt = undefined;
      saveReviews();
    }
  }

  /** 审核结论回写业务对象（把闸的效果落到数据上）。 */
  function onReviewDecided(t: ReviewTask, approved: boolean) {
    if (t.kind === "customs-draft" && t.refId) {
      const d = declarations.value.find((x) => x.id === t.refId);
      if (d) {
        d.status = approved ? "released" : "draft";
        const s5 = customsFlow.value.find((s) => s.n === 5);
        if (s5 && approved) s5.state = "done";
        const s6 = customsFlow.value.find((s) => s.n === 6);
        if (s6 && approved) s6.state = "active";
        saveDeclarations();
        saveCustomsFlow();
      }
    }
    // HS 归类复核：独立闸，只回写归类完成度，绝不触发报关草稿放行 / 推进报关流程步。
    if (t.kind === "hs-review" && t.refId) {
      const d = declarations.value.find((x) => x.id === t.refId);
      if (d && approved) {
        d.hsComplete = 100;
        saveDeclarations();
      }
    }
    // 选品入库：仅在核准后才真正标记 stocked；驳回则退回候选（避免入闸时就一次性置 stocked 无法回退）。
    if (t.kind === "sku-intake" && t.refId) {
      const s = skus.value.find((x) => x.id === t.refId);
      if (s) {
        s.state = approved ? "stocked" : "candidate";
        saveSkus();
      }
    }
    if (t.kind === "compliance-release" && t.refId) {
      const c = compliance.value.find((x) => x.container === t.refId);
      if (c) {
        c.ok = approved;
        c.release = approved ? "可放行" : "缺证拦发货";
        lsSave(LS.compliance, compliance.value);
      }
    }
    if (t.kind === "lead-convert" && t.refId) {
      const l = leads.value.find((x) => x.id === t.refId);
      if (l && approved && !suppliers.value.find((s) => s.name === l.company)) {
        suppliers.value.push({ name: l.company, country: l.country, cat: l.category, onTime: 0, price: 0, quality: 0, composite: 0, grade: "—", tag: "新建联" });
        lsSave(LS.suppliers, suppliers.value);
      }
    }
    if (t.kind === "recon-match" && t.refId) {
      const r = recon.value.find((x) => x.item === t.refId);
      if (r && approved) {
        r.status = "已匹配";
        lsSave(LS.recon, recon.value);
      }
    }
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
    log("info", `🚀 选品采集：${criteria.keywords || "默认条件"}`);
    const toolSink: AgentRun["tools"] = [];
    try {
      const { data } = await runJson<{ skus: SkuCandidate[] }>({
        prompt: P.promptSourcing(criteria), goal: "采集候选 SKU 并结构化", useKb: true, ...makeCallbacks(toolSink),
      });
      const list = Array.isArray(data?.skus) ? data.skus : [];
      list.forEach((s) => skus.value.unshift({ ...s, id: uid("sku"), provenance: "ai", state: "candidate" }));
      saveSkus();
      addRun({ mod: "m1", kind: "collect", inputSummary: criteria.keywords, resultSummary: `采集 ${list.length} 个候选`, tools: toolSink });
      runStatus.value = `✅ 采集完成，新增 ${list.length} 个`;
      log("ok", runStatus.value);
      return list.length;
    } catch (e) {
      runStatus.value = `❌ 采集失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return 0;
    }
  }

  /** M2 建联：生成个性化开发信（进人工闸：外发核准）。 */
  async function runOutreach(leadId: string, lang: string): Promise<string | null> {
    const l = leads.value.find((x) => x.id === leadId);
    if (!l) return null;
    runStatus.value = `写开发信 @${l.company}…`;
    log("info", `✍️ 生成 ${lang} 开发信 · ${l.company}`);
    const toolSink: AgentRun["tools"] = [];
    try {
      const res = await run({ prompt: P.promptOutreach(l, lang), useKb: true, ...makeCallbacks(toolSink) });
      if (!l.drafts) l.drafts = {};
      l.drafts[lang] = res.raw.trim();
      saveLeads();
      addRun({ mod: "m2", kind: "outreach", inputSummary: `${l.company}/${lang}`, resultSummary: "开发信草稿已生成", tools: toolSink });
      enqueueReview({
        mod: "m2", kind: "outreach-send", title: `${l.company} 开发信外发核准`, refId: l.id,
        summary: `已生成 ${lang} 个性化破冰开发信，需人工预览确认后外发（反骚扰闸）。`,
        facts: [{ k: "对象", v: `${l.company} · ${l.country}` }, { k: "语言", v: lang }, { k: "优先级", v: `${l.grade} · ${l.score}` }],
        risk: "normal",
      });
      runStatus.value = `✅ 开发信已生成，入外发核准闸`;
      log("ok", runStatus.value);
      return res.raw.trim();
    } catch (e) {
      runStatus.value = `❌ 生成失败：${(e as Error).message}`;
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
        log("error", `❌ 意向分类返回非法值「${data.replyClass}」，已忽略未回写`);
        return null;
      }
      l.replyClass = cls;
      l.status = "replied";
      saveLeads();
      addRun({ mod: "m2", kind: "reply-class", inputSummary: l.company, resultSummary: `意向：${cls}`, tools: toolSink });
      log("ok", `✅ 回信意向：${cls}`);
      return cls;
    } catch (e) {
      log("error", `❌ 意向分类失败：${(e as Error).message}`);
      return null;
    }
  }

  /** M4 报关：HS 归类（低置信进人工闸）。 */
  async function runHsClassify(decId: string): Promise<boolean> {
    const d = declarations.value.find((x) => x.id === decId);
    if (!d) return false;
    runStatus.value = `HS 归类 · 货柜 ${d.id}…`;
    log("info", `🏷️ HS 归类 · ${d.goods}`);
    const toolSink: AgentRun["tools"] = [];
    try {
      const { data } = await runJson<{ hsCode: string; reasoning: string; dutyRate: string; hsConf: number; dutyConf: number }>({
        prompt: P.promptHsClassify(d), useKb: true, ...makeCallbacks(toolSink),
      });
      if (d.lines[0]) {
        d.lines[0].hs = data.hsCode || d.lines[0].hs;
        d.lines[0].hsConf = Number(data.hsConf) || 0;
        d.lines[0].dutyRate = data.dutyRate || d.lines[0].dutyRate;
        d.lines[0].dutyConf = Number(data.dutyConf) || 0;
      }
      d.hsComplete = data.hsCode ? 100 : d.hsComplete;
      saveDeclarations();
      addRun({ mod: "m4", kind: "hs-classify", inputSummary: d.goods, resultSummary: `${data.hsCode} · ${data.hsConf}%`, tools: toolSink });
      if ((Number(data.hsConf) || 0) < 85) {
        enqueueReview({
          mod: "m4", kind: "hs-review", title: `货柜 ${d.id} HS 归类复核`, refId: d.id,
          summary: `HS 归类 ${data.hsCode} 置信 ${data.hsConf}% 低于 85%，转人工复核。`,
          facts: [{ k: "HS", v: data.hsCode, warn: true }, { k: "依据", v: (data.reasoning || "").slice(0, 60) }],
          risk: "high",
        });
      }
      runStatus.value = `✅ HS 归类：${data.hsCode}（${data.hsConf}%）`;
      log("ok", runStatus.value);
      return true;
    } catch (e) {
      runStatus.value = `❌ 归类失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return false;
    }
  }

  /** M4 报关：把某柜草稿推进人工确认闸。 */
  function submitCustomsDraft(decId: string) {
    const d = declarations.value.find((x) => x.id === decId);
    if (!d) return;
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

  /** M8 对账：为未达账项找候选匹配（进人工闸）。 */
  async function runRecon(item: string): Promise<boolean> {
    const r = recon.value.find((x) => x.item === item);
    if (!r) return false;
    runStatus.value = `对账辅助 · ${item}…`;
    const toolSink: AgentRun["tools"] = [];
    try {
      const { data } = await runJson<{ candidates: { target: string; reason: string; conf: number }[] }>({
        prompt: P.promptRecon(r), useKb: false, ...makeCallbacks(toolSink),
      });
      const top = (data.candidates || [])[0];
      if (top) {
        r.match = top.target;
        r.conf = Number(top.conf) || 0;
        r.status = "待确认";
        lsSave(LS.recon, recon.value);
        enqueueReview({
          mod: "m8", kind: "recon-match", title: `${item} 匹配确认`, refId: item,
          summary: `AI 候选匹配 ${top.target}（置信 ${top.conf}%），需人工确认回写。`,
          facts: [{ k: "金额", v: r.amount }, { k: "候选", v: top.target }, { k: "依据", v: (top.reason || "").slice(0, 50) }],
          risk: "normal",
        });
      }
      addRun({ mod: "m8", kind: "recon", inputSummary: item, resultSummary: top ? top.target : "无候选", tools: toolSink });
      runStatus.value = `✅ 对账候选已生成`;
      log("ok", runStatus.value);
      return true;
    } catch (e) {
      runStatus.value = `❌ 对账失败：${(e as Error).message}`;
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
          mod: "m9", kind: "compliance-release", title: `货柜 ${container} 缺证放行核准`, refId: container,
          summary: `合规要件核查存在缺口：${(data.items || []).filter((i) => i.status && i.status.includes("缺")).map((i) => i.name).join("、") || "见明细"}。`,
          facts: (data.items || []).slice(0, 4).map((i) => ({ k: i.name, v: i.status, warn: (i.status || "").includes("缺") })),
          risk: "hard", hardGate: true,
        });
      }
      log("ok", `✅ 合规核查完成：${data.release}`);
      return true;
    } catch (e) {
      log("error", `❌ 合规核查失败：${(e as Error).message}`);
      return false;
    }
  }

  /** M7 报价：生成对客报价邮件（进外发闸）。 */
  async function runQuoteOut(customer: string, sku: string, taxable: number): Promise<string | null> {
    const tax = computeWineTax(taxable);
    const toolSink: AgentRun["tools"] = [];
    try {
      const res = await run({ prompt: P.promptQuoteOut(customer, sku, tax.inclTotal), useKb: false, ...makeCallbacks(toolSink) });
      addRun({ mod: "m7", kind: "quote-out", inputSummary: `${customer}/${sku}`, resultSummary: "报价邮件已生成", tools: toolSink });
      enqueueReview({
        mod: "m7", kind: "quote-out", title: `${customer} 报价单外发核准`, refId: `${customer}-${sku}`,
        summary: `${sku} 含税价 AUD ${tax.inclTotal.toFixed(2)}/瓶（WET+GST，与合规中心同一函数），确认后外发。`,
        facts: [{ k: "含税价", v: `AUD ${tax.inclTotal.toFixed(2)}` }, { k: "WET", v: `AUD ${tax.wet.toFixed(2)}` }, { k: "GST", v: `AUD ${tax.gst.toFixed(2)}` }],
        risk: "normal",
      });
      return res.raw.trim();
    } catch (e) {
      log("error", `❌ 报价生成失败：${(e as Error).message}`);
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

  return {
    // state
    leads, outreachFunnel, declarations, customsKpi, customsFlow, shipments, suppliers,
    skus, stock, replenish, customers, salesOrders, recon, compliance, workflows, kb,
    dashKpi, trends, pipeline, briefing,
    reviewTasks, runs, consoleLines, runStatus, busy, activeMod,
    // 导航（SideNav ⇄ 工作区共享）
    view, go,
    // review pipeline
    enqueueReview, claimReview, approveReview, rejectReview, resetReview,
    reviewByStatus, reviewColumns, pendingCount, submitCustomsDraft,
    // console
    log, clearConsole,
    // persistence
    saveDeclarations, saveLeads, saveSkus, resetAll,
    // claude actions
    runChat, runSourcing, runOutreach, runReplyClass, runHsClassify, runRecon, runCompliance, runQuoteOut, runKbAsk,
  };
}

export function useTradeStore() {
  if (!singleton) singleton = create();
  return singleton;
}
