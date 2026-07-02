/**
 * 北极星外贸 OS —— 种子/降级数据。
 * 真实业务算例（澳洲进口分销 · 葡萄酒），Agent 不可用/离线时也能演示。
 * 从 public/tools/trade-os.data.js 逐条移植并接入原生类型。
 */
import type {
  SupplierLead, OutreachFunnelStage, CustomsDeclaration, CustomsKpi, CustomsFlowStep,
  Shipment, Supplier, SkuCandidate, StockLot, ReplenishSuggestion, Customer, SalesOrder,
  ReconMatch, ComplianceRow, WorkflowRun, KbEntry, DashKpi, Trend, PipelineNode, BriefingBlock,
} from "./types";
import { ICONS } from "./types";

export function seedLeads(): SupplierLead[] {
  return [
    {
      id: "L-2201", company: "Viña Aurora", country: "智利", region: "Maule Valley", category: "有机 Carmenère / Cabernet 红酒",
      website: "vinaaurora.cl", email: "export@vinaaurora.cl", contact: "Sofía Reyes", source: "sourcing",
      grade: "A", score: 86, status: "replied",
      profile: { 主营品类: "有机 Carmenère / Cabernet 红酒", 认证: "有机 + HACCP（官网可查）", 出口经验: "未见澳洲记录 · 有欧盟出口", MOQ量级: "约 1×20ft 起（估）", 产区匹配度: "高（智利红酒缺口）" },
      confs: { 认证: 92, 出口经验: 74, MOQ量级: 61 },
      replyClass: "sample",
      thread: [
        { dir: "out", who: "我方 · Orca Imports", at: "06-24 09:12", text: "Dear Sofía,\n\nWe are Orca Imports, a Sydney-based importer & distributor focused on premium organic wines for the Australian market...\n\nWe were impressed by Viña Aurora's certified-organic Carmenère from Maule Valley. We'd love to explore bringing your range into AU.\n\nCould you share your export price list (FOB San Antonio) and MOQ? We're also happy to arrange samples.\n\nBest regards,\nLiam Chen · Procurement, Orca Imports" },
        { dir: "in", who: "Viña Aurora · Sofía", at: "06-26 21:40", text: "Hi Liam, thank you for reaching out! We'd be glad to work with the Australian market. I can send samples of our 2021 organic Carmenère and Cabernet. Our FOB starts around USD 4.20/btl at 1x20' container. Let me prepare a full price list. — Sofía" },
      ],
    },
    {
      id: "L-2202", company: "Kanonkop Estate", country: "南非", region: "Stellenbosch", category: "Pinotage / 红blend",
      website: "kanonkop.co.za", email: "info@kanonkop.co.za", contact: "Johann Krige", source: "manual",
      grade: "A", score: 83, status: "contacted",
      profile: { 主营品类: "Pinotage / 波尔多式红 blend", 认证: "WIETA + IPW（可持续葡酒）", 出口经验: "有 · 已出口英美", MOQ量级: "1×20ft", 产区匹配度: "中高" },
      confs: { 认证: 88, 出口经验: 90, MOQ量级: 70 },
      replyClass: null,
      thread: [{ dir: "out", who: "我方 · Orca Imports", at: "06-27 10:05", text: "Dear Johann, ... (个性化破冰信已发出，等待回复)" }],
    },
    {
      id: "L-2203", company: "Bodega Norton", country: "阿根廷", region: "Mendoza", category: "Malbec",
      website: "norton.com.ar", email: "trade@norton.com.ar", contact: "María Paz", source: "sourcing",
      grade: "B", score: 71, status: "new",
      profile: { 主营品类: "Malbec / Cabernet", 认证: "ISO 9001", 出口经验: "有 · 大量出口", MOQ量级: "较高（品牌方）", 产区匹配度: "中（Malbec 已有货源）" },
      confs: { 认证: 80, 出口经验: 85, MOQ量级: 55 },
      replyClass: null, thread: [],
    },
    {
      id: "L-2204", company: "Errázuriz", country: "智利", region: "Aconcagua", category: "高端红酒",
      website: "errazuriz.com", email: "export@errazuriz.com", contact: "Diego Silva", source: "import",
      grade: "B", score: 68, status: "new",
      profile: { 主营品类: "高端 Cabernet / Syrah", 认证: "有机 + B-Corp", 出口经验: "全球出口", MOQ量级: "高", 产区匹配度: "中" },
      confs: { 认证: 90, 出口经验: 88, MOQ量级: 50 }, replyClass: null, thread: [],
    },
    {
      id: "L-2205", company: "Casa Marín", country: "智利", region: "San Antonio", category: "凉产区白/黑皮诺",
      website: "casamarin.cl", email: "hola@casamarin.cl", contact: "María Luz Marín", source: "sourcing",
      grade: "C", score: 54, status: "invalid",
      profile: { 主营品类: "Sauvignon Blanc / Pinot Noir", 认证: "未见公开认证", 出口经验: "小批量", MOQ量级: "低", 产区匹配度: "低（白酒非当前重点）" },
      confs: { 认证: 40, 出口经验: 48, MOQ量级: 60 }, replyClass: "irrelevant", thread: [],
    },
    {
      id: "L-2206", company: "De Bortoli SA", country: "南非", region: "Western Cape", category: "散装 blend",
      website: "-", email: "sales@debortoli-sa.example", contact: "—", source: "import",
      grade: "C", score: 42, status: "unsub",
      profile: { 主营品类: "散装 blend", 认证: "无", 出口经验: "不明", MOQ量级: "散货", 产区匹配度: "低" },
      confs: { 认证: 20, 出口经验: 30, MOQ量级: 40 }, replyClass: "irrelevant", thread: [],
    },
  ];
}

