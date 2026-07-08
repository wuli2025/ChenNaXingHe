/**
 * 星河无头ERP —— AI 代理提示词。
 *
 * 约定：
 *  - runJson 类动作：提示词末尾强制「只输出一个 JSON 对象」，形状与 store 的泛型对应。
 *  - 所有提示词自带业务背景（跨境电商一人公司），让 Claude 不用反问即可干活。
 *  - feedback 参数：审批驳回后带批注重跑（闭环）。
 */
import type { EvidenceDoc, PriceCard, Product, ReconRow, TaxFiling } from "./types";

const BIZ = `你是「星河出海」跨境电商一人公司的 AI 业务代理。公司卖宠物用品与家居收纳，
平台：Amazon US / Amazon DE / Temu；采购自 1688 与工厂直采；物流走云途/燕文/4PX，FBA 补货走海运头程。
所有对外动作（付款、报税提交、发布）都有人工审批闸，你只负责把功课做完、给出可核验的依据。`;

/** 通用对话（右侧 AI 坞）。 */
export function promptChat(modName: string, modSub: string, text: string): string {
  return `${BIZ}
当前用户正在看「${modName}」模块（${modSub}）。请贴合该模块业务作答，中文，简洁、直接给结论和依据。

用户说：${text}`;
}

/** E1 选品官：选品调研。 */
export function promptResearch(c: { keywords: string; category: string; priceBand: string; count: number }, feedback?: string): string {
  return `${BIZ}
【任务】选品调研：围绕「${c.keywords || c.category}」方向，产出 ${c.count} 个候选品。
筛选口径：品类=${c.category || "宠物/家居"}，目标客单价=${c.priceBand || "$10-$40"}，避开带认证门槛与价格战红海。
每个候选给出：中文品名、英文品名、预估采购价(CNY)、预估头尾程运费(USD/件)、建议售价(USD)、竞品均价(USD)、月销估算、选品理由（数据依据）、评分0-100。
${feedback ? `【上一轮被人工驳回，批注】${feedback}\n请针对批注改进。` : ""}
只输出一个 JSON 对象，不要其它文字：
{"candidates":[{"name":"","nameEn":"","category":"","costCny":0,"shipUsd":0,"priceUsd":0,"rivalUsd":0,"monthlySales":0,"reason":"","score":0}]}`;
}

/** E2 运营官：生成/优化 Listing。 */
export function promptListing(p: Product, platform: string, lang: string, mode: "create" | "optimize", current?: { title: string; cvr?: number }, feedback?: string): string {
  return `${BIZ}
【任务】${mode === "create" ? "为新品生成" : "优化在售"} Listing。
商品：${p.name}（${p.nameEn}），品类 ${p.category}，售价 $${p.priceUsd}，竞品均价 $${p.rivalUsd}。
平台：${platform}，语言：${lang}（要求母语级本地化，不是直译）。
${mode === "optimize" && current ? `现有标题：${current.title}\n现转化率：${current.cvr ?? "?"}%，请给出可提升转化的改写。` : ""}
要求：标题 ≤200 字符、前 80 字符含核心关键词；五点卖点各 ≤250 字符、卖点导向；搜索词 ≤250 字节；避开平台禁词（best/cheapest/cure 等绝对化用语）。
${feedback ? `【上一轮被人工驳回，批注】${feedback}\n请针对批注改进。` : ""}
只输出一个 JSON 对象：
{"title":"","bullets":["","","","",""],"keywords":"","rationale":"一句话说明优化思路"}`;
}

/** E3 定价官：调价建议。 */
export function promptPricing(card: PriceCard, context: string, feedback?: string): string {
  return `${BIZ}
【任务】给出调价建议。
SKU：${card.name}（${card.platform}）。保本价 $${card.breakEvenUsd}（硬底线，任何建议不得低于它）、
目标价 $${card.targetUsd}、当前价 $${card.currentUsd}、竞品价 $${card.rivalUsd}、跟价策略 ${card.strategy}。
触发背景：${context}
给出建议新价、理由链（竞品动了什么/为何跟/利润影响）、预估新净利率。
${feedback ? `【上一轮被人工驳回，批注】${feedback}\n请针对批注改进。` : ""}
只输出一个 JSON 对象：
{"newPrice":0,"reason":"","marginPct":0,"confidence":0}`;
}

/** E5 物流官：渠道选路。 */
export function promptRoute(goods: string, to: string, weightG: number, battery: boolean, channels: string, feedback?: string): string {
  return `${BIZ}
【任务】物流选路：为一件发往 ${to} 的「${goods}」（${weightG}g，${battery ? "带电" : "普货"}）从渠道库中选最优渠道。
渠道库（名称|分区|首重|续重CNY/g|时效|可否带电）：
${channels}
按 成本权重0.7 + 时效权重0.3 计算，带电必须走可带电渠道。给出所选渠道、测算运费(CNY)、选择理由（对比另外至少1条渠道）。
${feedback ? `【上一轮被人工驳回，批注】${feedback}\n请针对批注改进。` : ""}
只输出一个 JSON 对象：
{"channel":"","costCny":0,"reason":"","confidence":0}`;
}

