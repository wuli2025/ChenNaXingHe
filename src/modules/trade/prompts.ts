/**
 * 北极星外贸 OS —— Agent 提示词构造器。
 * 全部走 useAgentRunner.run/runJson（唯一大脑官方 Claude Code）。
 * 方法论硬约束 + 输出 schema 拼进 prompt；反幻觉：字段级置信度、低分转人工闸。
 */
import type { SupplierLead, CustomsDeclaration, ReconMatch } from "./types";

export const JSON_RULE = `【JSON 输出铁律】
- 最终只输出一个合法 JSON，前后不要任何解释文字、不要 markdown 围栏。
- 字符串内若含双引号，改成单引号或转义为 \\"；不要尾随逗号。`;

const BIZ = `你服务澳洲进口分销商『澳鲸进口 / Orca Imports Pty Ltd』（葡萄酒/食品进口）。边界原则：算自己做、报交出去；结构化产出 + 关键动作人工确认；不做群发骚扰、不直连海关。`;

/** 驳回重跑反馈段（有则拼进 prompt，让重跑针对性改进）。 */
function feedbackBlock(feedback?: string): string {
  return feedback && feedback.trim()
    ? `\n【上一轮结果被人工驳回，请针对性改进】${feedback.trim()}\n`
    : "";
}

/* ── M1 选品采集 ── */
export function promptSourcing(criteria: { keywords: string; region: string; category: string; limit: number }): string {
  return `${BIZ}
你是选品研究员。请用联网检索能力，围绕澳洲进口分销缺口，采集一批候选葡萄酒/食品 SKU。

【采集条件】
- 关键词：${criteria.keywords || "智利/南非新酒庄 有机红酒"}
- 产区：${criteria.region || "不限"}
- 品类：${criteria.category || "红酒"}
- 目标数量：${criteria.limit || 6}

【硬约束】只收录真实可查的产区/酒庄；拿不到的字段留空，不要编造；给每条字段置信度 conf(0-100)，低于 60 视为待人工复核。

按 schema 输出：
{ "skus": [ { "name": "品名", "region": "产区", "priceBand": "$4.2–5.0 FOB", "certs": "有机+HACCP", "conf": 85 } ] }

${JSON_RULE}`;
}

/* ── M2 建联：线索画像 ── */
export function promptLeadProfile(lead: SupplierLead): string {
  return `${BIZ}
请为下面这个**新供应商线索**做画像，评估建联优先级。

【线索】
- 公司：${lead.company}（${lead.country} · ${lead.region}）
- 主营：${lead.category}
- 官网：${lead.website}

请检索公开信息，抽取 {主营品类, 认证, 出口经验, MOQ量级, 产区匹配度} 并给每项置信度(0-100)；再给建联优先级 A/B/C。

按 schema 输出：
{ "profile": {"主营品类":"...","认证":"...","出口经验":"...","MOQ量级":"...","产区匹配度":"..."}, "confs": {"认证":90,"出口经验":70,"MOQ量级":60}, "grade":"A", "score":86 }

${JSON_RULE}`;
}

/* ── M2 建联：破冰开发信（个性化，多语言） ── */
export function promptOutreach(lead: SupplierLead, lang: string, feedback?: string): string {
  const langName = lang === "zh" ? "中文" : lang === "es" ? "西班牙语（Español）" : "英文";
  return `${BIZ}
请为目标供应商写一封**个性化破冰开发信**（非模板群发），语言：${langName}。

【对方】${lead.company} · ${lead.country} ${lead.region} · 主营 ${lead.category} · 联系人 ${lead.contact}
【我方意图】把对方的优质货源引入澳洲市场，索要 FOB 报价单与 MOQ，并可安排样品。
${feedbackBlock(feedback)}
要求：开头点出对方产区/认证亮点（体现做过功课），中段说明我方是谁与合作价值，结尾给明确 next step（报价/样品）。专业、真诚、简洁，8-14 行。直接输出信件正文，不要 JSON、不要额外说明。`;
}

/* ── M2 建联：回信意向分类 ── */
export function promptReplyClass(replyText: string): string {
  return `${BIZ}
请判断下面这封供应商回信的意向类别。

---回信---
${replyText.slice(0, 3000)}

类别取值：interested(有兴趣) / sample(索样) / quoted(已报价) / rejected(拒绝) / irrelevant(无关)。
按 schema 输出：{ "replyClass": "sample", "reason": "一句话依据", "conf": 88 }

${JSON_RULE}`;
}

/* ── M3 采购：询价信 ── */
export function promptRfq(supplierName: string, sku: string): string {
  return `${BIZ}
请给已合作供应商「${supplierName}」写一封比价询价信，标的：${sku}。请对方提供 {单价FOB, 币种, 交期, MOQ, 报价有效期}。专业简洁，英文，直接输出正文。`;
}