export function seedOutreachFunnel(): OutreachFunnelStage[] {
  return [
    { stage: "线索 Leads", n: 124, conv: "", color: "var(--gold)" },
    { stage: "已发建联", n: 68, conv: "55%", color: "#c8a94e" },
    { stage: "有回复", n: 19, conv: "28% 回复", color: "var(--primary)" },
    { stage: "进入比价", n: 7, conv: "37% 转化", color: "#3aa6a0" },
    { stage: "转为合作", n: 2, conv: "29% 成单", color: "var(--ok)" },
  ];
}

export function seedDeclarations(): CustomsDeclaration[] {
  return [
    {
      id: "0617", po: "PO-2405-11", supplier: "Barossa Vale Wines", goods: "Shiraz Red Wine 2021", type: "import",
      terms: "FOB", currency: "AUD", fob: 66600, freight: 6900, insurance: 804, cif: 74304,
      origin: "澳大利亚", dispatch: "澳大利亚", destPort: "Sydney", bl: "MAEU-6617204", container: "MSKU-7789013",
      packages: 300, grossWt: 5400, netWt: 5100, agreement: "ChAFTA", coCertNo: "",
      duty: 0, wet: 21548.16, gst: 9585.22, status: "reviewing", fillRate: 92, hsComplete: 90, checkStatus: "soft",
      lines: [{ sku: "SKU-SHRZ-21", desc: "Shiraz Red Wine 2021", hs: "2204.21.00", hsConf: 94, uom: "升/瓶(750ml)", uomConf: 98, qty: 3600, unit: 18.5, amount: 66600, origin: "AU", dutyRate: "0%(ChAFTA)", dutyConf: 79 }],
      checks: [
        { field: "品名", severity: "pass", decl: "Shiraz Red Wine 2021", inv: "Shiraz Red Wine 2021", pack: "Shiraz Red Wine 2021", bl: "Wine (Shiraz) 2021" },
        { field: "数量", severity: "pass", decl: "3,600 btl", inv: "3,600", pack: "3,600", bl: "3,600 btl" },
        { field: "总金额", severity: "pass", decl: "AUD 66,600", inv: "AUD 66,600", pack: "—", bl: "—" },
        { field: "毛重", severity: "soft", decl: "5,400 kg", inv: "—", pack: "5,400 kg", bl: "5,380 kg", note: "提单毛重 5,380kg，差 20kg（软差异，需人工确认一次）" },
        { field: "件数", severity: "pass", decl: "300 ctn", inv: "300", pack: "300", bl: "300" },
      ],
    },
    {
      id: "0621", po: "PO-2405-14", supplier: "Margaret River Estate", goods: "Cabernet Sauvignon 2022", type: "import",
      terms: "CIF", currency: "AUD", fob: 58200, freight: 0, insurance: 0, cif: 58200,
      origin: "澳大利亚", dispatch: "澳大利亚", destPort: "Melbourne", bl: "OOLU-2210088", container: "OOCU-4432101",
      packages: 260, grossWt: 4680, netWt: 4420, agreement: "ChAFTA", coCertNo: "CO-AU-88213",
      duty: 0, wet: 16878, gst: 7507.8, status: "draft", fillRate: 88, hsComplete: 100, checkStatus: "pass",
      lines: [{ sku: "SKU-CAB-22", desc: "Cabernet Sauvignon 2022", hs: "2204.21.00", hsConf: 96, uom: "升/瓶(750ml)", uomConf: 99, qty: 3120, unit: 18.65, amount: 58200, origin: "AU", dutyRate: "0%(ChAFTA)", dutyConf: 95 }],
      checks: [
        { field: "品名", severity: "pass", decl: "Cabernet Sauvignon 2022", inv: "Cabernet Sauvignon 2022", pack: "Cab Sauv 2022", bl: "Wine 2022" },
        { field: "数量", severity: "pass", decl: "3,120 btl", inv: "3,120", pack: "3,120", bl: "3,120" },
        { field: "总金额", severity: "pass", decl: "AUD 58,200", inv: "AUD 58,200", pack: "—", bl: "—" },
      ],
    },
    {
      id: "0625", po: "PO-2405-16", supplier: "Coonawarra Cellars", goods: "Chardonnay 2023", type: "import",
      terms: "FOB", currency: "AUD", fob: 41000, freight: 5200, insurance: 520, cif: 46720,
      origin: "澳大利亚", dispatch: "澳大利亚", destPort: "Sydney", bl: "CMAU-9921764", container: "TCLU-1120934",
      packages: 200, grossWt: 3600, netWt: 3400, agreement: "ChAFTA", coCertNo: "",
      duty: 0, wet: 13548.8, gst: 6026.88, status: "draft", fillRate: 84, hsComplete: 60, checkStatus: "hard",
      lines: [{ sku: "SKU-CHRD-23", desc: "Chardonnay 2023", hs: "", hsConf: 0, uom: "升/瓶(750ml)", uomConf: 90, qty: 2400, unit: 17.08, amount: 41000, origin: "AU", dutyRate: "待归类", dutyConf: 0 }],
      checks: [
        { field: "品名", severity: "pass", decl: "Chardonnay 2023", inv: "Chardonnay 2023", pack: "Chardonnay 2023", bl: "White Wine 2023" },
        { field: "总金额", severity: "hard", decl: "AUD 41,000", inv: "AUD 40,100", pack: "—", bl: "—", note: "发票金额 40,100 与报关 41,000 不一致（硬差异，拦截导出）" },
        { field: "数量", severity: "pass", decl: "2,400 btl", inv: "2,400", pack: "2,400", bl: "2,400" },
      ],
    },
  ];
}

