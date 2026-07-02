/**
 * 北极星外贸 OS —— 原生桌面模块 · 数据形状契约（frozen contract）。
 *
 * 这是全部 12 个业务模块 + 人工审核流水线共享的类型底座。所有模块组件
 * （M0Dashboard.vue … M11Knowledge.vue）与 useTradeStore 都依赖本文件。
 *
 * 设计对齐 KOC/竞品/PMKT 原生范式：
 *  - 每个业务对象带 provenance（user/inferred/ai）与字段级置信度。
 *  - 每个「人工闸」都产出一个 ReviewTask，进中央审核看板流水线。
 *  - 一切持久化（localStorage，key 前缀 chuanying.trade.*）。
 *
 * 业务背景：澳洲进口分销商『澳鲸进口 / Orca Imports Pty Ltd』（葡萄酒/食品）。
 * 数据算例源自两份 PRD（货柜 0617 Shiraz、Viña Aurora 智利线索、WET 29%/GST 10%/ChAFTA）。
 */

/* ══════════════════ 通用 ══════════════════ */

/** 字段来源标记 —— 让「数据从哪来」可见。 */
export type Provenance = "user" | "inferred" | "ai";

/** 模块 id。 */
export type ModId =
  | "m0" | "m1" | "m2" | "m3" | "m4" | "m5"
  | "m6" | "m7" | "m8" | "m9" | "m10" | "m11";

/** 功能栏一项。 */
export interface ModuleDef {
  id: ModId;
  group: string;
  no: string;
  name: string;
  sub: string;
  /** SVG path 内容（19x19 线性图标，见 ICONS）。 */
  icon: string;
  star?: boolean;
  /** 角标数字（待办量）。 */
  pip?: number;
  warn?: boolean;
}

/** 控制台日志行（Agent Console 实时滚动）。 */
export interface ConsoleLine {
  kind: "text" | "tool" | "info" | "error" | "ok";
  text: string;
  at: number;
}

/** Agent RUN 记录（「AI 跑了什么」审计）。 */
export interface AgentRun {
  id: string;
  mod: ModId;
  /** 动作类别（采集/评判/写信/归类/对账…）。 */
  kind: string;
  at: number;
  inputSummary: string;
  resultSummary: string;
  tools: { tool: string; detail?: string; at: number }[];
}

/* ══════════════════ 人工审核流水线（核心） ══════════════════ */

/** 审核看板列。 */
export type ReviewStatus = "pending" | "in_review" | "approved" | "rejected";

/** 审核任务类别（对应各模块的人工闸）。 */
export type ReviewKind =
  | "sku-intake"        // M1 选品入库
  | "outreach-target"   // M2 挑选建联对象（反骚扰）
  | "outreach-send"     // M2 首封开发信外发
  | "lead-convert"      // M2 有意向线索转正式供应商
  | "rfq-send"          // M3 询价群发
  | "quote-writeback"   // M3 回信抽取回写采购单
  | "customs-draft"     // M4 报关草稿确认（闸1）
  | "hs-review"         // M4 HS 归类低置信复核（独立闸，不触发草稿回写）
  | "customs-receipt"   // M4 回执回写（闸2）
  | "doc-consistency"   // M4 三单一致硬差异拦截
  | "milestone-anomaly" // M5 物流异常里程碑
  | "replenish"         // M6 补货建议确认
  | "quote-out"         // M7 报价单外发
  | "order-confirm"     // M7 销售订单确认
  | "recon-match"       // M8 对账候选匹配确认
  | "recon-open"        // M8 未达账项处理
  | "compliance-release"; // M9 缺证放行

/** 风险等级 —— 驱动看板卡片色与排序。 */
export type ReviewRisk = "hard" | "high" | "normal" | "low";

/** 一项人工审核任务。 */
export interface ReviewTask {
  id: string;
  mod: ModId;
  kind: ReviewKind;
  status: ReviewStatus;
  /** 卡片标题。 */
  title: string;
  /** 一句话摘要（审什么）。 */
  summary: string;
  /** 结构化审核要点（key → value，渲染成小表）。 */
  facts: { k: string; v: string; warn?: boolean }[];
  risk: ReviewRisk;
  /** 关联业务对象 id（货柜/线索/订单…）。 */
  refId?: string;
  /** 是否为硬闸（硬差异必须处理，不可跳过导出）。 */
  hardGate?: boolean;
  createdAt: number;
  decidedAt?: number;
  /** 审核意见（驳回原因/批注）。 */
  note?: string;
  decidedBy?: string;
}

