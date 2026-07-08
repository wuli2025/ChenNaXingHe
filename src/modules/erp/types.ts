/**
 * 星河无头ERP —— AI 一人公司操作系统 · 数据形状契约（frozen contract）。
 *
 * 全部 10 个业务模块（E0 驾驶舱 … E9 参数中心）+ 审批中心共享的类型底座。
 * 所有模块组件与 useErpStore 都依赖本文件。
 *
 * 设计范式（承接 PRD《星河无头ERP》v1.0）：
 *  - 无头核心：每个业务能力先定义为「AI 可调用的动作」，界面只是审批与观察窗口。
 *  - 有界自治：动作策略引擎按金额/幅度/置信度分流 —— 自动执行 / 进审批 / 强制人工。
 *  - 强制人工清单（HUMAN_ONLY_ACTIONS）：付款、报税提交、删链接、大额退款，AI 永远无法自动执行。
 *  - 一切持久化 localStorage（key 前缀 cnxh.erp.*），每次执行落 ExecutedAction 台账。
 *
 * 业务背景：跨境电商一人公司『星河出海』——宠物/家居用品，亚马逊 US/DE + Temu，
 * 国内采购（1688/工厂直采），云途/燕文/4PX 头尾程，国内增值税 + 德国 VAT + 出口退税。
 */

/* ══════════════════ 通用 ══════════════════ */

/** 字段来源标记。 */
export type Provenance = "user" | "inferred" | "ai";

/** 模块 id。 */
export type ErpModId =
  | "e0" | "e1" | "e2" | "e3" | "e4"
  | "e5" | "e6" | "e7" | "e8" | "e9";

export interface ErpModuleDef {
  id: ErpModId;
  group: string;
  no: string;
  name: string;
  sub: string;
  icon: string;
  star?: boolean;
  pip?: number;
  warn?: boolean;
}

/** 控制台日志行。 */
export interface ConsoleLine {
  kind: "text" | "tool" | "info" | "error" | "ok";
  text: string;
  at: number;
}

/** Agent RUN 记录（AI 跑了什么，审计）。 */
export interface AgentRun {
  id: string;
  mod: ErpModId;
  kind: string;
  at: number;
  inputSummary: string;
  resultSummary: string;
  tools: { tool: string; detail?: string; at: number }[];
}

/* ══════════════════ 审批流水线（唯一人类界面的核心） ══════════════════ */

export type ReviewStatus = "pending" | "in_review" | "approved" | "rejected";

/** 审批卡片类别 —— 每一种都对应一个业务闸。 */
export type ReviewKind =
  | "listing-publish"   // E2 新品 Listing 发布
  | "listing-update"    // E2 修改在售 Listing（标题/主图/五点）
  | "price-change"      // E3 超幅调价（±带宽内自动，超幅进闸）
  | "order-refund"      // E4 售后退款（超阈值）
  | "logistics-channel" // E5 高值/敏感货渠道选择
  | "claim-send"        // E5 物流索赔函外发
  | "replenish-po"      // E6 补货 PO 确认
  | "po-payment"        // E6 采购付款 —— 强制人工
  | "ocr-book"          // E7 低置信票据入账确认
  | "recon-open"        // E7 对账差异处理
  | "month-close"       // E7 月结确认
  | "tax-filing"        // E8 税务申报提交 —— 强制人工
  | "export-rebate"     // E8 出口退税资料包提交 —— 强制人工
  | "param-change";     // E9 关键参数修改确认

export type ReviewRisk = "hard" | "high" | "normal" | "low";

/** 审批要点一行（k→v，可标警示，可带出处支撑「可验证」）。 */
export interface ReviewFact {
  k: string;
  v: string;
  warn?: boolean;
  source?: string;
}

/** 一张审批卡片（PRD 8.2 规范：摘要+依据+风险+不批的后果+原始凭证引用）。 */
export interface ReviewTask {
  id: string;
  mod: ErpModId;
  kind: ReviewKind;
  status: ReviewStatus;
  title: string;
  /** 一句话摘要（审什么）。 */
  summary: string;
  /** AI 的依据与推理链（为什么建议这么做）。 */
  reasoning?: string;
  /** 不批准的后果。 */
  consequence?: string;
  facts: ReviewFact[];
  risk: ReviewRisk;
  refId?: string;
  /** 硬闸：强制人工清单上的动作，不可配置为自动。 */
  hardGate?: boolean;
  createdAt: number;
  decidedAt?: number;
  note?: string;
  decidedBy?: string;
  origin?: "ai" | "auto" | "manual";
  /** 核准即执行所需数据 + 驳回重跑入参。 */
  payload?: Record<string, unknown>;
  reran?: boolean;
}

