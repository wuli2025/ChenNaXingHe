/**
 * 星河无头ERP —— 种子数据。
 *
 * 业务算例：跨境电商一人公司『星河出海』
 *  - 品类：宠物用品 + 家居收纳；平台：Amazon US / Amazon DE / Temu
 *  - 采购：1688 + 工厂直采（佛山/义乌）；物流：云途 / 燕文 / 4PX + 海运头程入 FBA
 *  - 财税：国内小规模→一般纳税人，德国 VAT 注册，出口退（免）税
 * 种子只在首次载入生效（ELS.seeded），之后一切以用户/AI 产生的真实数据为准。
 */
import type {
  Product, Listing, PriceCard, Order, AfterSale, ChannelCard, ErpShipment,
  PurchaseOrder, StockRow, EvidenceDoc, EvidenceBundle, JournalEntry, ReconRow,
  MonthlyReport, TaxFiling,
} from "./types";

/* ══════════ E1 商品 ══════════ */
export function seedProducts(): Product[] {
  return [
    {
      id: "P-001", name: "宠物自动饮水机 2.5L", nameEn: "Automatic Pet Water Fountain 2.5L",
      category: "宠物用品", state: "active", costCny: 38.5, shipUsd: 4.2, priceUsd: 25.99,
      rivalUsd: 27.99, monthlySales: 620, marginPct: 24.8, score: 88,
      reason: "美区月搜索 9.2 万、竞品差评集中在水泵噪音（可用静音泵差异化）；带电但已有认证货源。",
      provenance: "user", hsCode: "8509.80.50", platforms: ["Amazon US", "Amazon DE"],
    },
    {
      id: "P-002", name: "猫咪外出胸背带套装", nameEn: "Escape-Proof Cat Harness & Leash Set",
      category: "宠物用品", state: "active", costCny: 16.8, shipUsd: 2.1, priceUsd: 15.99,
      rivalUsd: 16.95, monthlySales: 940, marginPct: 27.5, score: 84,
      reason: "轻小件、免认证、退货率低；德区同款均价高 22%，双站布局。",
      provenance: "user", hsCode: "4201.00.60", platforms: ["Amazon US", "Amazon DE", "Temu"],
    },
    {
      id: "P-003", name: "可折叠收纳凳 60L", nameEn: "Foldable Storage Ottoman 60L",
      category: "家居收纳", state: "testing", costCny: 42.0, shipUsd: 6.8, priceUsd: 32.99,
      rivalUsd: 34.5, monthlySales: 180, marginPct: 19.2, score: 76,
      reason: "测款中：体积重吃利润，需海运 FBA 摊薄；转化率待验证。",
      provenance: "ai", hsCode: "9401.80.40", platforms: ["Amazon US"],
    },
    {
      id: "P-004", name: "宠物梳毛除毛手套", nameEn: "Pet Grooming Deshedding Gloves",
      category: "宠物用品", state: "candidate", costCny: 6.2, shipUsd: 1.6, priceUsd: 9.99,
      rivalUsd: 11.99, monthlySales: 0, marginPct: 31.0, score: 81,
      reason: "候选：客单低但净利率 31%，Temu 起量快；建议与 P-002 组捆绑销售。",
      provenance: "ai", platforms: ["Temu"],
    },
    {
      id: "P-005", name: "桌面磁吸数据线收纳器", nameEn: "Magnetic Cable Organizer",
      category: "家居收纳", state: "dropped", costCny: 8.9, shipUsd: 1.4, priceUsd: 7.99,
      rivalUsd: 6.99, monthlySales: 0, marginPct: 8.2, score: 42,
      reason: "已放弃：价格战红海，净利率低于 12% 红线。",
      provenance: "ai", platforms: [],
    },
  ];
}