export function seedCustomsKpi(): CustomsKpi {
  return { pending: 3, reviewing: 1, released: 12, inspected: 1 };
}

export function seedCustomsFlow(): CustomsFlowStep[] {
  return [
    { n: 1, title: "触发", desc: "ETA-5d 自动", state: "done" },
    { n: 2, title: "聚合拼装", desc: "PO/物流/LCV", state: "done" },
    { n: 3, title: "LLM 归类+税费", desc: "HS+WET/GST", state: "done" },
    { n: 4, title: "三单校验", desc: "1 软差异", state: "done" },
    { n: 5, title: "人工确认", desc: "★人工闸1", state: "active", gate: true },
    { n: 6, title: "导出交报关行", desc: "PDF+EDI", state: "todo" },
    { n: 7, title: "回执回写", desc: "★人工闸2", state: "todo", gate: true },
  ];
}

export function seedShipments(): Shipment[] {
  return [
    { id: "0617", bl: "MAEU-6617204", goods: "Shiraz 2021", from: "Melbourne", to: "Sydney", etaP50: "07-06", etaP90: "07-09", status: "到港清关", demurrage: "低", pct: 82,
      milestones: [{ t: "已订舱", at: "06-08", done: true }, { t: "开船 ATD", at: "06-14", done: true }, { t: "海运在途", at: "06-14~", done: true }, { t: "到港", at: "07-01", now: true }, { t: "清关放行", at: "—", done: false }, { t: "派送入仓", at: "—", done: false }] },
    { id: "0621", bl: "OOLU-2210088", goods: "Cabernet 2022", from: "Fremantle", to: "Melbourne", etaP50: "07-12", etaP90: "07-16", status: "海运在途", demurrage: "低", pct: 55,
      milestones: [{ t: "已订舱", at: "06-15", done: true }, { t: "开船 ATD", at: "06-20", done: true }, { t: "海运在途", at: "06-20~", now: true }, { t: "到港", at: "—", done: false }] },
    { id: "0625", bl: "CMAU-9921764", goods: "Chardonnay 2023", from: "Adelaide", to: "Sydney", etaP50: "07-18", etaP90: "07-23", status: "海运在途", demurrage: "中", pct: 40,
      milestones: [{ t: "已订舱", at: "06-19", done: true }, { t: "开船 ATD", at: "06-25", done: true }, { t: "海运在途", at: "06-25~", now: true }] },
    { id: "0630", bl: "HLCU-5540021", goods: "Sparkling 2022", from: "Sydney", to: "Brisbane", etaP50: "07-25", etaP90: "07-29", status: "已订舱", demurrage: "低", pct: 15,
      milestones: [{ t: "已订舱", at: "06-28", now: true }] },
  ];
}