/** 已执行动作台账 —— 证据链 + 无人化率度量。 */
export interface ExecutedAction {
  id: string;
  at: number;
  mod: ErpModId;
  kind: ReviewKind | string;
  refId?: string;
  title: string;
  detail: string;
  /** auto=策略引擎自动放行；human=人工核准后执行。 */
  by: "auto" | "human";
}

export const REVIEW_COLUMNS: { key: ReviewStatus; label: string; hint: string }[] = [
  { key: "pending", label: "待审批", hint: "等待老板决策" },
  { key: "in_review", label: "处理中", hint: "已认领、核对中" },
  { key: "approved", label: "已批准", hint: "核准即执行，已回写" },
  { key: "rejected", label: "已驳回", hint: "退回修正，AI 带批注重跑" },
];

export const REVIEW_KIND_META: Record<ReviewKind, { label: string; mod: ErpModId; humanOnly?: boolean }> = {
  "listing-publish": { label: "Listing 发布", mod: "e2" },
  "listing-update": { label: "在售 Listing 修改", mod: "e2" },
  "price-change": { label: "超幅调价", mod: "e3" },
  "order-refund": { label: "售后退款", mod: "e4" },
  "logistics-channel": { label: "物流渠道核准", mod: "e5" },
  "claim-send": { label: "索赔函外发", mod: "e5" },
  "replenish-po": { label: "补货 PO 确认", mod: "e6" },
  "po-payment": { label: "采购付款", mod: "e6", humanOnly: true },
  "ocr-book": { label: "票据入账确认", mod: "e7" },
  "recon-open": { label: "对账差异处理", mod: "e7" },
  "month-close": { label: "月结确认", mod: "e7" },
  "tax-filing": { label: "税务申报提交", mod: "e8", humanOnly: true },
  "export-rebate": { label: "出口退税提交", mod: "e8", humanOnly: true },
  "param-change": { label: "关键参数修改", mod: "e9" },
};

/**
 * 强制人工清单（PRD 8.4）—— 这些动作 AI 永远只能「备好材料等确认」，
 * 策略引擎对它们无条件返回 review + hardGate，参数中心也无法配置为自动。
 */
export const HUMAN_ONLY_ACTIONS: ReadonlySet<ReviewKind> = new Set([
  "po-payment", "tax-filing", "export-rebate",
] as ReviewKind[]);

/* ══════════════════ E9 参数中心（系统「宪法」） ══════════════════ */

/** 经营与自治边界参数 —— AI 一切行为参数的单点真相。改参数=改经营策略。 */
export interface ErpParams {
  /* 经营目标 */
  targetMarginPct: number;        // 目标净利率 %
  minMarginFloorPct: number;      // 最低毛利率红线 %（保本价硬底线，核心层强制）
  monthlyGmvTarget: number;       // 月度 GMV 目标（USD）
  /* 定价策略 */
  priceAutoBandPct: number;       // 自动调价幅度上限 ±%（超幅进审批）
  fxRecalcThresholdPct: number;   // 汇率波动重算阈值 %
  /* 自治边界 */
  autoAmountCapUsd: number;       // 单笔自动执行金额上限（USD）
  autoRefundCapUsd: number;       // 自动退款上限（USD，超出进审批）
  dailyActionCap: number;         // 单代理每日自动动作上限
  /* 财税 */
  ocrAutoBookConf: number;        // OCR 自动入账置信度阈值 %
  ocrAutoBookCapCny: number;      // 自动入账单据金额上限（CNY）
  /* 库存物流 */
  safetyStockDays: number;        // 安全库存天数
  leadTimeDays: number;           // 备货周期（天）
  highValueShipmentUsd: number;   // 高值货件阈值（USD，超出渠道选择进审批）
  /* 成本模型假设 */
  platformFeePct: number;         // 平台佣金 %
  adCostPct: number;              // 广告费占比假设 %
  returnRatePct: number;          // 退货率假设 %
  usdCny: number;                 // 记账汇率 USD→CNY
  eurUsd: number;                 // EUR→USD
}

/** 参数改动历史（带版本与生效说明）。 */
export interface ParamChange {
  at: number;
  key: keyof ErpParams;
  from: number;
  to: number;
  by: "human" | "ai";
  note?: string;
}