/** 审核看板列元信息。 */
export const REVIEW_COLUMNS: { key: ReviewStatus; label: string; hint: string }[] = [
  { key: "pending", label: "待审核", hint: "等待人工介入的闸" },
  { key: "in_review", label: "审核中", hint: "已认领、处理中" },
  { key: "approved", label: "已通过", hint: "放行 / 已回写" },
  { key: "rejected", label: "已驳回", hint: "退回修正 / 拦截" },
];

export const REVIEW_KIND_META: Record<ReviewKind, { label: string; mod: ModId }> = {
  "sku-intake": { label: "选品入库", mod: "m1" },
  "outreach-target": { label: "建联对象核准", mod: "m2" },
  "outreach-send": { label: "开发信外发", mod: "m2" },
  "lead-convert": { label: "线索转供应商", mod: "m2" },
  "rfq-send": { label: "询价群发", mod: "m3" },
  "quote-writeback": { label: "报价回写", mod: "m3" },
  "customs-draft": { label: "报关草稿确认", mod: "m4" },
  "hs-review": { label: "HS 归类复核", mod: "m4" },
  "customs-receipt": { label: "报关回执回写", mod: "m4" },
  "doc-consistency": { label: "三单一致拦截", mod: "m4" },
  "milestone-anomaly": { label: "物流异常确认", mod: "m5" },
  replenish: { label: "补货建议确认", mod: "m6" },
  "quote-out": { label: "报价单外发", mod: "m7" },
  "order-confirm": { label: "销售订单确认", mod: "m7" },
  "recon-match": { label: "对账匹配确认", mod: "m8" },
  "recon-open": { label: "未达账项处理", mod: "m8" },
  "compliance-release": { label: "缺证放行", mod: "m9" },
};

/* ══════════════════ M2 供应商建联 ══════════════════ */

export type LeadStatus = "new" | "contacted" | "replied" | "invalid" | "unsub";
export type ReplyClass = "interested" | "sample" | "quoted" | "rejected" | "irrelevant" | null;

export interface LeadThreadMsg {
  dir: "out" | "in";
  who: string;
  at: string;
  text: string;
}

export interface SupplierLead {
  id: string;
  company: string;
  country: string;
  region: string;
  category: string;
  website: string;
  email: string;
  contact: string;
  /** 来源：选品带出 / 人工录入 / 名录导入。 */
  source: "sourcing" | "manual" | "import";
  grade: "A" | "B" | "C";
  score: number;
  status: LeadStatus;
  /** 画像（key → 值），含字段级置信度 confs。 */
  profile: Record<string, string>;
  confs: Record<string, number>;
  replyClass: ReplyClass;
  thread: LeadThreadMsg[];
  /** 生成的多语言开发信草稿（lang → 正文）。 */
  drafts?: Record<string, string>;
}

export interface OutreachFunnelStage {
  stage: string;
  n: number;
  conv: string;
  color: string;
}

/* ══════════════════ M4 报关单 ══════════════════ */

export type CheckSeverity = "pass" | "soft" | "hard";
export type CustomsStatus = "draft" | "reviewing" | "released" | "inspected";

export interface CustomsLine {
  sku: string;
  desc: string;
  hs: string;
  hsConf: number;
  uom: string;
  uomConf: number;
  qty: number;
  unit: number;
  amount: number;
  origin: string;
  dutyRate: string;
  dutyConf: number;
}

export interface DocConsistencyCheck {
  field: string;
  severity: CheckSeverity;
  decl: string;
  inv: string;
  pack: string;
  bl: string;
  note?: string;
}

export interface CustomsDeclaration {
  id: string;
  po: string;
  supplier: string;
  goods: string;
  type: "import" | "export";
  terms: string;
  currency: string;
  fob: number;
  freight: number;
  insurance: number;
  cif: number;
  origin: string;
  dispatch: string;
  destPort: string;
  bl: string;
  container: string;
  packages: number;
  grossWt: number;
  netWt: number;
  agreement: string;
  coCertNo: string;
  duty: number;
  wet: number;
  gst: number;
  status: CustomsStatus;
  fillRate: number;
  hsComplete: number;
  checkStatus: CheckSeverity;
  lines: CustomsLine[];
  checks: DocConsistencyCheck[];
}