/* ══════════ E2 Listing ══════════ */
export function seedListings(): Listing[] {
  return [
    {
      id: "L-101", productId: "P-001", productName: "宠物自动饮水机 2.5L", platform: "Amazon US", lang: "en-US",
      title: "Pet Water Fountain 2.5L, Ultra-Quiet Cat Water Dispenser with LED & Triple Filter",
      bullets: ["84oz/2.5L capacity for cats & small dogs", "Ultra-quiet pump <30dB", "Triple filtration system", "LED water level indicator", "BPA-free food-grade material"],
      keywords: "cat water fountain, pet fountain quiet, automatic water dispenser",
      status: "live", cvr: 12.6, ctr: 0.42,
      checks: [
        { name: "禁词扫描", pass: true }, { name: "类目属性完整", pass: true },
        { name: "图片合规（白底/尺寸）", pass: true }, { name: "五点字数", pass: true },
      ],
    },
    {
      id: "L-102", productId: "P-001", productName: "宠物自动饮水机 2.5L", platform: "Amazon DE", lang: "de-DE",
      title: "Katzen Trinkbrunnen 2,5L, Ultra Leise Wasserspender mit LED & Dreifachfilter",
      bullets: ["2,5L Kapazität für Katzen und kleine Hunde", "Ultra-leise Pumpe <30dB", "Dreifach-Filtersystem", "LED-Wasserstandsanzeige", "BPA-freies Material"],
      keywords: "katzenbrunnen, trinkbrunnen katze leise",
      status: "optimizing", cvr: 8.1, ctr: 0.31,
      proposal: "德区转化率 8.1% 低于均值：建议主图换生活场景图 + 标题前置「leise（静音）」卖点，A/B 7 天回评。",
      checks: [
        { name: "禁词扫描", pass: true }, { name: "类目属性完整", pass: true },
        { name: "图片合规（白底/尺寸）", pass: false, note: "主图分辨率 <1600px" }, { name: "五点字数", pass: true },
      ],
    },
    {
      id: "L-103", productId: "P-002", productName: "猫咪外出胸背带套装", platform: "Temu", lang: "en-US",
      title: "Escape Proof Cat Harness and Leash Set, Adjustable Soft Mesh Vest",
      bullets: ["Escape-proof double-lock buckle", "Breathable air mesh", "Reflective strips for night walks", "Size S/M/L", "Machine washable"],
      keywords: "cat harness escape proof, kitten vest leash",
      status: "pending_review",
      checks: [
        { name: "禁词扫描", pass: true }, { name: "类目属性完整", pass: true },
        { name: "图片合规（白底/尺寸）", pass: true }, { name: "五点字数", pass: true },
      ],
    },
    {
      id: "L-104", productId: "P-003", productName: "可折叠收纳凳 60L", platform: "Amazon US", lang: "en-US",
      title: "Folding Storage Ottoman 60L, Sturdy Footrest Bench Holds 300lbs",
      bullets: ["60L large capacity", "Holds up to 300 lbs", "Linen fabric surface", "Folds flat in seconds", "Doubles as footrest & seat"],
      keywords: "storage ottoman, folding bench, footrest storage",
      status: "draft",
      checks: [
        { name: "禁词扫描", pass: true }, { name: "类目属性完整", pass: false, note: "缺 furniture 合规属性 2 项" },
        { name: "图片合规（白底/尺寸）", pass: true }, { name: "五点字数", pass: true },
      ],
    },
  ];
}

/* ══════════ E3 价格卡 ══════════ */
export function seedPrices(): PriceCard[] {
  return [
    {
      sku: "P-001", name: "宠物自动饮水机 2.5L", platform: "Amazon US",
      breakEvenUsd: 18.42, targetUsd: 26.9, currentUsd: 25.99, rivalUsd: 27.99,
      strategy: "undercut", marginPct: 24.8,
      lastChange: { at: Date.now() - 86400000 * 2, from: 26.99, to: 25.99, reason: "竞品 BestPet 降价 7%，带宽内自动跟随压价", by: "auto" },
    },
    {
      sku: "P-002", name: "猫咪外出胸背带套装", platform: "Amazon US",
      breakEvenUsd: 10.86, targetUsd: 16.2, currentUsd: 15.99, rivalUsd: 16.95,
      strategy: "follow", marginPct: 27.5,
    },
    {
      sku: "P-002", name: "猫咪外出胸背带套装", platform: "Amazon DE",
      breakEvenUsd: 11.4, targetUsd: 17.8, currentUsd: 18.49, rivalUsd: 19.95,
      strategy: "hold", marginPct: 31.2,
    },
    {
      sku: "P-003", name: "可折叠收纳凳 60L", platform: "Amazon US",
      breakEvenUsd: 27.1, targetUsd: 38.4, currentUsd: 32.99, rivalUsd: 34.5,
      strategy: "undercut", marginPct: 19.2,
      lastChange: { at: Date.now() - 86400000 * 5, from: 34.99, to: 32.99, reason: "测款期引流定价（低于目标价，人工核准）", by: "human" },
    },
  ];
}