/** E7 财务官：票据 OCR 抽取（用户粘贴票据文字/描述，或后续接图片）。 */
export function promptOcr(rawText: string, feedback?: string): string {
  return `${BIZ}
【任务】票据识别与结构化：以下是一张票据的原始内容（OCR 文字/邮件正文/用户粘贴）。
识别票据类型（vat-invoice 增值税发票 / bank-receipt 银行回单 / platform-stmt 平台结算单 / logistics-bill 物流账单 / customs-decl 报关单 / receipt 收据），
抽取：对手方、票号、日期(YYYY-MM-DD)、金额、币种(CNY/USD/EUR)、税额（发票才有）。
每个字段给置信度，整单给综合置信度 conf（0-100）；金额大小写不一致、税率异常、要素缺失时列入 lowFields 并压低置信度。
${feedback ? `【上一轮被人工驳回，批注】${feedback}\n请针对批注改进。` : ""}
票据原文：
"""
${rawText.slice(0, 3000)}
"""
只输出一个 JSON 对象：
{"type":"vat-invoice","party":"","no":"","date":"","amount":0,"currency":"CNY","taxAmount":0,"conf":0,"lowFields":[],"suggestBundle":"建议归入的业务包线索（如 PO 号），没有则空串"}`;
}

/** E7 财务官：对账候选匹配。 */
export function promptRecon(r: ReconRow, feedback?: string): string {
  return `${BIZ}
【任务】三方对账：账项「${r.item}」金额 ${r.amount}（${r.side}）当前状态「${r.status}」。
为它找最可能的匹配对象（结算单号/银行流水号/应挂科目），给出理由与置信度。
${feedback ? `【上一轮被人工驳回，批注】${feedback}\n请针对批注改进。` : ""}
只输出一个 JSON 对象：
{"candidates":[{"target":"","reason":"","conf":0}]}`;
}

/** E8 税务官：申报前检查报告。 */
export function promptTaxCheck(f: TaxFiling, feedback?: string): string {
  return `${BIZ}
【任务】生成《申报前检查报告》：申报事项「${f.name}」（${f.region} · 期间 ${f.period} · 截止 ${f.due}）。
当前要点：${(f.checkNotes || []).join("；") || "无"}。
资料包：${(f.docsReady || []).map((d) => `${d.name}${d.ok ? "✓" : "✗缺"}`).join("、") || "未整理"}。
输出：异常波动提示（进销项倒挂/税负率异常/证据链缺口）、待补资料、申报金额复核、结论（可提交/需补件）。
注意：你只做到「申报表就绪」，提交动作必须由老板人工确认 —— 结论里明确写出这一点。
${feedback ? `【上一轮被人工驳回，批注】${feedback}\n请针对批注改进。` : ""}
只输出一个 JSON 对象：
{"issues":[""],"missingDocs":[""],"amountCheck":"","conclusion":"","readyToSubmit":false}`;
}

/** E0 总管代理：每日经营晨报。 */
export function promptBrief(snapshot: string): string {
  return `${BIZ}
【任务】生成今日《经营晨报》。以下是系统各模块的实时快照数据（JSON）：
${snapshot}
用中文输出 Markdown 晨报，5 分钟能读完：
1) 昨日成绩单（GMV/利润/订单）；2) 代理们做了什么（自动执行的动作）；3) 今日待你决策（待审批事项，硬闸置顶）；
4) 风险预警（库存告警/物流停滞/对账未达/申报临期）；5) 一条最重要的建议。
数据不足的地方直说「数据不足」，不要编数字。`;
}

/** E6 供应链官：补货建议。 */
export function promptReplenish(stockJson: string, params: string, feedback?: string): string {
  return `${BIZ}
【任务】智能补货：以下是四态库存与销售速度快照（JSON）：
${stockJson}
参数：${params}
对可售天数 < 安全库存天数+备货周期 的 SKU 给出补货建议（数量=日均销量×(备货周期+安全天数)−现有可售），并组成 PO 草案。
${feedback ? `【上一轮被人工驳回，批注】${feedback}\n请针对批注改进。` : ""}
只输出一个 JSON 对象：
{"suggestions":[{"sku":"","name":"","qty":0,"reason":"","supplier":"按历史 PO 推荐","unitCny":0}]}`;
}

/** 票据类型中文（供 UI/晨报引用）。 */
export function docLabel(d: EvidenceDoc): string {
  return `${d.party} · ${d.no}`;
}