export function seedSuppliers(): Supplier[] {
  return [
    { name: "Barossa Vale Wines", country: "澳大利亚", cat: "Shiraz", onTime: 96, price: 88, quality: 94, composite: 92.6, grade: "A", tag: "核心" },
    { name: "Margaret River Estate", country: "澳大利亚", cat: "Cabernet", onTime: 92, price: 84, quality: 91, composite: 89, grade: "A", tag: "核心" },
    { name: "Coonawarra Cellars", country: "澳大利亚", cat: "Chardonnay", onTime: 85, price: 90, quality: 86, composite: 87, grade: "B", tag: "" },
    { name: "Viña Aurora", country: "智利", cat: "有机 Carmenère", onTime: 0, price: 0, quality: 0, composite: 0, grade: "—", tag: "新建联" },
  ];
}

export function seedSkus(): SkuCandidate[] {
  return [
    { id: "sku-seed-carmenere21", name: "有机 Carmenère 2021", region: "智利 Maule", priceBand: "$4.2–5.0 FOB", certs: "有机+HACCP", conf: 88, provenance: "ai", state: "candidate" },
    { id: "sku-seed-pinotage", name: "Pinotage 红 blend", region: "南非 Stellenbosch", priceBand: "$5.5–6.8 FOB", certs: "WIETA+IPW", conf: 82, provenance: "ai", state: "candidate" },
    { id: "sku-seed-malbec22", name: "Malbec 2022", region: "阿根廷 Mendoza", priceBand: "$3.8–4.6 FOB", certs: "ISO9001", conf: 79, provenance: "ai", state: "candidate" },
    { id: "sku-seed-pinotnoir", name: "凉产区 Pinot Noir", region: "智利 San Antonio", priceBand: "$6.0–7.5 FOB", certs: "—", conf: 55, provenance: "inferred", state: "candidate" },
  ];
}