export interface CustomsKpi {
  pending: number;
  reviewing: number;
  released: number;
  inspected: number;
}

export interface CustomsFlowStep {
  n: number;
  title: string;
  desc: string;
  state: "done" | "active" | "todo";
  gate?: boolean;
}

/* ══════════════════ M5 物流 ══════════════════ */

export interface ShipmentMilestone {
  t: string;
  at: string;
  done?: boolean;
  now?: boolean;
}

export interface Shipment {
  id: string;
  bl: string;
  goods: string;
  from: string;
  to: string;
  etaP50: string;
  etaP90: string;
  status: string;
  demurrage: string;
  pct: number;
  milestones: ShipmentMilestone[];
}

/* ══════════════════ M3 供应商公海 ══════════════════ */

export interface Supplier {
  name: string;
  country: string;
  cat: string;
  onTime: number;
  price: number;
  quality: number;
  composite: number;
  grade: string;
  tag: string;
}

/* ══════════════════ M1 选品候选 ══════════════════ */

export interface SkuCandidate {
  id?: string;
  name: string;
  region: string;
  priceBand: string;
  certs: string;
  conf: number;
  provenance?: Provenance;
  /** 入库状态：候选 / 已入库 / 已存为线索 / 已派入库核准闸待审。 */
  state?: "candidate" | "stocked" | "lead" | "reviewing";
}

/* ══════════════════ M6 厂仓 / 补货 ══════════════════ */

export interface StockLot {
  sku: string;
  name: string;
  batch: string;
  qty: number;
  expiry: string;
  /** FEFO 排位（0 = 最先出）。 */
  fefo: number;
  landed: number;
}

export interface ReplenishSuggestion {
  sku: string;
  name: string;
  qty: number;
  by: string;
  reason: string;
}

/* ══════════════════ M7 客户与分销 ══════════════════ */

export interface Customer {
  name: string;
  tier: string;
  terms: string;
  ytd: number;
  open: number;
  status: string;
}

export interface SalesOrder {
  id: string;
  customer: string;
  lines: string;
  incl: number;
  status: string;
}

/* ══════════════════ M8 财务对账 ══════════════════ */

export interface ReconMatch {
  item: string;
  amount: string;
  match: string;
  conf: number;
  status: string;
}

/* ══════════════════ M9 合规中心 ══════════════════ */

export interface ComplianceRow {
  container: string;
  wet: string;
  gst: string;
  tga: string;
  fsanz: string;
  biosecurity: string;
  release: string;
  ok: boolean;
}

/* ══════════════════ M10 工作流 ══════════════════ */

export interface WorkflowRun {
  name: string;
  step: string;
  state: string;
  updated: string;
  pct: number;
}

/* ══════════════════ M11 知识库 ══════════════════ */

export interface KbEntry {
  title: string;
  tag: string;
  links: number;
}

/* ══════════════════ M0 驾驶舱 ══════════════════ */

export interface DashKpi {
  v: string;
  l: string;
  d: string;
  up?: boolean;
  acc: string;
  ico: string;
}

export interface Trend {
  l: string;
  v: string;
  delta: string;
  up: boolean;
  series: number[];
}

export interface PipelineNode {
  c: string;
  l: string;
}

export interface BriefingBlock {
  k: string;
  items: string[];
}

/* ══════════════════ 税费计算（M9 单点真相，M4/M7 共享） ══════════════════ */

/** 澳洲葡萄酒税费口径：WET 29% + GST 10%（WET 计入 GST 基数）。 */
export const TAX = {
  WET_RATE: 0.29,
  GST_RATE: 0.1,
} as const;

/**
 * 单点真相税费函数：给定完税价值（AUD），返回 WET / GST / 税费合计。
 * M4 报关税费测算、M7 报价含税价、M9 合规计算器全部调用此函数，逐分位一致。
 */
export interface TaxBreakdown {
  taxable: number;
  wet: number;
  /** GST 基数 = 完税价值 + WET。 */
  gstBase: number;
  gst: number;
  totalTax: number;
  /** 含税总额。 */
  inclTotal: number;
}