/* ══════════ E4 订单 ══════════ */
export function seedOrders(): Order[] {
  return [
    { id: "112-664", platform: "Amazon US", sku: "P-001", goods: "宠物饮水机", qty: 1, amountUsd: 25.99, country: "US", status: "shipped", trackingNo: "YT2607X…", channel: "FBA", placedAt: "07-05" },
    { id: "112-671", platform: "Amazon US", sku: "P-002", goods: "猫胸背带 M", qty: 2, amountUsd: 31.98, country: "US", status: "allocated", channel: "FBA", placedAt: "07-06" },
    { id: "305-882", platform: "Amazon DE", sku: "P-002", goods: "猫胸背带 S", qty: 1, amountUsd: 19.96, country: "DE", status: "pending", placedAt: "07-07" },
    { id: "TM-4471", platform: "Temu", sku: "P-002", goods: "猫胸背带 L", qty: 1, amountUsd: 13.5, country: "US", status: "risk_hold", riskFlag: "收货地址与历史退款高发区匹配（AI 风控标记，建议人工看一眼）", placedAt: "07-06" },
    { id: "112-655", platform: "Amazon US", sku: "P-003", goods: "折叠收纳凳", qty: 1, amountUsd: 32.99, country: "US", status: "refunding", placedAt: "06-28" },
    { id: "112-640", platform: "Amazon US", sku: "P-001", goods: "宠物饮水机", qty: 1, amountUsd: 25.99, country: "CA", status: "delivered", trackingNo: "YT2606…", channel: "FBA", placedAt: "06-25" },
  ];
}

export function seedAfterSales(): AfterSale[] {
  return [
    {
      id: "AS-31", orderId: "112-655", type: "refund", reason: "买家称拉链损坏（附图）", amountUsd: 32.99, status: "proposed",
      proposal: "图片可见拉链头脱落，属质量问题。金额 $32.99 超过自动退款上限 $40？未超 —— 但该买家 90 天内第 2 次退款，建议人工过目后再退。",
    },
    {
      id: "AS-29", orderId: "112-640", type: "resend", reason: "少发滤芯配件", amountUsd: 4.5, status: "done",
      proposal: "补发滤芯 ×1（成本 $4.5 < 自动上限），已自动执行并留痕。",
    },
  ];
}

/* ══════════ E5 物流 ══════════ */
export function seedChannels(): ChannelCard[] {
  return [
    { id: "CH-1", name: "云途全球专线（普货）", zone: "美国", firstWeightCny: 13, perGramCny: 0.052, days: "8-12", battery: false },
    { id: "CH-2", name: "云途专线挂号（带电）", zone: "美国", firstWeightCny: 16, perGramCny: 0.061, days: "9-13", battery: true },
    { id: "CH-3", name: "燕文经济小包", zone: "全球", firstWeightCny: 8, perGramCny: 0.038, days: "15-25", battery: false, note: "低值件兜底" },
    { id: "CH-4", name: "4PX 联邮通标快", zone: "欧洲", firstWeightCny: 15, perGramCny: 0.058, days: "7-10", battery: true },
    { id: "CH-5", name: "海运整柜（头程入 FBA）", zone: "美国", firstWeightCny: 0, perGramCny: 0.009, days: "32-40", battery: true, note: "美西快船，按方计费折算" },
  ];
}

export function seedShipments(): ErpShipment[] {
  return [
    { id: "SH-701", orderId: "112-664", goods: "宠物饮水机", to: "US", channel: "云途全球专线", weightG: 210, costCny: 23.9, status: "运输中", days: 4, routeReason: "普货 210g 美国件：云途专线比 4PX 省 3.1 元、时效差 1 天，按成本权重 0.7 选云途。" },
    { id: "SH-698", orderId: "—", goods: "猫胸背带 S", to: "DE", channel: "4PX 联邮通标快", weightG: 195, costCny: 26.3, status: "已妥投", days: 1, routeReason: "历史运单（已妥投批次，非活动订单）。" },
    { id: "SH-690", orderId: "—", goods: "饮水机补货 600 台（海运头程）", to: "US-FBA (ONT8)", channel: "海运整柜", weightG: 780000, costCny: 7020, status: "停滞", days: 41, stalled: true, routeReason: "FBA 补货整柜美西快船。" },
  ];
}