export const DEFAULT_PARAMS: ErpParams = {
  targetMarginPct: 25,
  minMarginFloorPct: 12,
  monthlyGmvTarget: 60000,
  priceAutoBandPct: 8,
  fxRecalcThresholdPct: 1.5,
  autoAmountCapUsd: 500,
  autoRefundCapUsd: 40,
  dailyActionCap: 60,
  ocrAutoBookConf: 98,
  ocrAutoBookCapCny: 5000,
  safetyStockDays: 20,
  leadTimeDays: 35,
  highValueShipmentUsd: 800,
  platformFeePct: 15,
  adCostPct: 12,
  returnRatePct: 6,
  usdCny: 7.12,
  eurUsd: 1.08,
};

/* ══════════════════ E1 选品中心 ══════════════════ */

export type ProductState = "candidate" | "sampling" | "testing" | "active" | "dropped";

/** 选品候选 / SKU 主数据（候选→打样→测款→在售 状态机）。 */
export interface Product {
  id: string;
  name: string;
  nameEn: string;
  category: string;
  state: ProductState;
  /** 采购价 CNY。 */
  costCny: number;
  /** 头程+尾程估算 USD/件。 */
  shipUsd: number;
  /** 建议售价 USD。 */
  priceUsd: number;
  /** 竞品均价 USD。 */
  rivalUsd: number;
  /** 月销估算。 */
  monthlySales: number;
  /** 净利率 %（利润测算器输出）。 */
  marginPct: number;
  /** AI 选品评分 0-100。 */
  score: number;
  /** AI 选品理由。 */
  reason: string;
  provenance: Provenance;
  hsCode?: string;
  platforms: string[];
}

/* ══════════════════ E2 上架 Listing ══════════════════ */

export type ListingStatus = "draft" | "pending_review" | "live" | "optimizing" | "paused";

export interface ListingCheck {
  name: string;
  pass: boolean;
  note?: string;
}

export interface Listing {
  id: string;
  productId: string;
  productName: string;
  platform: string;   // Amazon US / Amazon DE / Temu
  lang: string;
  title: string;
  bullets: string[];
  keywords: string;
  status: ListingStatus;
  /** 发布前平台规则体检（禁词/类目/图片）。 */
  checks: ListingCheck[];
  /** 转化率 %（在售后回评）。 */
  cvr?: number;
  ctr?: number;
  /** 最近一次 AI 优化提案摘要。 */
  proposal?: string;
}

/* ══════════════════ E3 定价引擎 ══════════════════ */

/** 四层价格结构（PRD 5.3）。 */
export interface PriceCard {
  sku: string;
  name: string;
  platform: string;
  /** 保本价：成本+费用精算（财务口径，硬底线基准）。 */
  breakEvenUsd: number;
  /** 目标价：净利率目标反推。 */
  targetUsd: number;
  /** 当前动态价。 */
  currentUsd: number;
  /** 竞品价。 */
  rivalUsd: number;
  /** 跟价策略。 */
  strategy: "follow" | "undercut" | "hold";
  /** 当前净利率 %。 */
  marginPct: number;
  /** 最近变价日志。 */
  lastChange?: { at: number; from: number; to: number; reason: string; by: "auto" | "human" };
}

/* ══════════════════ E4 订单中心 ══════════════════ */

export type OrderStatus = "pending" | "risk_hold" | "allocated" | "shipped" | "delivered" | "closed" | "refunding";

export interface Order {
  id: string;
  platform: string;
  sku: string;
  goods: string;
  qty: number;
  amountUsd: number;
  country: string;
  status: OrderStatus;
  /** AI 风控标记。 */
  riskFlag?: string;
  trackingNo?: string;
  channel?: string;
  placedAt: string;
}

/** 售后工单。 */
export interface AfterSale {
  id: string;
  orderId: string;
  type: "refund" | "resend" | "return";
  reason: string;
  amountUsd: number;
  status: "open" | "proposed" | "done" | "rejected";
  /** AI 处理方案。 */
  proposal?: string;
}

/* ══════════════════ E5 物流管理 ══════════════════ */

/** 物流渠道报价卡。 */
export interface ChannelCard {
  id: string;
  name: string;          // 云途专线 / 燕文经济 / 4PX 标快…
  zone: string;          // 美国 / 欧洲 / 全球
  firstWeightCny: number;
  perGramCny: number;    // 续重 CNY/g
  days: string;          // 时效
  battery: boolean;      // 可走带电
  note?: string;
}