export function computeWineTax(taxableValue: number): TaxBreakdown {
  const taxable = Math.max(0, taxableValue);
  const wet = taxable * TAX.WET_RATE;
  const gstBase = taxable + wet;
  const gst = gstBase * TAX.GST_RATE;
  const totalTax = wet + gst;
  return {
    taxable,
    wet: round2(wet),
    gstBase: round2(gstBase),
    gst: round2(gst),
    totalTax: round2(totalTax),
    inclTotal: round2(taxable + totalTax),
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ══════════════════ 模块清单 + 图标 ══════════════════ */

export const ICONS: Record<string, string> = {
  dash: '<path d="M3 13h8V3H3zM13 21h8V3h-8zM3 21h8v-6H3z"/>',
  sourcing: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  lead: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11h-6M19 8v6"/>',
  purchase: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  logistics: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  warehouse: '<path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12M6 14h12M6 10h12"/>',
  customs: '<path d="M14 2v6h6"/><path d="M4 2h10l6 6v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M9 15l2 2 4-4"/>',
  compliance: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  customer: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  finance: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  workflow: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v3a3 3 0 0 0 3 3h3M15 18h-3"/>',
  kb: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  review: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
};

export const MODULES: ModuleDef[] = [
  { id: "m0", group: "总览", no: "M0", name: "经营驾驶舱", sub: "从选品到对账，一屏看全", icon: ICONS.dash },

  { id: "m1", group: "进货链", no: "M1", name: "选品采集", sub: "自研采集器 · 三级降级", icon: ICONS.sourcing, pip: 18 },
  { id: "m2", group: "进货链", no: "M2", name: "供应商建联", sub: "线索 → 破冰开发信 → 转化", icon: ICONS.lead, star: true, pip: 6 },
  { id: "m3", group: "进货链", no: "M3", name: "供应商与采购", sub: "公海评分 · 询价比价", icon: ICONS.purchase, pip: 4 },
  { id: "m5", group: "进货链", no: "M5", name: "物流管理", sub: "订舱 → 在途 → 到港 → 入仓", icon: ICONS.logistics, pip: 5 },
  { id: "m6", group: "进货链", no: "M6", name: "厂仓 / 补货", sub: "FEFO 效期 · 落地成本 · 补货", icon: ICONS.warehouse },

  { id: "m4", group: "报关合规", no: "M4", name: "报关单撰写", sub: "自动成稿 · HS 归类 · 三单一致", icon: ICONS.customs, star: true, pip: 3, warn: true },
  { id: "m9", group: "报关合规", no: "M9", name: "合规中心", sub: "WET / GST / TGA / Biosecurity", icon: ICONS.compliance, warn: true },

  { id: "m7", group: "分销财务", no: "M7", name: "客户与分销", sub: "B2B 批发 CRM", icon: ICONS.customer, pip: 9 },
  { id: "m8", group: "分销财务", no: "M8", name: "财务对账", sub: "复式账本 · 三方匹配", icon: ICONS.finance, pip: 2 },

  { id: "m10", group: "智能中枢", no: "M10", name: "工作流自动化", sub: "编排心脏 · 挂起 / 恢复", icon: ICONS.workflow, pip: 4 },
  { id: "m11", group: "智能中枢", no: "M11", name: "知识库 llmwiki", sub: "合规要件 · HS 规则 · 话术", icon: ICONS.kb },
];

/** localStorage key 前缀。 */
export const LS = {
  leads: "chuanying.trade.leads.v1",
  declarations: "chuanying.trade.declarations.v1",
  customsFlow: "chuanying.trade.customsFlow.v1",
  shipments: "chuanying.trade.shipments.v1",
  suppliers: "chuanying.trade.suppliers.v1",
  skus: "chuanying.trade.skus.v1",
  stock: "chuanying.trade.stock.v1",
  replenish: "chuanying.trade.replenish.v1",
  customers: "chuanying.trade.customers.v1",
  salesOrders: "chuanying.trade.salesOrders.v1",
  recon: "chuanying.trade.recon.v1",
  compliance: "chuanying.trade.compliance.v1",
  workflows: "chuanying.trade.workflows.v1",
  kb: "chuanying.trade.kb.v1",
  reviews: "chuanying.trade.reviews.v1",
  runs: "chuanying.trade.runs.v1",
  seeded: "chuanying.trade.seeded.v2",
} as const;
