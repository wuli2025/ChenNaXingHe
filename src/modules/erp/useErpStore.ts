/**
 * useErpStore —— 星河无头ERP 的响应式状态 + 持久化 + 动作策略引擎 + 审批流水线 + Claude 动作。
 *
 * 单例。所有 10 个模块组件与审批中心都 import 它（零 props 契约）。
 *
 * 无头三层在前端的落地：
 *  - 「无头核心」＝本 store 的确定性函数（记账/调价/建PO/回写），带硬底线（保本价、强制人工清单）。
 *  - 「策略引擎」＝ decide()：按参数中心的自治边界把每个动作分流为 自动执行 / 进审批 / 强制人工。
 *  - 「AI 编排」＝ run* 系列：经 useAgentRunner 调官方 Claude Code，产出→过策略→执行或入闸。
 *
 * 强制人工（HUMAN_ONLY_ACTIONS）：付款 / 税务申报提交 / 出口退税提交 —— decide() 无条件 review+hardGate，
 * 参数怎么调都不会变成自动，这是写死在核心层的红线。
 */
import { ref, computed, watch } from "vue";
import { useAgentRunner } from "../../composables/useAgentRunner";
import type {
  Product, Listing, PriceCard, Order, AfterSale, ChannelCard, ErpShipment,
  PurchaseOrder, StockRow, EvidenceDoc, EvidenceBundle, JournalEntry, ReconRow,
  MonthlyReport, TaxFiling, ErpParams, ParamChange, ConsoleLine, AgentRun,
  ReviewTask, ReviewKind, ErpModId, ExecutedAction, DocType,
} from "./types";
import {
  ELS, DEFAULT_PARAMS, HUMAN_ONLY_ACTIONS, computeTargetPrice,
  computeProfit, round2, EICONS, DOC_TYPE_LABEL,
} from "./types";
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

/**
 * 参数 schema 校验 + 范围钳制（纵深防御，防 localStorage 投毒）。
 * decide() 的自治边界依赖 params，若把 localStorage 原文直接塞进去，篡改即可放宽
 * 退款/调价/OCR 入账等非硬闸动作的自动执行门槛（C08-P1-02）。这里在加载入口统一
 * 过滤：只接受白名单 key、有限数、并钳制到业务合理区间；越界/缺失回落默认值。
 * 注：强制人工清单（付款/报税/退税）不受 params 影响，本函数只收窄其余边界的攻击面。
 */
const PARAM_RANGES: Record<keyof ErpParams, [number, number]> = {
  // 下界：作分母/除数的经营参数须 >0（monthlyGmvTarget 用于达成率、dailyActionCap 用于限频），否则 KPI 会 Infinity/NaN。
  targetMarginPct: [0, 90], minMarginFloorPct: [0, 90], monthlyGmvTarget: [1, 1e9],
  priceAutoBandPct: [0, 50], fxRecalcThresholdPct: [0, 50],
  autoAmountCapUsd: [0, 1e6], autoRefundCapUsd: [0, 1e6], dailyActionCap: [1, 1e5],
  ocrAutoBookConf: [0, 100], ocrAutoBookCapCny: [0, 1e8],
  safetyStockDays: [0, 3650], leadTimeDays: [0, 3650], highValueShipmentUsd: [0, 1e6],
  platformFeePct: [0, 90], adCostPct: [0, 90], returnRatePct: [0, 90],
  usdCny: [0.01, 1000], eurUsd: [0.01, 1000],
};
function sanitizeParams(raw: Partial<ErpParams>): ErpParams {
  const out = { ...DEFAULT_PARAMS };
  (Object.keys(DEFAULT_PARAMS) as (keyof ErpParams)[]).forEach((k) => {
    const v = raw?.[k];
    const [lo, hi] = PARAM_RANGES[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi) out[k] = v;
    // 越界/缺失/非数：保留默认值（等于拒绝投毒，不静默采信 localStorage）
  });
  return out;
}

/** 策略引擎结论。 */
export interface PolicyDecision {
  mode: "auto" | "review";
  hardGate: boolean;
  /** 人话理由（进台账/卡片）。 */
  why: string;
}

let singleton: ReturnType<typeof create> | null = null;