/* ══════════ E6 采购/库存 ══════════ */
export function seedPos(): PurchaseOrder[] {
  return [
    { id: "PO-2407", supplier: "佛山市顺德区宠悦电器", sku: "P-001", goods: "宠物饮水机 2.5L", qty: 600, unitCny: 38.5, amountCny: 23100, status: "pending_pay", grnOk: false, invoiceOk: true, eta: "08-15" },
    { id: "PO-2406", supplier: "义乌市恒达宠物用品", sku: "P-002", goods: "猫胸背带套装（混码）", qty: 1500, unitCny: 16.8, amountCny: 25200, status: "producing", grnOk: false, invoiceOk: false, eta: "07-28" },
    { id: "PO-2405", supplier: "佛山市顺德区宠悦电器", sku: "P-001", goods: "宠物饮水机 2.5L", qty: 400, unitCny: 39.0, amountCny: 15600, status: "received", grnOk: true, invoiceOk: true },
  ];
}

export function seedStock(): StockRow[] {
  return [
    { sku: "P-001", name: "宠物自动饮水机 2.5L", local: 40, overseas: 0, fba: 380, transit: 600, dailySales: 21, daysLeft: 20 },
    { sku: "P-002", name: "猫咪外出胸背带套装", local: 260, overseas: 120, fba: 510, transit: 0, dailySales: 31, daysLeft: 28 },
    { sku: "P-003", name: "可折叠收纳凳 60L", local: 15, overseas: 0, fba: 96, transit: 0, dailySales: 6, daysLeft: 18 },
  ];
}

/* ══════════ E7 财务 ══════════ */
export function seedDocs(): EvidenceDoc[] {
  return [
    { id: "D-901", type: "vat-invoice", party: "佛山市顺德区宠悦电器", no: "044002400111", date: "2026-07-02", amount: 15600, currency: "CNY", taxAmount: 1794.69, conf: 99, booked: true, bundleId: "B-11", dupCheck: "ok" },
    { id: "D-902", type: "bank-receipt", party: "招商银行（付宠悦电器）", no: "CMB-0702-8841", date: "2026-07-02", amount: 15600, currency: "CNY", conf: 99, booked: true, bundleId: "B-11", dupCheck: "ok" },
    { id: "D-903", type: "customs-decl", party: "深圳海关", no: "531620260618", date: "2026-06-18", amount: 21500, currency: "USD", conf: 97, booked: true, bundleId: "B-11", dupCheck: "ok" },
    { id: "D-904", type: "platform-stmt", party: "Amazon US 结算", no: "STMT-2026-0630", date: "2026-06-30", amount: 18432.77, currency: "USD", conf: 99, booked: true, dupCheck: "ok" },
    { id: "D-905", type: "logistics-bill", party: "云途物流", no: "YT-BILL-0705", date: "2026-07-05", amount: 4213.6, currency: "CNY", conf: 92, lowFields: ["燃油附加费明细行"], booked: false, dupCheck: "ok" },
    { id: "D-906", type: "vat-invoice", party: "义乌市恒达宠物用品", no: "033002400872", date: "2026-07-06", amount: 25200, currency: "CNY", taxAmount: 2899.12, conf: 96, lowFields: ["购方税号尾两位"], booked: false, dupCheck: "suspect" },
  ];
}

export function seedBundles(): EvidenceBundle[] {
  return [
    { id: "B-11", title: "PO-2405 采购→付款→出口 业务包", docIds: ["D-901", "D-902", "D-903"], status: "complete", note: "发票=回单=1.56万，报关单对应出口批次，证据链齐，可支撑退税。" },
    { id: "B-12", title: "PO-2406 采购业务包（进行中）", docIds: ["D-906"], status: "partial", note: "已收发票，缺银行付款回单（PO 尚未付款）。" },
  ];
}