export function seedStock(): StockLot[] {
  return [
    { sku: "SKU-SHRZ-21", name: "Shiraz 2021", batch: "B2405-A", qty: 3120, expiry: "2027-06", fefo: 1, landed: 24.6 },
    { sku: "SKU-CAB-22", name: "Cabernet 2022", batch: "B2404-C", qty: 2860, expiry: "2028-03", fefo: 2, landed: 25.1 },
    { sku: "SKU-CHRD-23", name: "Chardonnay 2023", batch: "B2403-B", qty: 640, expiry: "2025-11", fefo: 0, landed: 22.9 },
    { sku: "SKU-SPRK-22", name: "Sparkling 2022", batch: "B2402-A", qty: 1180, expiry: "2026-08", fefo: 3, landed: 27.3 },
  ];
}

export function seedReplenish(): ReplenishSuggestion[] {
  return [
    { sku: "SKU-SHRZ-21", name: "Shiraz 2021", qty: 3600, by: "07-20 前下单", reason: "近 30 天日均销 118 瓶，在途 1 柜，交期 45 天，安全库存告警" },
    { sku: "SKU-CHRD-23", name: "Chardonnay 2023", qty: 2400, by: "本周", reason: "效期 2025-11 临期风险 + 现货仅 640，需以销定采" },
  ];
}

export function seedCustomers(): Customer[] {
  return [
    { name: "Dan Murphy's（连锁）", tier: "A", terms: "Net 30", ytd: 486000, open: 62000, status: "活跃" },
    { name: "Vintage Cellars", tier: "A", terms: "Net 30", ytd: 312000, open: 28400, status: "活跃" },
    { name: "First Choice Liquor", tier: "B", terms: "Net 14", ytd: 198000, open: 15200, status: "活跃" },
    { name: "本地餐饮集团 Merivale", tier: "B", terms: "Net 45", ytd: 142000, open: 33800, status: "对账中" },
  ];
}

export function seedSalesOrders(): SalesOrder[] {
  return [
    { id: "SO-3312", customer: "Dan Murphy's", lines: "Shiraz 2021 ×1200", incl: 39600, status: "已发货" },
    { id: "SO-3315", customer: "Vintage Cellars", lines: "Cabernet 2022 ×720", incl: 26100, status: "备货" },
    { id: "SO-3318", customer: "First Choice", lines: "Chardonnay 2023 ×480", incl: 14880, status: "待发货" },
  ];
}

export function seedRecon(): ReconMatch[] {
  return [
    { item: "货代账单 INV-FRT-0617", amount: "AUD 6,900", match: "落地成本凭证 LCV-0617", conf: 96, status: "待确认" },
    { item: "供应商 PI Barossa #2405", amount: "AUD 66,600", match: "PO-2405-11", conf: 99, status: "已匹配" },
    { item: "银行入账 06-28", amount: "AUD 39,600", match: "SO-3312 回款", conf: 91, status: "待确认" },
    { item: "报关行费 BRK-0621", amount: "AUD 420", match: "（无候选）", conf: 0, status: "未达" },
  ];
}

export function seedCompliance(): ComplianceRow[] {
  return [
    { container: "0617", wet: "已算 $21,548.16", gst: "已算 $9,585.22", tga: "N/A", fsanz: "标签合规 ✓", biosecurity: "待申报", release: "待放行", ok: false },
    { container: "0621", wet: "已算 $16,878.00", gst: "已算 $7,507.80", tga: "N/A", fsanz: "标签合规 ✓", biosecurity: "已通过", release: "可放行", ok: true },
    { container: "0625", wet: "待算", gst: "待算", tga: "N/A", fsanz: "缺英文背标", biosecurity: "待申报", release: "缺证拦发货", ok: false },
  ];
}