function create() {
  const { running, run, runJson } = useAgentRunner();

  /* ══════════ 持久化业务状态 ══════════ */
  const products = ref<Product[]>([]);
  const listings = ref<Listing[]>([]);
  const prices = ref<PriceCard[]>([]);
  const orders = ref<Order[]>([]);
  const afterSales = ref<AfterSale[]>([]);
  const channels = ref<ChannelCard[]>([]);
  const shipments = ref<ErpShipment[]>([]);
  const pos = ref<PurchaseOrder[]>([]);
  const stock = ref<StockRow[]>([]);
  const docs = ref<EvidenceDoc[]>([]);
  const bundles = ref<EvidenceBundle[]>([]);
  const journal = ref<JournalEntry[]>([]);
  const recon = ref<ReconRow[]>([]);
  const reports = ref<MonthlyReport[]>([]);
  const filings = ref<TaxFiling[]>([]);
  const params = ref<ErpParams>({ ...DEFAULT_PARAMS });
  const paramLog = ref<ParamChange[]>([]);
  const reviewTasks = ref<ReviewTask[]>([]);
  const runs = ref<AgentRun[]>([]);
  const executedActions = ref<ExecutedAction[]>([]);

  /* ══════════ 控制台 / 导航 ══════════ */
  const consoleLines = ref<ConsoleLine[]>([]);
  const runStatus = ref<string>("");
  const busy = computed(() => running.value);
  const activeMod = ref<ErpModId>("e0");
  const view = ref<ErpModId | "review">("e0");
  function go(id: ErpModId | "review") {
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

  /* ══════════ 动作策略引擎（有界自治的实现） ══════════ */

  /**
   * decide —— 每个动作执行前必经的分流闸。
   * 强制人工清单无条件 review+hardGate；其余按参数中心的金额/幅度/置信度边界分流。
   */
  function decide(kind: ReviewKind, o: { amountUsd?: number; amountCny?: number; pct?: number; conf?: number } = {}): PolicyDecision {
    if (HUMAN_ONLY_ACTIONS.has(kind)) {
      return { mode: "review", hardGate: true, why: "强制人工清单动作（资金/税务红线），AI 只备料，永不自动执行" };
    }
    const p = params.value;
    // 金额规则：有专属阈值的 kind 用专属阈值，其余走通用上限 —— 专属规则先判，
    // 否则通用上限（默认 $500）会把更高的专属阈值（如高值件 $800）永远短路掉。
    if (kind === "order-refund") {
      if (o.amountUsd !== undefined && o.amountUsd > p.autoRefundCapUsd) {
        // 大额退款是资金流出红线（与 PRD/类型注释口径一致），照付款闸的规格走硬闸。
        return { mode: "review", hardGate: true, why: `退款 $${o.amountUsd} 超过自动退款上限 $${p.autoRefundCapUsd}，大额退款属资金红线，强制人工` };
      }
    } else if (kind === "logistics-channel") {
      if (o.amountUsd !== undefined && o.amountUsd >= p.highValueShipmentUsd) {
        return { mode: "review", hardGate: false, why: `货值 $${o.amountUsd} 达到高值件阈值 $${p.highValueShipmentUsd}` };
      }
    } else if (o.amountUsd !== undefined && o.amountUsd > p.autoAmountCapUsd) {
      return { mode: "review", hardGate: false, why: `金额 $${o.amountUsd} 超过自动执行上限 $${p.autoAmountCapUsd}` };
    }
    if (kind === "price-change" && o.pct !== undefined && Math.abs(o.pct) > p.priceAutoBandPct) {
      return { mode: "review", hardGate: false, why: `调价幅度 ${o.pct.toFixed(1)}% 超出自动带宽 ±${p.priceAutoBandPct}%` };
    }
    if (kind === "ocr-book") {
      if ((o.conf ?? 0) < p.ocrAutoBookConf) {
        return { mode: "review", hardGate: false, why: `OCR 置信度 ${o.conf}% 低于自动入账阈值 ${p.ocrAutoBookConf}%` };
      }
      if ((o.amountCny ?? 0) > p.ocrAutoBookCapCny) {
        return { mode: "review", hardGate: false, why: `票面 ¥${o.amountCny} 超过自动入账上限 ¥${p.ocrAutoBookCapCny}` };
      }
    }
    // 今日自动动作限频（宁停勿错）
    const today = new Date().toDateString();
    const autoToday = executedActions.value.filter((a) => a.by === "auto" && new Date(a.at).toDateString() === today).length;
    if (autoToday >= p.dailyActionCap) {
      return { mode: "review", hardGate: false, why: `今日自动动作已达上限 ${p.dailyActionCap} 次，剩余动作全部转人工` };
    }
    return { mode: "auto", hardGate: false, why: "在自治边界内，自动执行并留痕" };
  }

  /* ══════════ 审批流水线 ══════════ */
  function recordAction(a: Omit<ExecutedAction, "id" | "at">) {
    executedActions.value.unshift({ id: uid("act"), at: Date.now(), ...a });
    if (executedActions.value.length > 300) executedActions.value.length = 300;
  }
  function enqueueReview(t: Omit<ReviewTask, "id" | "status" | "createdAt">): ReviewTask | null {
    const dup = reviewTasks.value.find(
      (x) => x.kind === t.kind && x.refId === t.refId && (x.status === "pending" || x.status === "in_review")
    );
    if (dup) {
      // 同一业务对象重复入闸：刷新为最新提案，防止「新提案被静默丢弃、批准时执行旧 payload」。
      dup.title = t.title;
      dup.summary = t.summary;
      dup.reasoning = t.reasoning;
      dup.consequence = t.consequence;
      dup.facts = t.facts;
      dup.risk = t.risk;
      dup.hardGate = t.hardGate;
      dup.payload = t.payload;
      dup.origin = t.origin;
      dup.createdAt = Date.now();
      log("info", `审批卡片已刷新为最新提案：${dup.title}`);
      return dup;
    }
    const task: ReviewTask = { id: uid("rv"), status: "pending", createdAt: Date.now(), ...t };
    reviewTasks.value.unshift(task);
    log("info", `新审批卡片：${task.title}${task.hardGate ? "（强制人工）" : ""}`);
    return task;
  }
  function claimReview(id: string) {
    const t = reviewTasks.value.find((x) => x.id === id);
    if (t && t.status === "pending") t.status = "in_review";
  }
  function approveReview(id: string, note?: string) {
    const t = reviewTasks.value.find((x) => x.id === id);
    // 幂等守卫：已决任务再 approve 会二次执行回写（重复建 PO / 重复挂账凭证），属账实损坏。
    if (!t || (t.status !== "pending" && t.status !== "in_review")) return;
    const prev = t.status;
    t.status = "approved";
    t.decidedAt = Date.now();
    t.note = note;
    t.decidedBy = "老板";
    // 回写可能被核心 guard 拒绝（申报不就绪/PO 非法/票据重复…）。若失败，卡片不能停留在「已批准」
    // 假象——回滚到原待审状态并提示，避免「显示已批准但业务没动」的账实/状态不一致。
    const ok = onReviewDecided(t, true);
    if (!ok) {
      t.status = prev;
      t.decidedAt = undefined;
      t.decidedBy = undefined;
      log("error", `批准未生效：${t.title} 的回写被核心校验拒绝，卡片退回待审`);
      return;
    }
    log("ok", `已批准：${t.title}`);
  }
  function rejectReview(id: string, note?: string) {
    const t = reviewTasks.value.find((x) => x.id === id);
    if (!t || (t.status !== "pending" && t.status !== "in_review")) return;
    t.status = "rejected";
    t.decidedAt = Date.now();
    t.note = note;
    t.decidedBy = "老板";
    onReviewDecided(t, false);
    log("error", `已驳回：${t.title}${note ? " · " + note : ""}`);
    // 自动重跑触发新的 AI run：若已有 AI 动作在跑则不并发启动（避免 runStatus/console 交错与并发回写）；
    // 用户可在当前动作结束后手动重跑。UI 也会在 busy 时禁用驳回按钮（纵深）。
    if (!t.reran && RERUNNABLE.has(t.kind) && !busy.value) void rerunFromReject(t, note);
  }
  function resetReview(id: string) {
    const t = reviewTasks.value.find((x) => x.id === id);
    // 只允许重开「已驳回」的卡片：已批准的回写已经执行（建PO/入账/付款…），
    // 重开再批会双重执行副作用，属账实损坏，禁止。
    if (!t || t.status !== "rejected") return;
    // 驳回自动重跑（RERUNNABLE）已生成同 kind+refId 的新 pending 卡时，禁止重开旧卡：
    // 否则两张待审并存，批准旧卡会用陈旧 payload 覆盖新提案。
    const hasLiveTwin = reviewTasks.value.some(
      (x) => x.id !== t.id && x.kind === t.kind && x.refId === t.refId && (x.status === "pending" || x.status === "in_review")
    );
    if (hasLiveTwin) {
      log("info", `↻ ${t.title} 已有更新的待审卡片，旧卡不重开（避免陈旧提案覆盖）`);
      return;
    }
    t.status = "pending";
    t.decidedAt = undefined;
    t.reran = false;
  }

  /** 驳回自动带批注重跑的 AI 产出类任务（学习闭环第一步）。 */
  const RERUNNABLE = new Set<ReviewKind>(["listing-publish", "listing-update", "price-change", "recon-open"]);
  async function rerunFromReject(t: ReviewTask, note?: string) {
    t.reran = true;
    const p = t.payload || {};
    const fb = note && note.trim() ? note.trim() : "上一轮结果被人工驳回，请重新核验并改进。";
    log("info", `↻ 按驳回批注自动重跑：${t.title}`);
    try {
      if ((t.kind === "listing-publish" || t.kind === "listing-update") && p.listingId) {
        await runListingGen(String(p.listingId), fb);
      } else if (t.kind === "price-change" && p.sku && p.platform) {
        await runPriceAdvice(String(p.sku), String(p.platform), `人工驳回重议：${fb}`, fb);
      } else if (t.kind === "recon-open" && p.reconId) {
        await runRecon(String(p.reconId), fb);
      }
    } catch (e) {
      log("error", `↻ 自动重跑失败：${(e as Error).message}`);
    }
  }

  /**
   * 核准即执行 —— 14 种审批类别全部有确定性回写分支，批准立即落到数据上并留台账。
   * 返回是否成功执行了回写：批准路径遇核心 guard 拒绝返回 false（供 approveReview 回滚卡片状态）；
   * 驳回路径恒返回 true（拒绝本身总能被记录）。
   */
  function onReviewDecided(t: ReviewTask, approved: boolean): boolean {
    const p = t.payload || {};
    switch (t.kind) {
      /* ── E2 Listing 发布/修改 ── */
      case "listing-publish":
      case "listing-update": {
        const l = listings.value.find((x) => x.id === (p.listingId || t.refId));
        if (l && approved) {
          if (p.title) l.title = String(p.title);
          if (Array.isArray(p.bullets)) l.bullets = (p.bullets as string[]).slice(0, 5);
          if (p.keywords) l.keywords = String(p.keywords);
          l.status = "live";
          recordAction({ mod: "e2", kind: t.kind, refId: l.id, by: "human", title: `Listing ${t.kind === "listing-publish" ? "发布" : "修改"} · ${l.productName}`, detail: `${l.platform} Listing 经核准${t.kind === "listing-publish" ? "发布上线" : "更新在售内容"}。` });
        } else if (l && !approved && t.kind === "listing-publish") {
          l.status = "draft";
        }
        break;
      }
      /* ── E3 超幅调价 ── */
      case "price-change": {
        const card = prices.value.find((x) => x.sku === p.sku && x.platform === p.platform);
        if (card && approved) {
          const np = Number(p.newPrice);
          // 拟价必须有限正数：脏卡 NaN/Infinity 会穿透 applyPriceInternal 污染 currentUsd/marginPct/product.priceUsd。
          if (!Number.isFinite(np) || np <= 0) {
            log("error", `调价回写拒绝：${card.name} 拟价非法（${p.newPrice}）`);
            return false;
          }
          // 落价失败（保本价无法计算等）→ 回写失败，卡片回滚，不留「显示已批准但价格没变」假象。
          if (!applyPriceInternal(card, np, String(p.reason || "人工核准调价"), "human")) return false;
        }
        break;
      }
      /* ── E4 售后退款 ── */
      case "order-refund": {
        const as = afterSales.value.find((x) => x.id === (p.afterSaleId || t.refId));
        if (!as) break;
        const o = orders.value.find((x) => x.id === as.orderId);
        if (approved) {
          // 幂等/状态复核：只有仍处「提案中」且金额有限正数的售后单能执行退款，防旧卡重开重复退款/重复关单。
          if (as.status !== "proposed" || !(Number(as.amountUsd) > 0)) {
            log("error", `退款回写拒绝：售后 ${as.id} 状态「${as.status}」非提案中或金额非法（$${as.amountUsd}）`);
            return false;
          }
          as.status = "done";
          if (o && as.type === "refund" && o.status === "refunding") o.status = "closed";
          else if (o) o.status = "closed";
          recordAction({ mod: "e4", kind: t.kind, refId: as.id, by: "human", title: `退款执行 · ${as.orderId}`, detail: `$${as.amountUsd} 退款经人工核准执行，订单关闭。` });
        } else {
          as.status = "rejected";
          // 驳回→退款不做，订单从「退款中」回到已妥投（不能卡死在退款中）。
          if (o && as.type === "refund" && o.status === "refunding") o.status = "delivered";
        }
        break;
      }
      /* ── E5 渠道核准：批准→建运单 ── */
      case "logistics-channel": {
        if (approved && p.orderId) {
          // 用当前订单实物复核：渠道存在、运费有限非负、按订单货品判带电须走可带电渠道、订单尚未出单（防过期/重复出单）。
          const o = orders.value.find((x) => x.id === String(p.orderId));
          const ch = channels.value.find((c) => c.name === String(p.channel || "").trim());
          const cost = Number(p.costCny);
          const battery = o ? /饮水机|电/.test(o.goods) : /饮水机|电/.test(String(p.goods || ""));
          if (!o || o.status === "shipped" || o.trackingNo || !ch || !Number.isFinite(cost) || cost < 0 || (battery && !ch.battery)) {
            log("error", `出单回写拒绝：订单 ${p.orderId} 不存在/已出单/渠道「${p.channel}」不存在/运费非法（${p.costCny}）/带电货走了不可带电渠道`);
            return false;
          }
          createShipment(o.id, o.goods, o.country, ch.name, Number(p.weightG) || 0, cost, String(p.reason || ""), "human");
        }
        break;
      }
      /* ── E5 索赔函外发 ── */
      case "claim-send": {
        const sh = shipments.value.find((x) => x.id === t.refId);
        if (approved && sh) {
          sh.status = "索赔中";
          recordAction({ mod: "e5", kind: t.kind, refId: sh.id, by: "human", title: `索赔函外发 · ${sh.id}`, detail: `停滞 ${sh.days} 天的运单向 ${sh.channel} 发起索赔，索赔函经核准外发。` });
        }
        break;
      }
      /* ── E6 补货 PO：批准→建 PO 草案（待付款） ── */
      case "replenish-po": {
        if (approved) {
          const qty = Number(p.qty);
          const unitCny = Number(p.unitCny);
          const supplier = String(p.supplier || "").trim();
          const sku = String(p.sku || "").trim();
          const goods = String(p.goods || "").trim();
          // 金额/数量/对象运行时防线：负数量/负单价/非有限数会生成负额 PO；空供应商/SKU/货品会建出付款对象不明的 PO。
          if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty) || !Number.isFinite(unitCny) || unitCny <= 0 || !supplier || !sku || !goods) {
            log("error", `补货 PO 非法（qty=${p.qty} unit=${p.unitCny} 供应商「${p.supplier}」SKU「${p.sku}」货品「${p.goods}」），拒绝建单`);
            return false;
          }
          const id = uid("PO");
          pos.value.unshift({
            id, supplier, sku, goods,
            qty, unitCny,
            amountCny: round2(qty * unitCny),
            status: "pending_pay", grnOk: false, invoiceOk: false,
          });
          recordAction({ mod: "e6", kind: t.kind, refId: id, by: "human", title: `补货 PO 创建 · ${p.goods}`, detail: `补货 ${qty} 件经核准，生成采购单 ${id}（待付款 —— 付款需再过强制人工闸）。` });
          // 付款是独立的强制人工闸，PO 建好即入列
          gatePoPayment(id);
        }
        break;
      }
      /* ── E6 采购付款（强制人工） ── */
      case "po-payment": {
        const po = pos.value.find((x) => x.id === (p.poId || t.refId));
        if (po && approved) {
          // 付款前复核 PO 自洽：状态待付、数量正整数、单价/金额有限正数、金额=数量×单价。
          // 防脏数据/旧数据的负额或金额与量价不符的 PO 被人工闸放行付款（资金流出不可逆）。
          const consistent =
            po.status === "pending_pay" &&
            String(po.supplier || "").trim() && String(po.sku || "").trim() && String(po.goods || "").trim() &&
            String(po.supplier).trim() !== "待定供应商" &&
            Number.isInteger(po.qty) && po.qty > 0 &&
            Number.isFinite(po.unitCny) && po.unitCny > 0 &&
            Number.isFinite(po.amountCny) && po.amountCny > 0 &&
            Math.abs(po.amountCny - round2(po.qty * po.unitCny)) < 0.01;
          if (!consistent) {
            log("error", `采购付款拒绝：${po.id} 数据不自洽（状态「${po.status}」/供应商「${po.supplier}」/量 ${po.qty}/单价 ${po.unitCny}/金额 ${po.amountCny}）`);
            return false;
          }
          po.status = "paid";
          recordAction({ mod: "e6", kind: t.kind, refId: po.id, by: "human", title: `采购付款 · ${po.id}`, detail: `向 ${po.supplier} 付款 ¥${po.amountCny.toLocaleString()}（强制人工闸，已留痕可追责）。` });
        }
        break;
      }
      /* ── E7 票据入账 ── */
      case "ocr-book": {
        const d = docs.value.find((x) => x.id === (p.docId || t.refId));
        if (d && approved) {
          bookDoc(d, "human");
          // bookDoc 内含重复/币种/金额/VAT/锁账多道拒绝；未入账即视为回写失败，卡片退回待审。
          if (!d.booked) return false;
        }
        break;
      }
      /* ── E7 对账差异处理 ── */
      case "recon-open": {
        const r = recon.value.find((x) => x.id === (p.reconId || t.refId));
        if (r && approved) {
          // 非费用挂账行必须有真实候选（非「未找到候选」占位）且处于「待确认」，否则批准会把未达项假闭合为「已匹配」（脏卡兜底）。
          if (r.side !== "费用挂账" && (!isRealReconTarget(r.match) || r.status !== "待确认")) {
            log("error", `对账回写拒绝：${r.item} 无有效候选或状态非待确认（match「${r.match}」/状态「${r.status}」）`);
            return false;
          }
          if (r.side === "费用挂账") {
            // 幂等：已「差异挂账」表示已入过挂账凭证，重复批准（脏卡/多卡）会二次记「财务费用」，拒绝。
            if (r.status === "差异挂账") {
              log("error", `对账回写拒绝：${r.item} 已挂账，拒绝重复记账`);
              return false;
            }
            // 金额从展示串解析（"¥1,285.10" → 1285.10）。币符决定折算口径；负号保留（冲回项）。
            const sign = /-\s*[¥$€]?\s*[\d,]/.test(String(r.amount)) || /^\s*-/.test(String(r.amount)) ? -1 : 1;
            const raw = (Number(String(r.amount).replace(/[^\d.]/g, "")) || 0) * sign;
            const cur = String(r.amount).includes("$") ? "USD" : String(r.amount).includes("€") ? "EUR" : "CNY";
            const amt = toCny(raw, cur);
            // 挂账金额不可为 0：金额串被污染成「—」等无数字时会生成 0 元凭证假闭合，拒绝。
            if (!(Math.abs(amt) > 0)) {
              log("error", `对账回写拒绝：${r.item} 挂账金额解析为 0（原串「${r.amount}」）`);
              return false;
            }
            r.status = "差异挂账";
            journal.value.unshift({ id: uid("J"), date: todayStr(), summary: `对账差异挂账：${r.item}${cur !== "CNY" ? `（${cur} ${raw.toLocaleString()} 折算）` : ""}`, debit: "财务费用-汇兑损益", credit: "银行存款", amountCny: amt, by: "human" });
          } else {
            r.status = "已匹配";
          }
          recordAction({ mod: "e7", kind: t.kind, refId: r.id, by: "human", title: `对账处理 · ${r.item}`, detail: `${r.match} 经核准回写，状态置「${r.status}」。` });
        }
        break;
      }
      /* ── E7 月结确认 ── */
      case "month-close": {
        const rep = reports.value.find((x) => x.month === (p.month || t.refId));
        if (rep && approved) {
          // 幂等：已锁账的月不再重复锁（脏卡/重复批准不应再记一条月结台账）。
          if (rep.closed) {
            log("error", `月结回写拒绝：${rep.month} 已锁账`);
            return false;
          }
          rep.closed = true;
          recordAction({ mod: "e7", kind: t.kind, refId: rep.month, by: "human", title: `月结完成 · ${rep.month}`, detail: `${rep.month} 月结经核准锁账：GMV $${rep.gmvUsd.toLocaleString()}，净利 ¥${rep.netProfitCny.toLocaleString()}。` });
        }
        break;
      }
      /* ── E8 税务申报/退税提交（强制人工） ── */
      case "tax-filing":
      case "export-rebate": {
        const f = filings.value.find((x) => x.id === (p.filingId || t.refId));
        if (f && approved) {
          // 提交回写守卫：只有「就绪且资料齐」的申报能置已提交 —— 闸卡等待期间检查被重跑打回 preparing、
          // 资料包被撤件、或已被提交过（submitted/archived）时，批准不得产生第二次对税局提交。
          if (!isFilingReadyForSubmit(f)) {
            log("error", `${f.name}（状态「${f.status}」/资料包未齐）非可提交，提交回写已拒绝（请先跑税务官检查置就绪）`);
            return false;
          }
          f.status = "submitted";
          recordAction({ mod: "e8", kind: t.kind, refId: f.id, by: "human", title: `申报提交 · ${f.name}`, detail: `经老板人工确认后提交（强制人工闸）。回执归档后转「已归档」。` });
        }
        break;
      }
      /* ── E9 关键参数修改 ── */
      case "param-change": {
        if (approved && p.key) {
          const key = p.key as keyof ErpParams;
          const to = Number(p.to);
          // 复用正常路径校验：参数须为已知经营参数、目标值有限正数、且 key 与卡片 refId 一致（防脏卡改错参数）。
          if (!(key in params.value) || !Number.isFinite(to) || to <= 0 || String(p.key) !== String(t.refId)) {
            log("error", `参数生效拒绝：key「${String(p.key)}」/值「${p.to}」非法或与卡片不符`);
            return false;
          }
          // 批准时重算百分比组合约束：等待期间别的费率参数若已变，此刻仍不能把组合推到 ≥100%（否则保本价爆 Infinity）。
          const pctBad = pctParamInvalidReason(key, to);
          if (pctBad) {
            log("error", `参数生效拒绝：${pctBad}`);
            return false;
          }
          applyParamInternal(key, to, "human", String(t.note || "审批通过"));
          recordAction({ mod: "e9", kind: t.kind, refId: String(p.key), by: "human", title: `参数生效 · ${String(p.key)}`, detail: `自治边界参数经人工核准修改为 ${to}，即刻改变 AI 自动执行边界。` });
        }
        break;
      }
      default:
        break;
    }
    return true;
  }

  const pendingCount = computed(() => reviewTasks.value.filter((t) => t.status === "pending" || t.status === "in_review").length);
  const pendingHardGates = computed(() => reviewTasks.value.filter((t) => (t.status === "pending" || t.status === "in_review") && (t.hardGate || t.risk === "hard")));
  const reviewColumns = computed(() => ({
    pending: reviewTasks.value.filter((t) => t.status === "pending"),
    in_review: reviewTasks.value.filter((t) => t.status === "in_review"),
    approved: reviewTasks.value.filter((t) => t.status === "approved"),
    rejected: reviewTasks.value.filter((t) => t.status === "rejected"),
  }));
  const autonomyStats = computed(() => {
    const total = executedActions.value.length;
    const auto = executedActions.value.filter((a) => a.by === "auto").length;
    return { total, auto, human: total - auto, autoRate: total ? Math.round((auto / total) * 100) : 0 };
  });

  /* ══════════ 无头核心：确定性执行函数（AI 与人共用，硬底线在此强制） ══════════ */

  /** 最低可售价：净利率不得低于红线 —— AI 无法绕过的保本硬底线。 */
  function floorPrice(card: PriceCard): number {
    const prod = products.value.find((x) => x.id === card.sku);
    if (!prod) return card.breakEvenUsd;
    const pp = { ...params.value, targetMarginPct: params.value.minMarginFloorPct };
    return computeTargetPrice(prod.costCny, prod.shipUsd, pp);
  }

  /** 内部调价执行器：钳制到硬底线之上，写变价日志 + 台账。返回是否成功落价（供审批回写判断回滚）。 */
  function applyPriceInternal(card: PriceCard, newPrice: number, reason: string, by: "auto" | "human"): boolean {
    const floor = floorPrice(card);
    // 保本价非有限（如费率参数被设成使可变成本≥100%，computeTargetPrice 返回 Infinity）时不落价，
    // 否则会把 currentUsd 钳成 Infinity 污染整条价格链。属参数配置错误，拒绝并提示。
    if (!Number.isFinite(floor)) {
      log("error", `调价拒绝：${card.name} 保本价无法计算（费率参数可能使可变成本≥100%），请检查 E9 参数`);
      return false;
    }
    let price = round2(newPrice);
    let clamped = false;
    if (price < floor) {
      price = round2(floor);
      clamped = true;
    }
    const from = card.currentUsd;
    card.lastChange = { at: Date.now(), from, to: price, reason: clamped ? `${reason}（已被保本硬底线钳制到 $${price}）` : reason, by };
    card.currentUsd = price;
    const prod = products.value.find((x) => x.id === card.sku);
    if (prod) {
      card.marginPct = computeProfit(price, prod.costCny, prod.shipUsd, params.value).marginPct;
      if (card.platform === prod.platforms[0]) prod.priceUsd = price;
    }
    recordAction({ mod: "e3", kind: "price-change", refId: `${card.sku}@${card.platform}`, by, title: `调价 · ${card.name}`, detail: `${card.platform} $${from} → $${price}。${clamped ? "触发保本硬底线钳制。" : ""}${reason}` });
    if (clamped) log("info", `保本硬底线生效：${card.name} 拟价 $${newPrice} 被钳制到 $${price}`);
    return true;
  }

  /** 调价提案入口（AI/汇率触发共用）：过策略引擎分流。 */
  function proposePriceChange(sku: string, platform: string, newPrice: number, reason: string, conf = 90): "auto" | "review" | null {
    const card = prices.value.find((x) => x.sku === sku && x.platform === platform);
    if (!card) return null;
    // AI 输出不可信假设：非有限数/非正数拟价（如模型漏字段 Number(undefined)=NaN）一律拒绝，
    // 否则 NaN 会一路穿透 applyPriceInternal 污染 currentUsd。
    if (!Number.isFinite(newPrice) || newPrice <= 0) {
      log("error", `拟价非法（${newPrice}），已拒绝：${card.name}@${platform}`);
      return null;
    }
    const pct = card.currentUsd > 0 ? ((newPrice - card.currentUsd) / card.currentUsd) * 100 : 0;
    const floor = floorPrice(card);
    const belowFloor = newPrice < floor;
    const lowConf = conf < 80; // AI 置信不足时不给自动权，转人工确认
    const d = decide("price-change", { pct });
    if (d.mode === "auto" && !belowFloor && !lowConf) {
      applyPriceInternal(card, newPrice, reason, "auto");
      return "auto";
    }
    enqueueReview({
      mod: "e3", kind: "price-change", title: `${card.name} 调价核准（${card.platform}）`, refId: `${card.sku}@${card.platform}`, origin: "ai",
      summary: `拟 $${card.currentUsd} → $${newPrice}（${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%）。${belowFloor ? "低于保本硬底线，需人工裁决。" : lowConf ? `AI 置信 ${conf}% 不足 80%，转人工确认。` : d.why}`,
      reasoning: reason,
      consequence: "不批准则维持现价；竞争跟价可能滞后。",
      facts: [
        { k: "现价 → 拟价", v: `$${card.currentUsd} → $${newPrice}`, warn: belowFloor },
        { k: "保本硬底线", v: `$${round2(floor)}（净利率红线 ${params.value.minMarginFloorPct}%）`, source: "computeTargetPrice 单点真相" },
        { k: "竞品价", v: `$${card.rivalUsd}` },
        { k: "AI 置信", v: `${conf}%` },
      ],
      risk: belowFloor ? "hard" : "high", hardGate: belowFloor,
      payload: { sku, platform, newPrice, reason },
    });
    return "review";
  }

  /** 建运单（选路自动通过时 / 渠道闸批准后共用）。 */
  function createShipment(orderId: string, goods: string, to: string, channel: string, weightG: number, costCny: number, routeReason: string, by: "auto" | "human"): string {
    // 幂等：同一订单已有运单则不再重复出单（防重复选路/重复出单造成重复运费与重复履约）。
    const existing = shipments.value.find((s) => s.orderId === orderId);
    if (existing) {
      log("info", `订单 ${orderId} 已有运单 ${existing.id}，不重复出单`);
      return existing.id;
    }
    const id = uid("SH");
    shipments.value.unshift({ id, orderId, goods, to, channel, weightG, costCny: round2(costCny), status: "已出单", days: 0, routeReason });
    const o = orders.value.find((x) => x.id === orderId);
    if (o) {
      o.status = "shipped";
      o.channel = channel;
      o.trackingNo = id;
    }
    recordAction({ mod: "e5", kind: "logistics-channel", refId: id, by, title: `选路出单 · ${goods}`, detail: `${to} 件走「${channel}」，运费 ¥${round2(costCny)}。${routeReason}` });
    return id;
  }

  const VALID_CURRENCIES = ["CNY", "USD", "EUR"] as const;
  /** 真实历日校验：正则挡格式，再用本地构造反查 y/m/d 完全一致（拒绝 2026-02-31 这类会被 V8 归一化的假日期）。 */
  function isValidDateStr(s: string): boolean {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!dm) return false;
    const [y, mo, dd] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
    const dt = new Date(y, mo - 1, dd);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === dd;
  }
  /** 票据核心字段校验（单点真相）：票种/币种/金额/对手方/票号/日期，任一非法返回原因串，全合法返回 null。
   *  runOcr、intakeDoc、bookDoc 共用，堵住绕过 OCR 的导出调用与 localStorage 脏数据。 */
  function docCoreInvalidReason(d: { type: unknown; currency: unknown; amount: unknown; party?: string; no?: string; date?: string }): string | null {
    if (!Object.hasOwn(DOC_TYPE_LABEL, d.type as string)) return `票种「${String(d.type)}」`;
    if (!VALID_CURRENCIES.includes(d.currency as (typeof VALID_CURRENCIES)[number])) return `币种「${String(d.currency)}」`;
    const amt = Number(d.amount);
    if (!Number.isFinite(amt) || amt <= 0) return `金额「${String(d.amount)}」`;
    if (!String(d.party || "").trim()) return "对手方为空";
    if (!String(d.no || "").trim()) return "票号为空";
    if (!isValidDateStr(String(d.date || ""))) return `日期「${String(d.date)}」`;
    return null;
  }
  /** 对账候选是否为「真实匹配对象」：排除空串与「未找到候选/无匹配/—」这类伪候选占位，防假闭合。 */
  function isRealReconTarget(s: unknown): boolean {
    const t = String(s || "").trim();
    return !!t && !/未找到|无候选|无匹配|待匹配|待定|none|no\s*match|n\/a|^[-—－]+$/i.test(t);
  }
  /** 规范化 OCR lowFields 为字符串数组：AI 可能返回字符串/undefined，运行时不可信（否则组卡 .join() 抛错落僵尸票据）。 */
  function normalizeLowFields(v: unknown): string[] {
    if (Array.isArray(v)) return v.map((x) => String(x));
    if (typeof v === "string" && v.trim()) return [v];
    return [];
  }
  /** 币种折 CNY 单点真相：策略闸（intakeDoc）与记账（bookDoc）必须用同一口径，否则闸会被汇率差绕过。
   *  EUR 只在币种精确等于 EUR 时走双段折算 —— 显式枚举而非 else 兜底，避免持久化的非法币种(JPY)被误当 EUR 放大 7 倍。 */
  function toCny(amount: number, currency: string): number {
    if (currency === "CNY") return round2(amount);
    if (currency === "USD") return round2(amount * params.value.usdCny);
    if (currency === "EUR") return round2(amount * params.value.usdCny * params.value.eurUsd);
    log("error", `非法币种 ${currency}，按 1:1 CNY 处理（不放大）—— 请核查数据来源`);
    return round2(amount);
  }

  /** 本地时区的今天（yyyy-mm-dd）—— toISOString 是 UTC，国内 0-8 点会取到前一天。 */
  function todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** 归一化到「YYYY-MM」月份键：容忍斜杠/点分隔（AI 可能返回 2026/06/15），否则 slice 会取到「2026/0」误判未锁。 */
  function monthKey(dateStr: string): string {
    const m = String(dateStr).match(/(\d{4})[-/.](\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, "0")}` : String(dateStr).slice(0, 7);
  }
  /** 月份键 +1 个月（YYYY-MM → 下一个 YYYY-MM），用于向后找未锁期间。 */
  function nextMonth(mk: string): string {
    const [y, m] = mk.split("-").map(Number);
    return m >= 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }

  /** 月结锁账约束：该日期所属月是否已锁。锁账后凭证永不落进该月。 */
  function isMonthClosed(dateStr: string): boolean {
    const m = monthKey(dateStr);
    return reports.value.some((r) => r.month === m && r.closed);
  }

  /** 凭证记账日期：优先票面/业务日期；所属月已锁则顺延到「当期或之后的第一个未锁期间」。
   *  —— 会计惯例锁账期差异进当期；从当期月起向后找（绝不回落到早于今天、也绝不落进任一已锁月）；
   *  连未来 120 个月都锁（实务不可能）则 reject，交由 bookDoc 拒绝入账而非污染已锁账。 */
  function postingDate(preferred: string): { date: string; deferred: boolean; reject?: boolean } {
    if (!isMonthClosed(preferred)) return { date: preferred, deferred: false };
    const today = todayStr();
    const todayMk = monthKey(today);
    const prefMk = monthKey(preferred);
    // 起始月取「当期」与「票面月」的较晚者：过去票据顺延进当期；未来票据不得倒挂到早于票面日期的今天。
    let mk = prefMk > todayMk ? prefMk : todayMk;
    const startMk = mk;
    for (let i = 0; i < 120; i++) {
      if (!isMonthClosed(`${mk}-01`)) {
        // 起点即当期月 → 用今天完整日期；否则（未来月/顺延月）用该月首日。
        return { date: mk === todayMk && startMk === todayMk ? today : `${mk}-01`, deferred: true };
      }
      mk = nextMonth(mk);
    }
    return { date: "", deferred: true, reject: true };
  }

  /** 票据入账：生成会计凭证 + 标记已入账。 */
  function bookDoc(d: EvidenceDoc, by: "auto" | "human") {
    if (d.booked) return;
    // 真重复防线：同对手方+同票号已有票入账时，即便人工批准也拒绝二次记账（虚增成本/进项），更正走冲销。
    if (docs.value.some((x) => x.id !== d.id && x.booked && x.no === d.no && x.party === d.party)) {
      log("error", `同号票已入账（${d.party} · ${d.no}），拒绝重复记账 —— 如需更正请对原凭证冲销`);
      return;
    }
    // 核心字段运行时防线：TS 类型挡不住 localStorage/外部写入的脏数据（非法票种会让 RULE 查空、非法币种会误折算），入账前独立复核。
    const badReason = docCoreInvalidReason(d);
    if (badReason) {
      log("error", `票据 ${d.no} 核心字段非法（${badReason}），拒绝入账`);
      return;
    }
    // 优先用入闸时的汇率快照折算；但快照须为有限正数（防 localStorage 被污染成 Infinity/NaN/负数），否则回退实时口径。
    const useSnap = d.fxCny !== undefined && Number.isFinite(d.fxCny) && (d.fxCny as number) > 0;
    const cnyOf = (amt: number) => (useSnap ? round2(amt * (d.fxCny as number)) : toCny(amt, d.currency));
    const cnyAmount = cnyOf(d.amount);
    // 账本防御（纵深第二道）：非正金额永不入账，负数凭证会直接污染三表。
    if (!(cnyAmount > 0)) {
      log("error", `票据 ${d.no} 金额非法（${d.currency} ${d.amount}），拒绝入账`);
      return;
    }
    const RULE: Record<DocType, { debit: string; credit: string }> = {
      "vat-invoice": { debit: "库存商品/费用", credit: "应付账款" },
      "bank-receipt": { debit: "应付账款", credit: "银行存款" },
      "platform-stmt": { debit: "银行存款", credit: "应收账款-平台" },
      "logistics-bill": { debit: "销售费用-物流", credit: "应付账款-物流商" },
      "customs-decl": { debit: "备查登记（出口）", credit: "—" },
      receipt: { debit: "管理费用", credit: "库存现金" },
    };
    const rule = RULE[d.type];
    // 增值税发票价税分离：进项税单独挂「应交税费」，否则存货/费用虚高、进项税漏记，退税与抵扣都错。
    const taxCny = d.type === "vat-invoice" && d.taxAmount && d.taxAmount > 0 ? cnyOf(d.taxAmount) : 0;
    // 非法发票拦截：进项税额占票面比例超 20% 即不合规（国内增值税最高 13%，价内比 ≈11.5%），拒绝入账防止污染进项。
    if (d.type === "vat-invoice" && taxCny > 0 && taxCny > round2(cnyAmount * 0.2)) {
      log("error", `增值税发票 ${d.no} 税额（¥${taxCny}）占票面（¥${cnyAmount}）比例异常（>20%），拒绝入账`);
      return;
    }
    const post = postingDate(d.date);
    // 锁账兜底：连未来 120 个月都锁（实务不可能）→ 无处落账，拒绝而非污染已锁期。
    if (post.reject) {
      log("error", `票据 ${d.no} 所属月及此后各期均已锁账，无开放期间可入账 —— 请先开账期`);
      return;
    }
    const baseSummary = `${d.party} · ${d.no}${post.deferred ? `（原票日期 ${d.date}，所属月已锁账，计入 ${post.date.slice(0, 7)}）` : ""}`;
    if (taxCny > 0 && taxCny < cnyAmount) {
      journal.value.unshift({ id: uid("J"), date: post.date, summary: `${baseSummary}（进项税额）`, debit: "应交税费-应交增值税（进项税额）", credit: rule.credit, amountCny: taxCny, docId: d.id, by });
      journal.value.unshift({ id: uid("J"), date: post.date, summary: `${baseSummary}（价额）`, debit: rule.debit, credit: rule.credit, amountCny: round2(cnyAmount - taxCny), docId: d.id, by });
    } else {
      journal.value.unshift({ id: uid("J"), date: post.date, summary: baseSummary, debit: rule.debit, credit: rule.credit, amountCny: cnyAmount, docId: d.id, by });
    }
    d.booked = true;
    recordAction({ mod: "e7", kind: "ocr-book", refId: d.id, by, title: `票据入账 · ${d.party}`, detail: `${d.no} 金额 ${d.currency} ${d.amount.toLocaleString()}（折 ¥${cnyAmount.toLocaleString()}）${by === "auto" ? `高置信 ${d.conf}% 自动入账` : "人工核准入账"}，凭证已生成。` });
  }

  /** OCR 后的票据落库 + 策略分流（≥阈值且金额内自动入账，否则进闸）。 */
  function intakeDoc(data: Omit<EvidenceDoc, "id" | "booked" | "dupCheck">, rawText?: string): EvidenceDoc {
    // 核心字段校验前移到入库前：非法票种/币种/金额/日期/对手方/票号直接拒绝，
    // 避免落一张 bookDoc 永远拒收、又无审批卡的「僵尸」票据。生产路径 runOcr 已先校验且在 try/catch 内调用。
    const badReason = docCoreInvalidReason(data);
    if (badReason) {
      throw new Error(`票据核心字段非法（${badReason}），拒绝落库`);
    }
    const dup = docs.value.some((x) => x.no === data.no && x.party === data.party) ? "dup" : (data.lowFields || []).length > 1 ? "suspect" : "ok";
    // 入闸即快照记账汇率：策略闸与最终入账共用，等待审批期间参数变动不影响这张票。
    const fxCny = data.currency === "USD" ? params.value.usdCny : data.currency === "EUR" ? params.value.usdCny * params.value.eurUsd : 1;
    const doc: EvidenceDoc = { ...data, id: uid("D"), booked: false, dupCheck: dup, fxCny };
    docs.value.unshift(doc);
    const d = decide("ocr-book", { conf: doc.conf, amountCny: toCny(doc.amount, doc.currency) });
    if (d.mode === "auto" && dup === "ok") {
      bookDoc(doc, "auto");
    } else {
      enqueueReview({
        mod: "e7", kind: "ocr-book", title: `票据入账确认 · ${doc.party}`, refId: doc.id, origin: "ai",
        summary: dup === "dup" ? "票号疑似重复，拦截待人工核对。" : d.why,
        reasoning: `识别为「${doc.type}」，${(doc.lowFields || []).length ? `低置信字段：${(doc.lowFields || []).join("、")}` : "字段完整"}。`,
        consequence: "不入账则该笔业务证据链缺口，影响对账与退税。",
        facts: [
          { k: "票号", v: doc.no, warn: dup !== "ok" },
          { k: "金额", v: `${doc.currency} ${doc.amount.toLocaleString()}` },
          { k: "整单置信", v: `${doc.conf}%`, warn: doc.conf < params.value.ocrAutoBookConf },
          { k: "查重", v: dup === "ok" ? "通过" : dup === "dup" ? "票号重复" : "存疑", warn: dup !== "ok" },
        ],
        risk: dup === "dup" ? "hard" : "normal",
        payload: { docId: doc.id, rawText: (rawText || "").slice(0, 1500) },
      });
    }
    return doc;
  }

  /** 售后处理入口：金额内自动执行，超限进闸。 */
  function proposeAfterSale(asId: string): "auto" | "review" | null {
    const as = afterSales.value.find((x) => x.id === asId);
    if (!as || as.status === "done") return null;
    const d = decide("order-refund", { amountUsd: as.amountUsd });
    if (d.mode === "auto") {
      as.status = "done";
      const o = orders.value.find((x) => x.id === as.orderId);
      if (o && as.type === "refund") o.status = "closed";
      recordAction({ mod: "e4", kind: "order-refund", refId: as.id, by: "auto", title: `售后自动处理 · ${as.orderId}`, detail: `${as.type === "refund" ? "退款" : as.type === "resend" ? "补发" : "退货"} $${as.amountUsd} 在自动上限 $${params.value.autoRefundCapUsd} 内，已自动执行并留痕。` });
      return "auto";
    }
    enqueueReview({
      mod: "e4", kind: "order-refund", title: `售后退款核准 · 订单 ${as.orderId}`, refId: as.id, origin: "ai",
      summary: `${as.reason} —— 拟退 $${as.amountUsd}。${d.why}`,
      reasoning: as.proposal || "AI 已核对买家凭证与订单记录。",
      consequence: "不批准需给买家替代方案（补发/部分退款），逾期影响店铺绩效。",
      facts: [
        { k: "订单", v: `${as.orderId}` },
        { k: "金额", v: `$${as.amountUsd}`, warn: as.amountUsd > params.value.autoRefundCapUsd },
        { k: "类型", v: as.type },
      ],
      risk: d.hardGate ? "hard" : "high", hardGate: d.hardGate,
      payload: { afterSaleId: as.id },
    });
    as.status = "proposed";
    return "review";
  }

  /** E4 风控挂起单人工放行：回到待处理流并落台账（人工决策必须可追溯）。 */
  function releaseRiskOrder(orderId: string): boolean {
    const o = orders.value.find((x) => x.id === orderId);
    if (!o || o.status !== "risk_hold") return false;
    o.status = "pending";
    recordAction({ mod: "e4", kind: "risk-release", refId: o.id, by: "human", title: `风控放行 · 订单 ${o.id}`, detail: `风控标记「${o.riskFlag || "—"}」经人工过目放行，转回待处理流。` });
    return true;
  }

  /** 采购付款闸（强制人工）。 */
  function gatePoPayment(poId: string) {
    const po = pos.value.find((x) => x.id === poId);
    if (!po) return;
    enqueueReview({
      mod: "e6", kind: "po-payment", title: `采购付款确认 · ${po.id}`, refId: po.id, origin: "ai",
      summary: `向「${po.supplier}」付款 ¥${po.amountCny.toLocaleString()}（${po.goods} ×${po.qty}）。付款属强制人工动作。`,
      reasoning: `发票${po.invoiceOk ? "已收" : "未收"}、到货${po.grnOk ? "已核对" : "未到"}；三单匹配${po.invoiceOk && po.grnOk ? "齐" : "未齐（预付场景请确认账期条款）"}。`,
      consequence: "不付款则供应商可能延迟排产，影响补货到仓时间。",
      facts: [
        { k: "供应商", v: po.supplier },
        { k: "金额", v: `¥${po.amountCny.toLocaleString()}` },
        { k: "三单匹配", v: `发票${po.invoiceOk ? "✓" : "✗"} 到货${po.grnOk ? "✓" : "✗"}`, warn: !(po.invoiceOk && po.grnOk) },
      ],
      risk: "hard", hardGate: true,
      payload: { poId: po.id },
    });
  }

  /** 报税/退税提交闸（强制人工）。 */
  /** 申报可提交判定（提交前的单点真相）：状态就绪 + 资料包非空且逐项齐全。
   *  status 可能被 localStorage 篡改成 ready，故资料包必须独立复核，不能只信状态位。 */
  function filingDocsComplete(f: TaxFiling): boolean {
    return Array.isArray(f.docsReady) && f.docsReady.length > 0 && f.docsReady.every((d) => d.ok);
  }
  function isFilingReadyForSubmit(f: TaxFiling): boolean {
    return f.status === "ready" && filingDocsComplete(f);
  }

  function gateFilingSubmit(filingId: string) {
    const f = filings.value.find((x) => x.id === filingId);
    if (!f) return;
    // 未就绪的申报不入提交闸：资料未齐/检查未过就递卡片，等于诱导老板批一次错误提交。
    if (!isFilingReadyForSubmit(f)) {
      log("error", `${f.name} 尚未就绪（状态「${f.status}」/资料包未齐），不能入提交闸 —— 先跑税务官检查`);
      return;
    }
    const kind: ReviewKind = f.name.includes("退税") ? "export-rebate" : "tax-filing";
    enqueueReview({
      mod: "e8", kind, title: `${f.name} 提交确认`, refId: f.id, origin: "ai",
      summary: `${f.region} · 期间 ${f.period} · 截止 ${f.due}${f.amountDue !== undefined ? ` · 金额 ${f.currency} ${f.amountDue.toLocaleString()}` : ""}。税务提交属强制人工动作。`,
      reasoning: (f.checkNotes || []).join("；") || "申报前检查报告未生成，建议先跑税务官检查。",
      consequence: "逾期申报将产生滞纳金/罚款，德国 VAT 逾期可能触发平台限售。",
      facts: (f.docsReady || []).map((doc) => ({ k: doc.name, v: doc.ok ? "已备" : "缺", warn: !doc.ok })),
      risk: "hard", hardGate: true,
      payload: { filingId: f.id },
    });
  }

  /** 关键参数（自治边界/红线类）改动走审批；其余直接生效并记版本。 */
  const CRITICAL_PARAMS: ReadonlySet<keyof ErpParams> = new Set([
    "minMarginFloorPct", "autoAmountCapUsd", "autoRefundCapUsd", "ocrAutoBookConf", "ocrAutoBookCapCny", "priceAutoBandPct", "dailyActionCap",
  ] as (keyof ErpParams)[]);
  function applyParamInternal(key: keyof ErpParams, to: number, by: "human" | "ai", note?: string) {
    const from = params.value[key];
    if (from === to) return;
    params.value = { ...params.value, [key]: to };
    paramLog.value.unshift({ at: Date.now(), key, from, to, by, note });
    log("ok", `参数生效：${String(key)} ${from} → ${to}`);
  }
  /** 百分比类参数的合理上限（防止单个费率被设成荒谬值，或组合后使可变成本≥100% 令保本价爆 Infinity）。 */
  const PCT_PARAMS: ReadonlySet<keyof ErpParams> = new Set([
    "targetMarginPct", "minMarginFloorPct", "priceAutoBandPct", "platformFeePct", "adCostPct", "returnRatePct",
  ] as (keyof ErpParams)[]);
  /** 校验拟改某百分比参数后整套参数是否仍自洽（单参 <100% 且可变成本+利润率 <100%）。setParam 提交闸与
   *  param-change 批准回写共用同一约束——否则等待审批期间别的参数变了，批准时可能把组合推到 ≥100% 令保本价爆 Infinity。 */
  function pctParamInvalidReason(key: keyof ErpParams, to: number): string | null {
    if (!PCT_PARAMS.has(key)) return null;
    if (to >= 100) return `${String(key)} = ${to}% 超出合理上限（<100%）`;
    const probe = { ...params.value, [key]: to };
    const varCost = probe.platformFeePct + probe.adCostPct + probe.returnRatePct;
    if (varCost + probe.targetMarginPct >= 100 || varCost + probe.minMarginFloorPct >= 100) {
      return `${String(key)} = ${to}% 会使可变成本+利润率≥100%（保本价无法计算）`;
    }
    return null;
  }
  function setParam(key: keyof ErpParams, to: number): "applied" | "review" | "invalid" {
    // 所有经营参数按业务定义均为正数；0/负数/NaN 会让利润与保本价除零爆 Infinity，核心层直接拒绝。
    if (!Number.isFinite(to) || to <= 0) {
      log("error", `参数 ${String(key)} 收到非法值 ${to}，已拒绝（须为正数）`);
      return "invalid";
    }
    const pctBad = pctParamInvalidReason(key, to);
    if (pctBad) {
      log("error", `参数拒绝：${pctBad}`);
      return "invalid";
    }
    const from = params.value[key];
    if (from === to) return "applied";
    if (CRITICAL_PARAMS.has(key)) {
      enqueueReview({
        mod: "e9", kind: "param-change", title: `关键参数修改 · ${String(key)}`, refId: String(key), origin: "manual",
        summary: `${String(key)}：${from} → ${to}。该参数属自治边界/红线，改动需确认一次。`,
        reasoning: "参数中心是系统宪法：这个改动会即刻改变 AI 代理的自动执行边界。",
        consequence: "不批准则维持原边界。",
        facts: [{ k: "参数", v: String(key) }, { k: "变化", v: `${from} → ${to}`, warn: true }],
        risk: "high",
        payload: { key, to },
      });
      return "review";
    }
    applyParamInternal(key, to, "human");
    return "applied";
  }

  /* ══════════ 驾驶舱派生 ══════════ */
  const stalledShipments = computed(() => shipments.value.filter((s) => s.stalled || s.status === "停滞"));
  const openRecon = computed(() => recon.value.filter((r) => r.status === "未达" || r.status === "待确认"));
  const lowStock = computed(() => stock.value.filter((s) => s.daysLeft < params.value.safetyStockDays + params.value.leadTimeDays));
  const unbookedDocs = computed(() => docs.value.filter((d) => !d.booked));
  // 按截止日升序：驾驶舱「最近截止」取 [0]，未排序会因数组顺序误报更晚的申报为最近。
  const dueFilings = computed(() =>
    filings.value
      .filter((f) => f.status !== "submitted" && f.status !== "archived")
      .slice()
      .sort((a, b) => a.due.localeCompare(b.due))
  );
  const riskOrders = computed(() => orders.value.filter((o) => o.status === "risk_hold"));
  const monthGmv = computed(() => {
    const cur = reports.value[reports.value.length - 1];
    return cur ? cur.gmvUsd : 0;
  });

  const dashKpi = computed(() => [
    { v: `$${(monthGmv.value / 1000).toFixed(1)}k`, l: "本月 GMV", d: `目标 $${(params.value.monthlyGmvTarget / 1000).toFixed(0)}k · 达成 ${params.value.monthlyGmvTarget > 0 ? Math.round((monthGmv.value / params.value.monthlyGmvTarget) * 100) : 0}%`, up: true, acc: "gold", ico: EICONS.dash },
    { v: String(pendingCount.value), l: "待你审批", d: pendingHardGates.value.length ? `含 ${pendingHardGates.value.length} 项强制人工` : "无硬闸", up: pendingHardGates.value.length === 0, acc: pendingHardGates.value.length ? "red" : "green", ico: EICONS.review },
    { v: `${autonomyStats.value.autoRate}%`, l: "无人化率", d: `${autonomyStats.value.auto} 自动 / ${autonomyStats.value.human} 人工`, up: true, acc: "blue", ico: EICONS.params },
    { v: String(lowStock.value.length), l: "库存告警", d: lowStock.value[0] ? `${lowStock.value[0].name} 剩 ${lowStock.value[0].daysLeft} 天` : "库存健康", up: lowStock.value.length === 0, acc: "amber", ico: EICONS.purchase },
    { v: String(stalledShipments.value.length + riskOrders.value.length), l: "履约异常", d: stalledShipments.value.length ? `${stalledShipments.value[0].id} 停滞 ${stalledShipments.value[0].days} 天` : riskOrders.value.length ? "风控挂起订单" : "链路正常", up: stalledShipments.value.length + riskOrders.value.length === 0, acc: "red", ico: EICONS.logistics },
    { v: String(dueFilings.value.length), l: "申报事项", d: dueFilings.value[0] ? `最近截止 ${dueFilings.value[0].due}` : "无待办", acc: "purple", ico: EICONS.tax },
  ]);

  const briefing = computed(() => {
    const done = executedActions.value.slice(0, 5).map((a) => `${a.by === "auto" ? "自动" : "人工"} · ${a.title}：${a.detail}`);
    const todo = reviewTasks.value
      .filter((t) => t.status === "pending" || t.status === "in_review")
      .sort((a, b) => (b.hardGate ? 1 : 0) - (a.hardGate ? 1 : 0))
      .slice(0, 6)
      .map((t) => `${t.hardGate ? "【强制人工】" : ""}${t.title}`);
    const risk: string[] = [];
    pendingHardGates.value.forEach((t) => risk.push(`强制人工：${t.title}`));
    stalledShipments.value.forEach((s) => risk.push(`物流停滞：${s.id} 已 ${s.days} 天（${s.goods}）`));
    lowStock.value.forEach((s) => risk.push(`库存：${s.name} 可售 ${s.daysLeft} 天 < 安全线 ${params.value.safetyStockDays + params.value.leadTimeDays} 天`));
    openRecon.value.filter((r) => r.status === "未达").forEach((r) => risk.push(`未达账项：${r.item} ${r.amount}`));
    dueFilings.value.filter((f) => f.status === "ready").forEach((f) => risk.push(`申报就绪待提交：${f.name}（截止 ${f.due}）`));
    return [
      { k: "代理们做了什么", items: done.length ? done : ["暂无执行记录 —— 在各模块跑 AI 动作或批准审批卡片后自动记录"] },
      { k: "今日待你决策", items: todo.length ? todo : ["审批队列已清空"] },
      { k: "风险预警", items: risk.length ? risk : ["无风险项"] },
    ];
  });

  /* ══════════ 初始化 ══════════ */
  function load() {
    products.value = lsLoad(ELS.products, seed.seedProducts());
    listings.value = lsLoad(ELS.listings, seed.seedListings());
    prices.value = lsLoad(ELS.prices, seed.seedPrices());
    orders.value = lsLoad(ELS.orders, seed.seedOrders());
    afterSales.value = lsLoad(ELS.afterSales, seed.seedAfterSales());
    channels.value = lsLoad(ELS.channels, seed.seedChannels());
    shipments.value = lsLoad(ELS.shipments, seed.seedShipments());
    pos.value = lsLoad(ELS.pos, seed.seedPos());
    stock.value = lsLoad(ELS.stock, seed.seedStock());
    docs.value = lsLoad(ELS.docs, seed.seedDocs());
    bundles.value = lsLoad(ELS.bundles, seed.seedBundles());
    journal.value = lsLoad(ELS.journal, seed.seedJournal());
    recon.value = lsLoad(ELS.recon, seed.seedRecon());
    reports.value = lsLoad(ELS.reports, seed.seedReports());
    filings.value = lsLoad(ELS.filings, seed.seedFilings());
    params.value = sanitizeParams(lsLoad<Partial<ErpParams>>(ELS.params, {}));
    paramLog.value = lsLoad(ELS.paramLog, []);
    // 旧版本 localStorage 的审批卡可能缺 facts/payload（schema 演进）——组件会 facts.length 崩。
    // 载入即规范化：数组兜底 + 每条卡片补齐 facts:[]，避免升级后一读即崩。
    reviewTasks.value = (Array.isArray(lsLoad(ELS.reviews, [])) ? lsLoad<ReviewTask[]>(ELS.reviews, []) : []).map((t) => ({
      ...t, facts: Array.isArray(t?.facts) ? t.facts : [], payload: t?.payload ?? {},
    }));
    runs.value = lsLoad(ELS.runs, []);
    executedActions.value = lsLoad(ELS.executed, []);
    if (!lsLoad<boolean>(ELS.seeded, false)) {
      seedInitialReviews();
      // 立即落盘：autopersist 的 watcher 此刻尚未注册，若只标记 seeded 不写 reviews，
      // 用户「看一眼就关」会导致种子审批卡片永久丢失（seeded 已 true 不再重播）。
      lsSave(ELS.reviews, reviewTasks.value);
      lsSave(ELS.seeded, true);
    }
  }

  /** 首次载入：把种子数据里的既有闸铺进流水线，审批中心开箱即有内容。 */
  function seedInitialReviews() {
    gatePoPayment("PO-2407");
    gateFilingSubmit("F-63");
    const d906 = docs.value.find((x) => x.id === "D-906");
    if (d906) {
      enqueueReview({
        mod: "e7", kind: "ocr-book", title: "票据入账确认 · 义乌恒达（疑似重复）", refId: d906.id, origin: "ai",
        summary: "票号 033002400872 与 6 月已入账票据前缀高度相似，查重存疑 + 购方税号尾两位低置信，拦截待核。",
        reasoning: "OCR 置信 96% < 阈值 98%，且查重器标记 suspect。",
        consequence: "误入重复票会虚增进项，触发税务风险。",
        facts: [
          { k: "票号", v: "033002400872", warn: true },
          { k: "金额", v: "¥25,200（税额 ¥2,899.12）" },
          { k: "低置信字段", v: "购方税号尾两位", warn: true },
        ],
        risk: "high",
        payload: { docId: d906.id },
      });
    }
    const r22 = recon.value.find((x) => x.id === "R-22");
    if (r22) {
      enqueueReview({
        mod: "e7", kind: "recon-open", title: "结汇入账匹配确认 · ¥129,876.20", refId: r22.id, origin: "ai",
        summary: "PingPong 结汇与招行入账候选匹配 CMB-0703-1102（置信 97%），确认后回写「已匹配」。",
        reasoning: "金额差 ¥1,285.10 与同日汇差+手续费挂账项吻合。",
        consequence: "不确认则 6 月银行对账无法闭合，影响月结。",
        facts: [
          { k: "金额", v: "¥129,876.20" },
          { k: "候选", v: "CMB-0703-1102 · 置信 97%" },
          { k: "差额去向", v: "汇兑损益挂账 ¥1,285.10", source: "R-23 费用挂账" },
        ],
        risk: "normal",
        payload: { reconId: r22.id },
      });
    }
    const l103 = listings.value.find((x) => x.id === "L-103");
    if (l103) {
      enqueueReview({
        mod: "e2", kind: "listing-publish", title: "Temu 猫胸背带 Listing 发布核准", refId: l103.id, origin: "ai",
        summary: "新品 Listing 四项规则体检全过，核准后发布上线。",
        reasoning: "标题前 80 字符含核心词 escape proof cat harness；无禁词；图片合规。",
        consequence: "不发布则 Temu 渠道该 SKU 持续空窗。",
        facts: l103.checks.map((c) => ({ k: c.name, v: c.pass ? "通过" : c.note || "未过", warn: !c.pass })),
        risk: "normal",
        payload: { listingId: l103.id },
      });
    }
    const rep6 = reports.value.find((x) => x.month === "2026-06");
    if (rep6) {
      enqueueReview({
        mod: "e7", kind: "month-close", title: "2026-06 月结确认", refId: rep6.month, origin: "ai",
        summary: `6 月三表已出：GMV $${rep6.gmvUsd.toLocaleString()}、净利 ¥${rep6.netProfitCny.toLocaleString()}（净利率 ${rep6.marginPct}%）。确认后锁账。`,
        reasoning: "计提/结转已完成；仅剩 R-22/R-23/R-24 三笔对账待闭合（不阻断月结，可先锁经营口径）。",
        consequence: "不锁账则 7 月报表基期漂移。",
        facts: [
          { k: "GMV", v: `$${rep6.gmvUsd.toLocaleString()}` },
          { k: "净利", v: `¥${rep6.netProfitCny.toLocaleString()}` },
          { k: "待闭合对账", v: "3 笔", warn: true },
        ],
        risk: "normal",
        payload: { month: rep6.month },
      });
    }
  }

  function resetAll() {
    Object.values(ELS).forEach((k) => localStorage.removeItem(k));
    load();
  }

  /* ══════════ Claude 驱动动作 ══════════ */

  /** 通用对话（右侧 AI 坞）。 */
  async function runChat(
    modName: string, modSub: string, text: string, useKb: boolean,
    hooks?: { onDelta?: (delta: string, full: string) => void; onTool?: (tool: string, detail?: string) => void; signal?: AbortSignal }
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

  /** E1 选品官：调研。 */
  async function runResearch(c: { keywords: string; category: string; priceBand: string; count: number }): Promise<number> {
    clearConsole();
    runStatus.value = "选品调研中…";
    log("info", `选品调研：${c.keywords || c.category || "默认方向"}`);
    const toolSink: AgentRun["tools"] = [];
    try {
      const { data } = await runJson<{ candidates: Array<Omit<Product, "id" | "state" | "marginPct" | "provenance" | "platforms">> }>({
        prompt: P.promptResearch(c), goal: "选品调研并结构化", useKb: true, ...makeCallbacks(toolSink),
      });
      const list = Array.isArray(data?.candidates) ? data.candidates : [];
      list.forEach((x) => {
        const margin = computeProfit(Number(x.priceUsd) || 0, Number(x.costCny) || 0, Number(x.shipUsd) || 0, params.value).marginPct;
        products.value.unshift({
          ...x, id: uid("P"), state: "candidate", marginPct: margin, provenance: "ai", platforms: [],
          costCny: Number(x.costCny) || 0, shipUsd: Number(x.shipUsd) || 0, priceUsd: Number(x.priceUsd) || 0,
          rivalUsd: Number(x.rivalUsd) || 0, monthlySales: Number(x.monthlySales) || 0, score: Number(x.score) || 0,
        });
      });
      addRun({ mod: "e1", kind: "research", inputSummary: c.keywords || c.category, resultSummary: `产出 ${list.length} 个候选`, tools: toolSink });
      runStatus.value = `调研完成，新增 ${list.length} 个候选`;
      log("ok", runStatus.value);
      return list.length;
    } catch (e) {
      runStatus.value = `调研失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return 0;
    }
  }

  /** E2 运营官：生成/优化 Listing（产出→发布闸）。 */
  async function runListingGen(listingId: string, feedback?: string): Promise<boolean> {
    const l = listings.value.find((x) => x.id === listingId);
    if (!l) return false;
    const prod = products.value.find((x) => x.id === l.productId);
    if (!prod) return false;
    const mode = l.status === "live" || l.status === "optimizing" ? "optimize" : "create";
    runStatus.value = `生成 Listing · ${l.productName}…`;
    log("info", `${mode === "create" ? "生成" : "优化"} ${l.platform} Listing · ${l.productName}`);
    const toolSink: AgentRun["tools"] = [];
    try {
      const { data } = await runJson<{ title: string; bullets: string[]; keywords: string; rationale: string }>({
        prompt: P.promptListing(prod, l.platform, l.lang, mode, { title: l.title, cvr: l.cvr }, feedback), useKb: false, ...makeCallbacks(toolSink),
      });
      addRun({ mod: "e2", kind: mode === "create" ? "listing-gen" : "listing-opt", inputSummary: l.productName, resultSummary: data.title.slice(0, 40), tools: toolSink });
      const kind: ReviewKind = mode === "create" ? "listing-publish" : "listing-update";
      enqueueReview({
        mod: "e2", kind, title: `${l.platform} ${l.productName} ${mode === "create" ? "发布" : "改版"}核准`, refId: l.id, origin: "ai",
        summary: `AI 已${mode === "create" ? "生成新" : "重写在售"} Listing，核准后${mode === "create" ? "发布" : "覆盖线上内容"}。`,
        reasoning: data.rationale,
        consequence: mode === "create" ? "不发布则该渠道空窗。" : "不改版则转化率维持现状。",
        facts: [
          { k: "新标题", v: data.title.slice(0, 90) },
          { k: "五点", v: `${(data.bullets || []).length} 条` },
          { k: "当前转化率", v: l.cvr !== undefined ? `${l.cvr}%` : "新品" },
        ],
        risk: mode === "create" ? "normal" : "high",
        payload: { listingId: l.id, title: data.title, bullets: data.bullets, keywords: data.keywords },
      });
      l.proposal = data.rationale;
      runStatus.value = `Listing 已生成，入${mode === "create" ? "发布" : "改版"}核准闸`;
      log("ok", runStatus.value);
      return true;
    } catch (e) {
      runStatus.value = `生成失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return false;
    }
  }

  /** E3 定价官：调价建议 → 策略分流（带宽内自动 / 超幅进闸 / 低于底线硬闸）。 */
  async function runPriceAdvice(sku: string, platform: string, context: string, feedback?: string): Promise<"auto" | "review" | null> {
    const card = prices.value.find((x) => x.sku === sku && x.platform === platform);
    if (!card) return null;
    runStatus.value = `定价分析 · ${card.name}…`;
    log("info", `定价分析 · ${card.name}（${platform}）`);
    const toolSink: AgentRun["tools"] = [];
    try {
      const { data } = await runJson<{ newPrice: number; reason: string; marginPct: number; confidence: number }>({
        prompt: P.promptPricing(card, context, feedback), useKb: false, ...makeCallbacks(toolSink),
      });
      addRun({ mod: "e3", kind: "price-advice", inputSummary: `${card.name}@${platform}`, resultSummary: `$${data.newPrice}`, tools: toolSink });
      const r = proposePriceChange(sku, platform, Number(data.newPrice), data.reason, Number(data.confidence) || 80);
      runStatus.value = r === "auto" ? `带宽内已自动调价 $${data.newPrice}` : `调价提案已入审批闸`;
      log("ok", runStatus.value);
      return r;
    } catch (e) {
      runStatus.value = `定价分析失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return null;
    }
  }

  /** E5 物流官：为订单选路 → 策略分流（高值进闸）。 */
  async function runRoute(orderId: string): Promise<"auto" | "review" | null> {
    const o = orders.value.find((x) => x.id === orderId);
    if (!o) return null;
    const weightG = 220 * o.qty;
    const battery = /饮水机|电/.test(o.goods);
    const chTable = channels.value.map((c) => `${c.name}|${c.zone}|首重¥${c.firstWeightCny}|¥${c.perGramCny}/g|${c.days}天|${c.battery ? "可带电" : "普货"}`).join("\n");
    runStatus.value = `物流选路 · ${o.id}…`;
    log("info", `选路 · ${o.goods} → ${o.country}`);
    const toolSink: AgentRun["tools"] = [];
    try {
      const { data } = await runJson<{ channel: string; costCny: number; reason: string; confidence: number }>({
        prompt: P.promptRoute(o.goods, o.country, weightG, battery, chTable), useKb: false, ...makeCallbacks(toolSink),
      });
      addRun({ mod: "e5", kind: "route", inputSummary: o.id, resultSummary: data.channel, tools: toolSink });
      // AI 选路结果校验：渠道必须在渠道库中、运费必须为有限正数、带电件必须走可带电渠道、AI 置信须足够；
      // 任一不满足则不自动出单（否则会以负/零运费、空渠道、不存在渠道或低置信自动建运单并把订单误置 shipped）。
      const chosen = channels.value.find((c) => c.name === String(data.channel || "").trim());
      const cost = Number(data.costCny);
      const conf = Number(data.confidence);
      const lowConf = !Number.isFinite(conf) || conf < 80; // 与调价/OCR 口径一致：AI 置信不足转人工确认
      const routeValid = !!chosen && Number.isFinite(cost) && cost > 0 && (!battery || chosen.battery) && !lowConf;
      const d = decide("logistics-channel", { amountUsd: o.amountUsd });
      if (d.mode === "auto" && routeValid) {
        createShipment(o.id, o.goods, o.country, chosen!.name, weightG, cost, data.reason, "auto");
        runStatus.value = `已自动出单（${chosen!.name}）`;
        log("ok", runStatus.value);
        return "auto";
      }
      if (!routeValid) log("info", `选路结果需人工核对（渠道「${data.channel}」/运费 ${data.costCny}/带电 ${battery}/置信 ${data.confidence}），转渠道核准闸`);
      enqueueReview({
        mod: "e5", kind: "logistics-channel", title: `渠道核准 · 订单 ${o.id}`, refId: o.id, origin: "ai",
        summary: `拟走「${data.channel}」，运费 ¥${data.costCny}。${d.why}`,
        reasoning: data.reason,
        consequence: "不核准则订单滞留待发，超 48h 影响店铺绩效。",
        facts: [
          { k: "货物", v: `${o.goods} ×${o.qty}（${battery ? "带电" : "普货"}）` },
          { k: "货值", v: `$${o.amountUsd}`, warn: o.amountUsd >= params.value.highValueShipmentUsd },
          { k: "拟选渠道", v: `${data.channel} · ¥${data.costCny}` },
        ],
        risk: "high",
        payload: { orderId: o.id, goods: o.goods, to: o.country, channel: data.channel, weightG, costCny: data.costCny, reason: data.reason },
      });
      runStatus.value = `选路提案已入渠道核准闸`;
      log("ok", runStatus.value);
      return "review";
    } catch (e) {
      runStatus.value = `选路失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return null;
    }
  }

  /** E6 供应链官：补货建议 → PO 闸。 */
  async function runReplenish(): Promise<number> {
    runStatus.value = "补货测算中…";
    log("info", `智能补货测算`);
    const toolSink: AgentRun["tools"] = [];
    try {
      const { data } = await runJson<{ suggestions: Array<{ sku: string; name: string; qty: number; reason: string; supplier: string; unitCny: number }> }>({
        prompt: P.promptReplenish(
          JSON.stringify(stock.value),
          `安全库存 ${params.value.safetyStockDays} 天，备货周期 ${params.value.leadTimeDays} 天；历史供应商：${pos.value.map((x) => `${x.sku}=${x.supplier}@¥${x.unitCny}`).join("，")}`
        ), useKb: false, ...makeCallbacks(toolSink),
      });
      const raw = Array.isArray(data?.suggestions) ? data.suggestions : [];
      // AI 输出防线：只接受数量为正整数、单价为有限正数、sku/名称齐备的建议，否则不入闸（防负额/NaN 提案）。
      const list = raw.filter((s) => {
        const qty = Number(s?.qty), unit = Number(s?.unitCny);
        const ok = Number.isInteger(qty) && qty > 0 && Number.isFinite(unit) && unit > 0 && String(s?.sku || "").trim() && String(s?.name || "").trim();
        if (!ok) log("error", `补货建议非法已跳过（${s?.name || s?.sku || "?"}：qty=${s?.qty} unit=${s?.unitCny}）`);
        return ok;
      });
      list.forEach((s) => {
        enqueueReview({
          mod: "e6", kind: "replenish-po", title: `补货 PO 确认 · ${s.name}`, refId: s.sku, origin: "ai",
          summary: `建议补 ${s.qty} 件（${s.supplier} · ¥${s.unitCny}/件 ≈ ¥${round2(s.qty * s.unitCny).toLocaleString()}）。`,
          reasoning: s.reason,
          consequence: "不补货则按当前销速将断货，断货重推排名成本高。",
          facts: [
            { k: "建议量", v: `${s.qty} 件` },
            { k: "预算", v: `¥${round2(s.qty * s.unitCny).toLocaleString()}` },
            { k: "供应商", v: s.supplier },
          ],
          risk: "high",
          payload: { sku: s.sku, goods: s.name, qty: s.qty, unitCny: s.unitCny, supplier: s.supplier },
        });
      });
      addRun({ mod: "e6", kind: "replenish", inputSummary: "四态库存", resultSummary: `${list.length} 条补货建议`, tools: toolSink });
      runStatus.value = `${list.length} 条补货建议已入 PO 确认闸`;
      log("ok", runStatus.value);
      return list.length;
    } catch (e) {
      runStatus.value = `补货测算失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return 0;
    }
  }

  /** E7 财务官：票据 OCR（粘贴文本 → 结构化 → 策略分流入账）。 */
  async function runOcr(rawText: string, feedback?: string): Promise<EvidenceDoc | null> {
    if (!rawText.trim()) return null;
    runStatus.value = "票据识别中…";
    log("info", `票据 OCR 识别`);
    const toolSink: AgentRun["tools"] = [];
    try {
      const { data } = await runJson<{ type: DocType; party: string; no: string; date: string; amount: number; currency: "CNY" | "USD" | "EUR"; taxAmount?: number; conf: number; lowFields: string[]; suggestBundle: string }>({
        prompt: P.promptOcr(rawText, feedback), useKb: false, ...makeCallbacks(toolSink),
      });
      addRun({ mod: "e7", kind: "ocr", inputSummary: rawText.slice(0, 30), resultSummary: `${data.party} ${data.currency}${data.amount}`, tools: toolSink });
      // AI 输出不可信假设：类型/币种必须是合法枚举、金额必须为有限正数、票号/对手方/日期必须齐备，否则整单拒绝落库。
      // 用 Object.hasOwn 而非 `in`：后者会把 toString/constructor/__proto__ 等原型链键误判为合法票种，落库后 bookDoc 查 RULE 会炸。
      // 币种不默认 CNY：缺失币种的美元票若默认 CNY 会按 1:1 入账，金额严重失真——缺失/非法一律拒绝。
      const amount = Number(data.amount);
      const currency = data.currency as string;
      const party = (data.party || "").trim();
      const no = (data.no || "").trim();
      const date = (data.date || "").trim();
      const badReason = docCoreInvalidReason({ type: data.type, currency, amount, party, no, date });
      if (badReason) {
        runStatus.value = `识别结果非法（${badReason}），已拒绝落库`;
        log("error", runStatus.value);
        return null;
      }
      const doc = intakeDoc({
        type: data.type, party, no, date,
        amount, currency: currency as "CNY" | "USD" | "EUR",
        // 税额只对增值税发票且为正数时保留：非发票（银行回单/物流账单等）按 prompt 示例可能返回 taxAmount:0，
        // 保存后台账会显示「税额 ¥0」而非「—」，语义错。仅 vat-invoice 且 >0 才记。
        taxAmount: data.type === "vat-invoice" && Number.isFinite(Number(data.taxAmount)) && Number(data.taxAmount) > 0 ? Number(data.taxAmount) : undefined,
        conf: Number(data.conf) || 0,
        // lowFields 必须规范化为数组：AI 可能返回字符串（如 "金额"），落库后 intakeDoc 组卡时 .join() 会抛错，
        // 且 doc 已 unshift 导致「僵尸票据」（已落库、未入账、无审批卡）。类型标注是 string[]，但运行时不可信。
        lowFields: normalizeLowFields(data.lowFields as unknown),
      }, rawText);
      // 业务包线索：按建议归入或新建
      if (data.suggestBundle) {
        let b = bundles.value.find((x) => x.title.includes(data.suggestBundle));
        if (!b) {
          b = { id: uid("B"), title: `${data.suggestBundle} 业务包`, docIds: [], status: "partial" };
          bundles.value.unshift(b);
        }
        b.docIds.push(doc.id);
        doc.bundleId = b.id;
      }
      runStatus.value = doc.booked ? `高置信已自动入账（${doc.conf}%）` : `已识别，入人工确认闸`;
      log("ok", runStatus.value);
      return doc;
    } catch (e) {
      runStatus.value = `识别失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return null;
    }
  }

  /** E7 财务官：对账候选匹配。 */
  async function runRecon(reconId: string, feedback?: string): Promise<boolean> {
    const r = recon.value.find((x) => x.id === reconId);
    if (!r) return false;
    runStatus.value = `对账辅助 · ${r.item}…`;
    const toolSink: AgentRun["tools"] = [];
    try {
      const { data } = await runJson<{ candidates: { target: string; reason: string; conf: number }[] }>({
        prompt: P.promptRecon(r, feedback), useKb: false, ...makeCallbacks(toolSink),
      });
      const top = (data.candidates || [])[0];
      // 候选必须是真实匹配对象：空串或「未找到候选」这类伪候选都不写回，否则批准后把未达账项假闭合为「已匹配」。
      const target = String(top?.target || "").trim();
      if (top && isRealReconTarget(target)) {
        r.match = target;
        r.conf = Number(top.conf) || 0;
        r.status = "待确认";
        enqueueReview({
          mod: "e7", kind: "recon-open", title: `对账匹配确认 · ${r.item}`, refId: r.id, origin: "ai",
          summary: `AI 候选：${target}（置信 ${top.conf}%），确认后回写。`,
          reasoning: top.reason,
          consequence: "不处理则该账项持续未达，影响月结与现金流视图。",
          facts: [
            { k: "金额", v: r.amount },
            { k: "候选", v: `${target} · ${top.conf}%` },
          ],
          risk: "normal",
          payload: { reconId: r.id },
        });
      } else {
        log("info", `${r.item} 未生成有效候选（AI 未给出匹配对象），保留原状态`);
      }
      addRun({ mod: "e7", kind: "recon", inputSummary: r.item, resultSummary: target || "无候选", tools: toolSink });
      runStatus.value = target ? `对账候选已生成` : `对账完成：无有效候选`;
      log("ok", runStatus.value);
      return true;
    } catch (e) {
      runStatus.value = `对账失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return false;
    }
  }

  /** E8 税务官：申报前检查报告 → 就绪后入提交闸（提交本身强制人工）。 */
  async function runTaxCheck(filingId: string): Promise<boolean> {
    const f = filings.value.find((x) => x.id === filingId);
    if (!f) return false;
    // 已提交/已归档的申报不可重查：否则状态会被拉回 ready 并重新入提交闸，造成对税局重复提交风险。
    if (f.status === "submitted" || f.status === "archived") {
      log("info", `${f.name} 已${f.status === "submitted" ? "提交" : "归档"}，不再重跑申报前检查`);
      return false;
    }
    runStatus.value = `申报前检查 · ${f.name}…`;
    log("info", `申报前检查 · ${f.name}`);
    const toolSink: AgentRun["tools"] = [];
    try {
      const { data } = await runJson<{ issues: string[]; missingDocs: string[]; amountCheck: string; conclusion: string; readyToSubmit: boolean }>({
        prompt: P.promptTaxCheck(f), useKb: true, ...makeCallbacks(toolSink),
      });
      f.checkNotes = [...(data.issues || []), data.amountCheck, data.conclusion].filter(Boolean);
      // 就绪三重条件：AI 判可提交 + AI 未列缺件 + 本地资料包非空且全齐 —— LLM 说就绪不算数，本地台账才是真相。
      const localDocsOk = filingDocsComplete(f);
      if (data.readyToSubmit && !(data.missingDocs || []).length && localDocsOk) {
        f.status = "ready";
        gateFilingSubmit(f.id);
      } else {
        f.status = "preparing";
        if (data.readyToSubmit && !localDocsOk) f.checkNotes.push("AI 判可提交，但本地资料包未配齐（缺清单或未过），维持准备中");
      }
      addRun({ mod: "e8", kind: "tax-check", inputSummary: f.name, resultSummary: data.conclusion?.slice(0, 40) || "", tools: toolSink });
      runStatus.value = f.status === "ready" ? `检查通过，已入提交确认闸（提交需人工）` : `检查完成：${(data.missingDocs || []).length + (f.docsReady || []).filter((x) => !x.ok).length} 项待补`;
      log("ok", runStatus.value);
      return true;
    } catch (e) {
      runStatus.value = `检查失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return false;
    }
  }

  /** E0 总管代理：经营晨报。 */
  async function runBrief(): Promise<string> {
    const snapshot = JSON.stringify({
      月GMV: monthGmv.value, 待审批: pendingCount.value, 硬闸: pendingHardGates.value.map((t) => t.title),
      自动执行近5: executedActions.value.slice(0, 5).map((a) => a.title),
      库存告警: lowStock.value.map((s) => `${s.name}剩${s.daysLeft}天`),
      物流停滞: stalledShipments.value.map((s) => `${s.id}停${s.days}天`),
      未达账项: openRecon.value.map((r) => r.item),
      申报事项: dueFilings.value.map((f) => `${f.name}截止${f.due}`),
    });
    const toolSink: AgentRun["tools"] = [];
    const res = await run({ prompt: P.promptBrief(snapshot), useKb: false, ...makeCallbacks(toolSink) });
    addRun({ mod: "e0", kind: "brief", inputSummary: "经营快照", resultSummary: "晨报已生成", tools: toolSink });
    return res.raw;
  }

  load();

  /** 响应式自动落盘：任一业务状态深度变化即持久化。 */
  function autopersist() {
    const pairs: [{ value: unknown }, string][] = [
      [products, ELS.products], [listings, ELS.listings], [prices, ELS.prices],
      [orders, ELS.orders], [afterSales, ELS.afterSales], [channels, ELS.channels],
      [shipments, ELS.shipments], [pos, ELS.pos], [stock, ELS.stock],
      [docs, ELS.docs], [bundles, ELS.bundles], [journal, ELS.journal],
      [recon, ELS.recon], [reports, ELS.reports], [filings, ELS.filings],
      [params, ELS.params], [paramLog, ELS.paramLog],
      [reviewTasks, ELS.reviews], [runs, ELS.runs], [executedActions, ELS.executed],
    ];
    pairs.forEach(([r, key]) => watch(() => r.value, (v) => lsSave(key, v), { deep: true }));
  }
  autopersist();

  return {
    // state
    products, listings, prices, orders, afterSales, channels, shipments, pos, stock,
    docs, bundles, journal, recon, reports, filings, params, paramLog,
    reviewTasks, runs, executedActions, consoleLines, runStatus, busy, activeMod,
    // derived
    dashKpi, briefing, autonomyStats, pendingHardGates, pendingCount, reviewColumns,
    stalledShipments, openRecon, lowStock, unbookedDocs, dueFilings, riskOrders, monthGmv,
    // nav
    view, go,
    // policy + core（确定性执行）
    decide, floorPrice, proposePriceChange, proposeAfterSale, intakeDoc, bookDoc,
    gatePoPayment, gateFilingSubmit, setParam, createShipment, releaseRiskOrder,
    // review pipeline
    enqueueReview, claimReview, approveReview, rejectReview, resetReview,
    // console
    log, clearConsole, resetAll,
    // claude actions
    runChat, runResearch, runListingGen, runPriceAdvice, runRoute, runReplenish,
    runOcr, runRecon, runTaxCheck, runBrief,
  };
}

export function useErpStore() {
  if (!singleton) singleton = create();
  return singleton;
}