export interface ErpShipment {
  id: string;
  orderId: string;
  goods: string;
  to: string;
  channel: string;
  weightG: number;
  costCny: number;
  status: string;        // 已出单 / 运输中 / 派送中 / 妥投 / 停滞
  days: number;          // 已在途天数
  stalled?: boolean;
  /** AI 选路理由。 */
  routeReason?: string;
}

/* ══════════════════ E6 采购与库存 ══════════════════ */

export interface PurchaseOrder {
  id: string;
  supplier: string;
  sku: string;
  goods: string;
  qty: number;
  unitCny: number;
  amountCny: number;
  status: "draft" | "pending_pay" | "paid" | "producing" | "inbound" | "received";
  /** 三单匹配：PO↔GRN↔发票。 */
  grnOk?: boolean;
  invoiceOk?: boolean;
  eta?: string;
}

/** 四态库存（本地/海外仓/FBA/在途）。 */
export interface StockRow {
  sku: string;
  name: string;
  local: number;
  overseas: number;
  fba: number;
  transit: number;
  /** 日均销量。 */
  dailySales: number;
  /** 可售天数（全渠道）。 */
  daysLeft: number;
}

/* ══════════════════ E7 财务中枢 ══════════════════ */

/** 票据类型。 */
export type DocType =
  | "vat-invoice"    // 增值税专票/普票
  | "bank-receipt"   // 银行回单/付汇水单
  | "platform-stmt"  // 平台结算单
  | "logistics-bill" // 物流账单
  | "customs-decl"   // 报关单
  | "receipt";       // 收据/其他

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  "vat-invoice": "增值税发票",
  "bank-receipt": "银行回单",
  "platform-stmt": "平台结算单",
  "logistics-bill": "物流账单",
  "customs-decl": "报关单",
  receipt: "收据",
};

/** OCR 后的票据（多模态 LLM 直出结构化 JSON + 字段置信度）。 */
export interface EvidenceDoc {
  id: string;
  type: DocType;
  /** 对手方（销方/收款方/平台）。 */
  party: string;
  no: string;          // 票号/单号
  date: string;
  amount: number;
  currency: "CNY" | "USD" | "EUR";
  taxAmount?: number;
  /** 整单 OCR 置信度 %。 */
  conf: number;
  /** 低置信字段列表。 */
  lowFields?: string[];
  /** 入账状态。 */
  booked: boolean;
  /** 所属业务包。 */
  bundleId?: string;
  /** 查重/验真结果。 */
  dupCheck: "ok" | "dup" | "suspect";
  /** 入闸时的记账汇率快照（1 单位票面币种 = ? CNY）。策略闸与最终入账用同一快照，
   *  审批等待期间改汇率参数不改变这张票的折算，交易日汇率可追溯。 */
  fxCny?: number;
}

/** 业务包 —— 同一笔业务的多张票据聚成完整证据链（PRD 7.1 多票合并勾稽）。 */
export interface EvidenceBundle {
  id: string;
  title: string;       // 如「PO-2407 采购付款业务包」
  docIds: string[];
  /** 勾稽状态：complete=证据链齐 / partial=缺件 / conflict=金额冲突。 */
  status: "complete" | "partial" | "conflict";
  note?: string;
}

/** 会计凭证（简化 Journal Entry）。 */
export interface JournalEntry {
  id: string;
  date: string;
  summary: string;
  debit: string;       // 借方科目
  credit: string;      // 贷方科目
  amountCny: number;
  docId?: string;
  by: "auto" | "human";
}

/** 三方对账行（平台结算 ↔ 回款服务商 ↔ 银行流水）。 */
export interface ReconRow {
  id: string;
  item: string;
  amount: string;
  side: "平台↔回款商" | "回款商↔银行" | "费用挂账";
  match: string;
  conf: number;
  status: "已匹配" | "待确认" | "未达" | "差异挂账";
}

/** 月度财务快照（三表摘要 + 经营口径）。 */
export interface MonthlyReport {
  month: string;
  gmvUsd: number;
  netProfitCny: number;
  marginPct: number;
  cashCny: number;
  closed: boolean;
}

/* ══════════════════ E8 报税合规 ══════════════════ */

export type FilingStatus = "upcoming" | "preparing" | "ready" | "submitted" | "archived";