/* ── M3 采购：回信结构化抽取 ── */
export function promptQuoteExtract(replyText: string): string {
  return `${BIZ}
请从供应商回信中剥离签名后，抽取结构化报价字段，并给每字段置信度(0-100)，低于 85 需人工确认。

---回信---
${replyText.slice(0, 3000)}

按 schema 输出：
{ "price": 4.2, "currency": "USD", "leadTime": "45 天", "moq": "1x20ft", "validUntil": "2026-08-31", "confidence": {"price":92,"leadTime":80,"moq":88} }

${JSON_RULE}`;
}

/* ── M4 报关：HS 归类 ── */
export function promptHsClassify(dec: CustomsDeclaration, feedback?: string): string {
  const line = dec.lines[0];
  return `${BIZ}
请结合澳洲税则与 llmwiki 归类规则，为下面商品给出 10 位 HS 编码、依据与置信度。低于 85 强制转人工。
为满足「可交叉验证」，reasoning 必须引用具体税则条文/章注，dutyRate 注明协定依据。

【商品】${line?.desc || dec.goods} · 原产地 ${line?.origin || dec.origin} · 协定 ${dec.agreement}
${feedbackBlock(feedback)}
按 schema 输出：
{ "hsCode": "2204.21.00", "reasoning": "归类依据（税则条文）", "dutyRate": "0%(ChAFTA)", "hsConf": 94, "dutyConf": 79 }

${JSON_RULE}`;
}

/* ── M4 报关：回执解析 ── */
export function promptCustomsReceipt(receiptText: string): string {
  return `${BIZ}
请解析报关行回传的回执，判断结果与后续动作。

---回执---
${receiptText.slice(0, 2000)}

按 schema 输出：{ "result": "放行|查验|补料", "detail": "说明", "nextAction": "系统应做什么" }

${JSON_RULE}`;
}

/* ── M6 补货建议 ── */
export function promptReplenish(context: string): string {
  return `${BIZ}
请基于销量/在库/在途/交期给补货建议。数值部分我方本地已算，你只需给出补货量判断的**解释与风险提示**。

【上下文】${context}

按 schema 输出：{ "suggestions": [ {"sku":"SKU-SHRZ-21","qty":3600,"by":"07-20 前","reason":"..."} ] }

${JSON_RULE}`;
}

/* ── M7 报价单 / 对客邮件 ── */
export function promptQuoteOut(customer: string, sku: string, bottles: number, inclUnit: number, inclTotal: number, feedback?: string): string {
  const qty = bottles > 0 ? `${bottles} 瓶` : "整批";
  return `${BIZ}
请给分销客户「${customer}」起草一封报价邮件，标的 ${sku}，数量 ${qty}，含税单价（WET+GST）AUD ${inclUnit.toFixed(2)}/瓶，含税总额 AUD ${inclTotal.toFixed(2)}。含税价与合规中心同一函数取数。专业友好，中文，直接输出正文。${feedbackBlock(feedback)}`;
}

/* ── M8 对账辅助 ── */
export function promptRecon(open: ReconMatch, feedback?: string): string {
  return `${BIZ}
请为下面这笔未达账项给出候选匹配与理由。

【未达】${open.item} · ${open.amount}
${feedbackBlock(feedback)}
按 schema 输出：{ "candidates": [ {"target":"凭证/单据号","reason":"匹配依据","conf":86} ] }

${JSON_RULE}`;
}

/* ── M9 合规要件核查 ── */
export function promptCompliance(container: string, goods: string): string {
  return `${BIZ}
请对一柜货（${container} · ${goods}）按澳洲进口合规（WET/GST/FSANZ标签/Biosecurity/TGA）列出应备要件清单与当前缺口，检索 llmwiki 合规知识。

按 schema 输出：{ "items": [ {"name":"英文背标","required":true,"status":"缺","basis":"FSANZ 1.2.9"} ], "release": "缺证拦发货|可放行" }

${JSON_RULE}`;
}

/* ── M11 知识检索问答 ── */
export function promptKbAsk(question: string): string {
  return `${BIZ}
请基于外贸知识库（合规要件/HS规则/税则/ChAFTA/产区名录/话术）回答，给要点式结构化结论并注明依据。

【问题】${question}`;
}

/* ── 通用对话（对话坞） ── */
export function promptChat(modName: string, modSub: string, text: string): string {
  return `${BIZ}
当前功能模块：${modName}（${modSub}）。
请用中文、专业且简洁地作答；涉及报关/税费/HS/报价时给出要点式结构化结论。

用户请求：${text}`;
}
