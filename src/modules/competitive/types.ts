/**
 * 竞品分析 Agent —— A/B 两种模式的数据形状。
 *
 * 字段名严格对齐参考 HTML 的 renderA / renderB（ch1..ch4 / t1_share..t5_crisis），
 * 这样渲染函数与原版 1:1。模型回填的富文本字段（lead / signal / why / …）允许带
 * 受限 HTML 片段（<b>/<span class='hl'>/<em>/<p>），v-html 前一律过 sanitizeHtml。
 */

/** 数据点可信度标签：ok=财报/权威原值，est=剥离/行业推算，total=合计行，待补充=查不到。 */
export type ConfTag = "ok" | "est" | "total" | "待补充";

/* ============================ Mode A：增长标杆拆解 ============================ */

export interface AKpi {
  v: string;
  /** 数字色：red / blue / amber / green */
  cls?: string;
  k: string;
  d?: string;
  tag?: ConfTag;
}

export interface ARow {
  item: string;
  amt?: string;
  pct?: string;
  src?: string;
  /** ok / est / total */
  tag?: ConfTag;
}

export interface ACh1 {
  lead?: string;
  kpis?: AKpi[];
  rows?: ARow[];
  signal?: string;
}

export interface ATheory {
  title?: string;
  body?: string;
}

export interface AProduct {
  ico?: string;
  name: string;
  pain?: string;
  badge?: string;
  /** 徽标色：r / b / g */
  bcls?: string;
}

export interface AStep {
  en?: string;
  title?: string;
  desc?: string;
  tags?: string[];
}

export interface ACh2 {
  lead?: string;
  theory?: ATheory;
  products?: AProduct[];
  steps?: AStep[];
}

export interface ASellpoint {
  rank: string;
  layer?: string;
  headline?: string;
  job?: string;
  why?: string;
  voc?: string;
}

export interface APathStage {
  stage?: string;
  q?: string;
  a?: string;
}

export interface ACh3 {
  lead?: string;
  def?: string;
  sellpoints?: ASellpoint[];
  path?: APathStage[];
}

export interface AFunnel {
  stg?: string;
  en?: string;
  pct?: string;
  bud?: string;
}

export interface ADetail {
  lbl?: string;
  text?: string;
}

export interface AChannel {
  name: string;
  pct: number;
}

export interface AWeak {
  title?: string;
  text?: string;
}

export interface ACh4 {
  lead?: string;
  funnel?: AFunnel[];
  detail?: ADetail[];
  channels?: AChannel[];
  weak?: AWeak;
}

export interface ModeAData {
  title?: string;
  ch1?: ACh1;
  ch2?: ACh2;
  ch3?: ACh3;
  ch4?: ACh4;
  foot?: string;
}

/* ============================ Mode B：危机诊断拆解 ============================ */

export interface BStat {
  label: string;
  value: string;
  /** g / r / a */
  cls?: string;
}

export interface BLineChart {
  labels: string[];
  data: number[];
  /** 每个点的颜色（拐点高亮）。 */
  markers?: string[];
}

export interface BT1Share {
  title?: string;
  subtitle?: string;
  source?: string;
  chart?: BLineChart;
  stats?: BStat[];
}

export interface BSeries {
  name: string;
  color?: string;
  data: number[];
}

export interface BMultiChart {
  labels: string[];
  series: BSeries[];
}

export interface BInfoCard {
  title: string;
  /** g / r */
  cls?: string;
  items?: string[];
}

export interface BT2Premium {
  title?: string;
  subtitle?: string;
  source?: string;
  chart?: BMultiChart;
  cards?: BInfoCard[];
}

export interface BVsPoint {
  ico?: string;
  title: string;
  sub?: string;
}

export interface BVerdict {
  /** ok / warn */
  type?: string;
  text?: string;
}

export interface BVsCard {
  name: string;
  /** 名称色：b / g */
  ncls?: string;
  tagline?: string;
  points?: BVsPoint[];
  verdict?: BVerdict;
}

export interface BPosCard {
  name: string;
  ncls?: string;
  since?: string;
  items?: string[];
  slogan?: string;
  sub?: string;
  /** ok / warn */
  vtype?: string;
}

export interface BT3Scene {
  lead?: string;
  a?: BVsCard;
  b?: BVsCard;
  poslead?: string;
  posA?: BPosCard;
  posB?: BPosCard;
}

export interface BDuelRow {
  label: string;
  text: string;
}

export interface BDuelSide {
  name: string;
  rows?: BDuelRow[];
}

export interface BEssence {
  title?: string;
  rows?: string[];
}

export interface BT4Duel {
  lead?: string;
  sideA?: BDuelSide;
  sideB?: BDuelSide;
  essence?: BEssence;
}

export interface BCrisisEvent {
  score: number;
  name: string;
  date: string;
  type: string;
  /** 烈度色：g(1-4) / y(5-7) / r(8-10) */
  cls: string;
}

export interface BT5Crisis {
  lead?: string;
  events?: BCrisisEvent[];
  conclusion?: string;
}

export interface ModeBData {
  title?: string;
  subtitle?: string;
  t1_share?: BT1Share;
  t2_premium?: BT2Premium;
  t3_scene?: BT3Scene;
  t4_duel?: BT4Duel;
  t5_crisis?: BT5Crisis;
  foot?: string;
}

/* ============================ 流水线 / 持久化 ============================ */

export type Mode = "A" | "B";

/** 流水线节点实时状态。 */
export type NodeState = "" | "active" | "done";

export interface PipelineNode {
  ico: string;
  nm: string;
  meta: string;
  state: NodeState;
}

/** 真实多阶段流水线的阶段标识。 */
export type Stage = "idle" | "research" | "reason" | "finalize" | "done" | "error";

/** 流式日志行（onDelta 文本 / onTool 工具轨迹）。 */
export interface LogLine {
  kind: "stage" | "tool" | "text";
  text: string;
  at: number;
}

/** localStorage 持久化的「上次运行」。 */
export interface PersistedRun {
  mode: Mode;
  /** 兼容旧记录：当前模式的单一输入（迁移用）。 */
  company: string;
  product: string;
  /** 分模式输入：A/B 各存一份，避免切换模式后 reload 输入串台。 */
  companyA?: string;
  productA?: string;
  companyB?: string;
  productB?: string;
  dataA?: ModeAData;
  dataB?: ModeBData;
  at: number;
}