/** 一个申报事项（申报日历驱动）。 */
export interface TaxFiling {
  id: string;
  name: string;        // 如「2026-06 增值税申报」「2026-Q2 德国 VAT」
  region: string;      // 国内 / 德国 / 美国
  period: string;
  due: string;         // 截止日
  status: FilingStatus;
  amountDue?: number;
  currency?: string;
  /** 申报前检查报告要点。 */
  checkNotes?: string[];
  /** 资料包配齐清单。 */
  docsReady?: { name: string; ok: boolean }[];
}

/* ══════════════════ E0 驾驶舱 ══════════════════ */

export interface AgentDef {
  key: string;
  name: string;
  emoji: string;
  duty: string;
  boundary: string;
  /** 强制人工的动作说明（若有）。 */
  humanNote?: string;
}

/** 8 个 AI 代理编制（PRD 04）。 */
export const AGENTS: AgentDef[] = [
  { key: "product", name: "选品官", emoji: "", duty: "趋势扫描 · 竞品监控 · 利润测算", boundary: "只产出报告与候选池，不直接建品" },
  { key: "listing", name: "运营官", emoji: "", duty: "Listing 生成/优化 · 多语言 · 关键词", boundary: "新上架自动生成；改在售 Listing 进审批" },
  { key: "pricing", name: "定价官", emoji: "", duty: "竞价追踪 · 动态调价 · 利润守护", boundary: "带宽内自动调价；超幅或触保本线进审批" },
  { key: "logistics", name: "物流官", emoji: "", duty: "渠道比价选路 · 轨迹追踪 · 索赔", boundary: "标准件自动选路；高值/敏感货进审批" },
  { key: "supply", name: "供应链官", emoji: "", duty: "补货建议 · PO 生成 · 三单匹配", boundary: "PO 草案自动生成", humanNote: "付款一律人工" },
  { key: "finance", name: "财务官", emoji: "", duty: "票据 OCR 入账 · 三方对账 · 月度三表", boundary: "高置信自动入账；低置信/大额进审批" },
  { key: "tax", name: "税务官", emoji: "", duty: "增值税/VAT 申报准备 · 退税资料包", boundary: "只做到申报表就绪", humanNote: "提交必须人工确认" },
  { key: "chief", name: "总管代理", emoji: "", duty: "跨代理协调 · 每日经营晨报 · 异常升级", boundary: "无业务写权限，只调度和汇报" },
];

/* ══════════════════ 利润测算（单点真相，E1/E3 共享） ══════════════════ */

export interface ProfitBreakdown {
  revenueUsd: number;
  costUsd: number;
  shipUsd: number;
  platformFeeUsd: number;
  adUsd: number;
  returnLossUsd: number;
  profitUsd: number;
  marginPct: number;
}

/**
 * 单点真相利润函数：E1 选品测算、E3 保本价/目标价推导全部走这里，逐分位一致。
 * breakEven = (成本+运费) / (1 - 平台佣金 - 广告占比 - 退货率)
 */
export function computeProfit(
  priceUsd: number, costCny: number, shipUsd: number, p: ErpParams
): ProfitBreakdown {
  const costUsd = costCny / p.usdCny;
  const platformFeeUsd = priceUsd * (p.platformFeePct / 100);
  const adUsd = priceUsd * (p.adCostPct / 100);
  const returnLossUsd = priceUsd * (p.returnRatePct / 100);
  const profitUsd = priceUsd - costUsd - shipUsd - platformFeeUsd - adUsd - returnLossUsd;
  return {
    revenueUsd: round2(priceUsd),
    costUsd: round2(costUsd),
    shipUsd: round2(shipUsd),
    platformFeeUsd: round2(platformFeeUsd),
    adUsd: round2(adUsd),
    returnLossUsd: round2(returnLossUsd),
    profitUsd: round2(profitUsd),
    marginPct: priceUsd > 0 ? round2((profitUsd / priceUsd) * 100) : 0,
  };
}

/** 保本价（利润=0 的售价）。 */
export function computeBreakEven(costCny: number, shipUsd: number, p: ErpParams): number {
  const varRate = (p.platformFeePct + p.adCostPct + p.returnRatePct) / 100;
  const fixed = costCny / p.usdCny + shipUsd;
  return varRate >= 1 ? Infinity : round2(fixed / (1 - varRate));
}