export function seedWorkflows(): WorkflowRun[] {
  return [
    { name: "报关草稿 · ETA-5d 触发", step: "人工确认（★闸1）", state: "挂起", updated: "07-01 08:12", pct: 71 },
    { name: "建联发信 · 发后挂起等回信", step: "等待回信（Kanonkop）", state: "运行", updated: "06-27 10:05", pct: 60 },
    { name: "临期预警 → 晨报", step: "已推送晨报", state: "完成", updated: "07-01 07:00", pct: 100 },
    { name: "到港 → 开 GRN 自动流转", step: "货柜 0617 到港", state: "运行", updated: "07-01 06:30", pct: 45 },
  ];
}

export function seedKb(): KbEntry[] {
  return [
    { title: "澳洲 WET 葡萄酒均衡税 · 计税口径", tag: "税则", links: 8 },
    { title: "HS 2204.21 葡萄酒（≤2L）归类规则", tag: "HS 归类", links: 12 },
    { title: "ChAFTA 中澳自贸 · 原产地规则与协定税率", tag: "贸易协定", links: 6 },
    { title: "智利 / 南非 / 阿根廷 酒庄产区名录", tag: "产区名录", links: 21 },
    { title: "破冰开发信话术库（英/西/中）", tag: "话术", links: 9 },
    { title: "FSANZ 进口酒标签合规要件", tag: "合规要件", links: 14 },
  ];
}

export function seedDashKpi(): DashKpi[] {
  return [
    { v: "312", l: "在库 SKU", d: "本月 +18", up: true, acc: "gold", ico: ICONS.warehouse },
    { v: "4", l: "在途货柜", d: "0617 到港清关中", acc: "blue", ico: ICONS.logistics },
    { v: "3", l: "待报关", d: "1 柜有硬差异", up: false, acc: "amber", ico: ICONS.customs },
    { v: "2", l: "临期批次", d: "Chardonnay 2025-11", up: false, acc: "red", ico: ICONS.warehouse },
    { v: "$1.14M", l: "本月分销额", d: "环比 +12%", up: true, acc: "green", ico: ICONS.customer },
    { v: "$0.14M", l: "未达账项", d: "4 笔待匹配", acc: "purple", ico: ICONS.finance },
  ];
}

export function seedTrends(): Trend[] {
  return [
    { l: "销售额（近 12 周，$K）", v: "$1.14M", delta: "+12%", up: true, series: [72, 78, 74, 85, 90, 88, 96, 102, 98, 110, 118, 114] },
    { l: "毛利率（%）", v: "31.4%", delta: "+1.8pt", up: true, series: [28, 29, 28.5, 30, 29.4, 30.6, 31, 30.8, 31.2, 31.6, 31.1, 31.4] },
    { l: "现金转换周期 CCC（天）", v: "58", delta: "-6 天", up: true, series: [72, 71, 69, 70, 66, 65, 63, 64, 61, 60, 59, 58] },
  ];
}

export function seedPipeline(): PipelineNode[] {
  return [
    { c: "18", l: "选品候选" }, { c: "6", l: "建联中" }, { c: "4", l: "采购单" },
    { c: "4", l: "在途货柜" }, { c: "3", l: "待报关" }, { c: "312", l: "在库 SKU" },
    { c: "9", l: "分销订单" }, { c: "4", l: "待对账" },
  ];
}

export function seedBriefing(): BriefingBlock[] {
  return [
    { k: "昨日完成", items: ["货柜 0617 完成三单校验（1 软差异待确认）", "Viña Aurora 回信索样，已归类为『索样』意向", "SO-3312 已发货 1,200 瓶给 Dan Murphy's"] },
    { k: "今日待办", items: ["★ 确认 0617 报关草稿并导出交报关行（人工闸1）", "★ 处理 0625 报关：发票金额硬差异 + 缺 HS 归类", "回复 Kanonkop 建联跟进 / 安排 Viña Aurora 样品"] },
    { k: "风险预警", items: ["0625 缺英文背标 → 合规中心拦发货", "Chardonnay 2023 批次 2025-11 临期，现货仅 640", "报关行费 BRK-0621 $420 未达账，需人工匹配"] },
  ];
}