export function seedJournal(): JournalEntry[] {
  // 账实一致约束：每张 booked:true 的票据都有对应 docId 凭证（审计链可追）；
  // 增值税发票价税分离（价额 13,805.31 + 进项税 1,794.69 = 票面 15,600），科目口径与 bookDoc RULE 一致。
  return [
    { id: "J-501", date: "2026-07-02", summary: "佛山市顺德区宠悦电器 · 044002400111（价额）", debit: "库存商品/费用", credit: "应付账款", amountCny: 13805.31, docId: "D-901", by: "auto" },
    { id: "J-502", date: "2026-07-02", summary: "佛山市顺德区宠悦电器 · 044002400111（进项税额）", debit: "应交税费-应交增值税（进项税额）", credit: "应付账款", amountCny: 1794.69, docId: "D-901", by: "auto" },
    { id: "J-503", date: "2026-07-02", summary: "招商银行（付宠悦电器） · CMB-0702-8841", debit: "应付账款", credit: "银行存款", amountCny: 15600, docId: "D-902", by: "auto" },
    { id: "J-504", date: "2026-06-18", summary: "深圳海关 · 531620260618（出口备查）", debit: "备查登记（出口）", credit: "—", amountCny: 153080, docId: "D-903", by: "auto" },
    { id: "J-505", date: "2026-06-30", summary: "Amazon US 6月结算回款", debit: "银行存款", credit: "应收账款-平台", amountCny: 131241.32, docId: "D-904", by: "auto" },
    { id: "J-506", date: "2026-06-30", summary: "6月平台佣金计提", debit: "销售费用-佣金", credit: "应收账款-平台", amountCny: 23140.8, by: "auto" },
  ];
}

export function seedRecon(): ReconRow[] {
  return [
    { id: "R-21", item: "Amazon 6月结算 → PingPong 到账", amount: "$18,432.77", side: "平台↔回款商", match: "PP-0701-3321", conf: 99, status: "已匹配" },
    { id: "R-22", item: "PingPong 结汇 → 招行入账", amount: "¥129,876.20", side: "回款商↔银行", match: "CMB-0703-1102", conf: 97, status: "待确认" },
    { id: "R-23", item: "结汇汇差 + 手续费", amount: "¥1,285.10", side: "费用挂账", match: "拟挂：财务费用-汇兑损益", conf: 90, status: "待确认" },
    { id: "R-24", item: "Temu 6月下旬货款", amount: "$1,742.00", side: "平台↔回款商", match: "未找到候选", conf: 0, status: "未达" },
  ];
}

export function seedReports(): MonthlyReport[] {
  return [
    { month: "2026-04", gmvUsd: 41200, netProfitCny: 58400, marginPct: 19.9, cashCny: 216000, closed: true },
    { month: "2026-05", gmvUsd: 47800, netProfitCny: 71300, marginPct: 21.0, cashCny: 254000, closed: true },
    { month: "2026-06", gmvUsd: 52400, netProfitCny: 80100, marginPct: 21.5, cashCny: 281000, closed: false },
  ];
}

/* ══════════ E8 报税 ══════════ */
export function seedFilings(): TaxFiling[] {
  return [
    {
      id: "F-61", name: "2026-06 增值税及附加申报", region: "国内", period: "2026-06", due: "2026-07-15",
      status: "preparing", amountDue: 0, currency: "CNY",
      checkNotes: ["出口销售适用免抵退，销项为 0", "进项发票 2 张待勾稽（含 D-906 疑似重复票，先排除）"],
      docsReady: [
        { name: "销项汇总表", ok: true }, { name: "进项勾稽清单", ok: false },
        { name: "出口销售明细", ok: true },
      ],
    },
    {
      id: "F-62", name: "2026-Q2 德国 VAT 申报", region: "德国", period: "2026-Q2", due: "2026-08-10",
      status: "preparing", amountDue: 1841.6, currency: "EUR",
      checkNotes: ["DE 站 Q2 销售 €9,692.63，税率 19%", "Amazon 代扣部分需从应缴中抵减，差额 €1,841.60"],
      docsReady: [
        { name: "Amazon VAT 交易报告", ok: true }, { name: "代扣税凭证", ok: true },
        { name: "申报表草稿", ok: false },
      ],
    },
    {
      id: "F-63", name: "2026-05 出口退税（第 3 批）", region: "国内", period: "2026-05", due: "2026-07-31",
      status: "ready", amountDue: 2028.0, currency: "CNY",
      checkNotes: ["B-11 业务包证据链完整：发票+付款回单+报关单三单齐", "退税率 13%，可退 ¥2,028.00"],
      docsReady: [
        { name: "报关单（531620260618）", ok: true }, { name: "进项发票", ok: true },
        { name: "收汇凭证", ok: true },
      ],
    },
    {
      id: "F-64", name: "2026-Q2 企业所得税预缴", region: "国内", period: "2026-Q2", due: "2026-07-15",
      status: "upcoming", currency: "CNY",
      checkNotes: ["按实际利润预缴，Q2 账面利润约 ¥15.1 万，小微优惠后预计 ¥3,780"],
    },
  ];
}