/** 目标价（达到目标净利率的售价）。 */
export function computeTargetPrice(costCny: number, shipUsd: number, p: ErpParams): number {
  const varRate = (p.platformFeePct + p.adCostPct + p.returnRatePct + p.targetMarginPct) / 100;
  const fixed = costCny / p.usdCny + shipUsd;
  return varRate >= 1 ? Infinity : round2(fixed / (1 - varRate));
}

export function round2(n: number): number {
  // 纯 Math.round(n*100)/100 有 IEEE 浮点误差（1.005→1、10.075→10.07），财务分位不可接受。
  // 修正量取「按量级放大的几个 ulp」但封顶 1e-4：既能把 1.005 这类差一个 ulp 到 .5 的值拉回，
  // 又不会在超大金额（此时 1e-4 远小于该量级的 ulp）上造成错误进位。
  const scaled = n * 100;
  const corr = Math.min(Math.abs(scaled) * Number.EPSILON * 8, 1e-4);
  return Math.round(scaled + Math.sign(scaled) * corr) / 100;
}

/* ══════════════════ 模块清单 + 图标 ══════════════════ */

export const EICONS: Record<string, string> = {
  dash: '<path d="M3 13h8V3H3zM13 21h8V3h-8zM3 21h8v-6H3z"/>',
  product: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  listing: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  pricing: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  orders: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  logistics: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  purchase: '<path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12M6 14h12M6 10h12"/>',
  finance: '<path d="M14 2v6h6"/><path d="M4 2h10l6 6v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M8 13h8M8 17h5"/>',
  tax: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  params: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  review: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  human: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
};

export const ERP_MODULES: ErpModuleDef[] = [
  { id: "e0", group: "总览", no: "E0", name: "经营驾驶舱", sub: "晨报 · KPI · 代理动态 · 无人化率", icon: EICONS.dash },

  { id: "e1", group: "商品线", no: "E1", name: "选品中心", sub: "趋势扫描 · 利润测算 · 候选池", icon: EICONS.product },
  { id: "e2", group: "商品线", no: "E2", name: "上架 Listing", sub: "AI 生成 · 规则体检 · 持续优化", icon: EICONS.listing, star: true },
  { id: "e3", group: "商品线", no: "E3", name: "定价引擎", sub: "四层价格 · 动态调价 · 保本硬底线", icon: EICONS.pricing, star: true },

  { id: "e4", group: "履约线", no: "E4", name: "订单中心", sub: "多平台归集 · 风控 · 售后", icon: EICONS.orders },
  { id: "e5", group: "履约线", no: "E5", name: "物流管理", sub: "智能选路 · 轨迹 · 索赔", icon: EICONS.logistics },
  { id: "e6", group: "履约线", no: "E6", name: "采购库存", sub: "智能补货 · PO · 三单匹配", icon: EICONS.purchase, warn: true },

  { id: "e7", group: "财税线", no: "E7", name: "财务中枢", sub: "票据 OCR · 业务包 · 对账 · 三表", icon: EICONS.finance, star: true },
  { id: "e8", group: "财税线", no: "E8", name: "报税合规", sub: "申报日历 · VAT · 出口退税", icon: EICONS.tax, warn: true },

  { id: "e9", group: "中枢", no: "E9", name: "参数中心", sub: "经营宪法 · 自治边界 · 成本模型", icon: EICONS.params },
];

/** localStorage key。 */
export const ELS = {
  products: "cnxh.erp.products.v1",
  listings: "cnxh.erp.listings.v1",
  prices: "cnxh.erp.prices.v1",
  orders: "cnxh.erp.orders.v1",
  afterSales: "cnxh.erp.afterSales.v1",
  channels: "cnxh.erp.channels.v1",
  shipments: "cnxh.erp.shipments.v1",
  pos: "cnxh.erp.pos.v1",
  stock: "cnxh.erp.stock.v1",
  docs: "cnxh.erp.docs.v1",
  bundles: "cnxh.erp.bundles.v1",
  journal: "cnxh.erp.journal.v1",
  recon: "cnxh.erp.recon.v1",
  reports: "cnxh.erp.reports.v1",
  filings: "cnxh.erp.filings.v1",
  params: "cnxh.erp.params.v1",
  paramLog: "cnxh.erp.paramLog.v1",
  reviews: "cnxh.erp.reviews.v1",
  runs: "cnxh.erp.runs.v1",
  executed: "cnxh.erp.executed.v1",
  seeded: "cnxh.erp.seeded.v1",
} as const;
