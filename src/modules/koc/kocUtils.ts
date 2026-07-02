/**
 * KOC 工作流 —— 纯函数工具集：CSV 解析/导出（无第三方库）、表头别名映射导入、
 * 结构化 Brief 构建、格式化、localStorage 持久化。
 *
 * 移植自参考实现的 parseCSV / getRowField 别名映射 / buildHot70BriefContent /
 * exportCSV / exportTrackingCSV / fmtNum 等，归一到 canonical Koc 形状。
 */
import type {
  Koc,
  BriefContent,
  BriefDirection,
  KocStatus,
  MetricKey,
  VideoMonitor,
  Brief,
} from "./types";
import { TIER_FOLLOWERS, METRIC_META, METRIC_KEYS } from "./types";
import { applyScore, normalizeTier } from "./scoring";

/* ─────────────── 格式化 ─────────────── */
export function fmtNum(n?: number): string {
  if (!n && n !== 0) return "-";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(Math.round(n));
}

export function statusClass(status?: KocStatus): string {
  return { pass: "st-pass", fail: "st-fail", risk: "st-risk" }[status || "risk"] || "st-pending";
}

const CAT_LABELS: Record<string, string> = {
  campus: "校园/学生",
  tech: "科技/数码",
  lifestyle: "生活方式",
  fashion: "时尚",
  entertainment: "娱乐",
  food: "美食",
  sports: "运动",
  other: "其他",
};
export function catLabel(cat?: string): string {
  return (cat && CAT_LABELS[cat]) || cat || "-";
}

const TIER_LABELS: Record<string, string> = {
  "1k-5k": "1K–5K",
  "5k-10k": "5K–10K",
  "10k-30k": "10K–30K",
  "30k-100k": "30K–100K",
  "50k-100k": "50K–100K",
  "100k-300k": "100K–300K",
  "300k+": "300K+",
};
export function tierLabel(k: Koc): string {
  if (k.tier) return TIER_LABELS[k.tier] || k.tier;
  const f = k.followers || 0;
  if (f >= 300000) return "300K+";
  if (f >= 100000) return "100K–300K";
  if (f >= 50000) return "50K–100K";
  if (f >= 30000) return "30K–100K";
  if (f >= 10000) return "10K–30K";
  if (f >= 5000) return "5K–10K";
  return "1K–5K";
}

export function localPct(k: Koc): number {
  return (
    Number(k.nigeriaLocalAudience || 0) ||
    Number(k.lagosAudience || 0) + Number(k.ibadanAudience || 0)
  );
}

export function uid(prefix = "k"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/* ─────────────── localStorage ─────────────── */
export function lsLoad<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function lsSave(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — silently ignore */
  }
}

/* ─────────────── CSV 解析（无库） ─────────────── */
export function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values;
}

export interface ParsedCSV {
  headers: string[];
  rows: Record<string, string>[];
}
/**
 * RFC-4180 CSV 解析：对整段文本做状态机切分，正确处理带引号的字段
 * （含转义双引号 "" 与嵌入换行 / 逗号）。旧实现先按换行 split 再逐行 parse，
 * 会把带内嵌换行的引号单元格从中间拆断，导致整行错位。
 */
export function parseCSV(text: string): ParsedCSV {
  const src = text.replace(/^﻿/, ""); // 去掉 BOM
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n") {
      record.push(field);
      field = "";
      records.push(record);
      record = [];
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  // flush 末尾未闭合的字段 / 记录（文件不以换行结尾时）
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  // 丢弃全空记录（空行 / 末尾换行）
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (nonEmpty[0] || []).map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((vals) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = (vals[i] ?? "").trim()));
    return obj;
  });
  return { headers, rows };
}

/** 表头别名映射取值（移植 getRowField，含大小写归一兜底）。 */
export function getRowField(row: Record<string, string>, names: string[]): string {
  for (const name of names) {
    if (row[name] != null && String(row[name]).trim() !== "") return String(row[name]).trim();
  }
  const normalized: Record<string, string> = {};
  Object.keys(row).forEach((key) => (normalized[key.trim().toLowerCase()] = row[key]));
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (normalized[key] != null && String(normalized[key]).trim() !== "")
      return String(normalized[key]).trim();
  }
  return "";
}

function normalizePlatform(value: string): Koc["platform"] {
  const v = String(value || "tiktok").toLowerCase();
  if (v.includes("ig") || v.includes("instagram")) return "instagram";
  if (v.includes("youtube")) return "youtube";
  return "tiktok";
}

/** CSV 行 → 评分后的 Koc（移植 btn-import-csv 的别名映射逻辑）。 */
export function rowToKoc(row: Record<string, string>): Koc | null {
  const platform = normalizePlatform(getRowField(row, ["Platforms", "Platform", "platform", "平台"]));
  const username = getRowField(row, ["KOC", "username", "账号名", "账号"]);
  if (!username) return null;
  const tier = normalizeTier(getRowField(row, ["Tier", "粉丝量级"]));
  const actViews = +getRowField(row, ["Act. Views", "Actual Views", "act_views", "实际播放"]) || 0;
  const actEngagement =
    +getRowField(row, ["Act. Engagement", "Actual Engagement", "act_engagement", "实际互动"]) || 0;
  const followers = +getRowField(row, ["followers", "粉丝量"]) || TIER_FOLLOWERS[tier] || 0;
  const engRate = +getRowField(row, ["engagement_rate", "互动率", "互动率(%)"]) || 0;
  const lagos = +getRowField(row, ["lagos", "Lagos受众占比"]) || 0;
  const ibadan = +getRowField(row, ["ibadan", "Ibadan受众占比"]) || 0;

  const koc: Koc = {
    id: uid("csv"),
    platform,
    username,
    name: getRowField(row, ["name", "昵称"]) || username,
    url: getRowField(row, ["Profile Link", "url", "主页链接"]),
    tier,
    ksp: getRowField(row, ["KSP"]),
    script: getRowField(row, ["Script"]),
    postDate: getRowField(row, ["Post Date", "post_date"]),
    postLink: getRowField(row, ["Post Link", "post_link"]),
    collabFee:
      +getRowField(row, ["Collaboration Fee (USD)", "Collab Fee (USD)", "collab_fee"]) || 0,
    actViews,
    actEngagement,
    shippingAddress: getRowField(row, ["Shipping Address", "收货地址"]),
    brandCollaboration: getRowField(row, ["Brand Collab?", "Brand Collaboration", "是否有过品牌合作"]),
    hasInstagram: getRowField(row, [
      "Instagram?",
      "Instagram",
      "是否同时运营 Instagram",
      "是否同时运营Instagram",
    ]),
    recruitmentSource: getRowField(row, ["Recruitment Source", "招募渠道来源"]),
    followers,
    engagementRate: engRate || (platform === "tiktok" ? 0 : 0),
    avgViews: +getRowField(row, ["avg_views", "平均播放量", "平均播放/Reels"]) || actViews || 0,
    reelsAvg: platform === "instagram" ? +getRowField(row, ["reels_avg", "Reels平均播放", "平均播放/Reels"]) || actViews || 0 : undefined,
    lagosAudience: lagos,
    ibadanAudience: ibadan,
    nigeriaLocalAudience:
      +getRowField(row, [
        "Nigeria Local Audience %",
        "尼日利亚本地受众占比",
        "尼日利亚本地受众(%)",
        "本地受众占比",
      ]) || 0,
    contentBrandFit: getRowField(row, ["Content Brand Fit", "内容与品牌契合度评分"]),
    targetAudienceOverlap: getRowField(row, ["Target Audience Overlap", "受众与目标人群重叠度"]),
    accountAuthenticity: getRowField(row, ["Account Authenticity", "账号真实性评估"]),
    kolTypeGrade: getRowField(row, ["KOL Type Grade", "KOL 类型分级"]),
    collabReputation: getRowField(row, ["Collab Reputation", "历史合作口碑"]),
    outputStability: getRowField(row, ["Output Stability", "内容产出稳定性"]),
    competitorConflict: getRowField(row, ["Competitor Conflict", "独家性 / 竞品冲突", "独家性/竞品冲突"]),
    remark: getRowField(row, ["Remark / Not-in Reason", "备注 / 不入库原因", "备注/不入库原因"]),
    category: getRowField(row, ["Category", "category", "垂类"]),
    frequency: getRowField(row, ["frequency", "发布频率"]),
    growthTrend: getRowField(row, ["growth", "增长趋势"]),
    manualRisks: [],
    source_type: "csv",
    addedAt: new Date().toISOString(),
    events: [
      {
        id: uid("ev"),
        kind: "imported",
        title: "CSV 导入",
        input: username,
        at: Date.now(),
      },
    ],
  };
  return applyScore(koc);
}

/* ─────────────── CSV 导出（无库） ─────────────── */
export function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function downloadFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** 导出筛选结果 CSV（移植 exportCSV）。 */
export function exportScreeningCSV(kocData: Koc[]): void {
  const headers = [
    "账号名",
    "平台",
    "粉丝量",
    "平均播放/Reels",
    "互动率(%)",
    "尼日利亚本地受众(%)",
    "垂类",
    ...METRIC_KEYS.map((k) => METRIC_META[k].label),
    "综合评分",
    "入库等级",
    "结论",
    "AI评判",
    "风险/备注",
  ];
  const rows = kocData.map((k) => [
    k.username,
    k.platform === "tiktok" ? "TikTok" : k.platform === "instagram" ? "Instagram" : k.platform,
    k.followers,
    k.platform === "tiktok" ? k.avgViews || 0 : k.reelsAvg || 0,
    k.engagementRate != null ? k.engagementRate.toFixed(1) : "",
    localPct(k),
    catLabel(k.category || k.styleTag),
    ...METRIC_KEYS.map((mk) => (k.scoring?.[mk] ? k.scoring[mk].value.toFixed(1) : "")),
    k.score ?? "",
    k.entryGrade || "",
    k.verdict || "",
    k.aiJudgment ? k.aiJudgment.verdict : "",
    (k.risks || []).join("; "),
  ]);
  const csv = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  downloadFile("koc_screening_result.csv", "﻿" + csv, "text/csv;charset=utf-8");
}

/** 导出 Tracking CSV（移植 exportTrackingCSV，17 列业务 + 不含评分维度）。 */
export function exportTrackingCSV(trackingList: Koc[]): void {
  const headers = [
    "#",
    "Category",
    "KOC",
    "Platforms",
    "Profile Link",
    "Tier",
    "KSP",
    "Script",
    "Post Date",
    "Post Link",
    "Collaboration Fee (USD)",
    "Act. Views",
    "Act. Engagement",
    "Shipping Address",
    "Brand Collab?",
    "Instagram?",
    "Recruitment Source",
  ];
  const rows = trackingList.map((k, i) => [
    i + 1,
    k.category || "",
    k.name || k.username,
    k.platform === "tiktok" ? "TikTok" : k.platform || "TikTok",
    k.url || `https://www.tiktok.com/@${k.username}`,
    tierLabel(k),
    k.ksp || "",
    k.script || "",
    k.postDate || "",
    k.postLink || "",
    k.collabFee || "",
    k.actViews || "",
    k.actEngagement || "",
    k.shippingAddress || "",
    k.brandCollaboration || (k.brandExp === "yes" ? "Yes" : k.brandExp === "no" ? "No" : ""),
    k.hasInstagram === "yes" ? "Yes" : k.hasInstagram === "no" ? "No" : k.hasInstagram || "",
    k.recruitmentSource ||
      ({ self: "Self Apply", outreach: "Outreach", referral: "Referral" } as Record<string, string>)[
        k.source || ""
      ] ||
      k.source ||
      "",
  ]);
  const csv = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  downloadFile(
    `KOC_Tracking_${new Date().toISOString().slice(0, 10)}.csv`,
    "﻿" + csv,
    "text/csv;charset=utf-8"
  );
}

/* ─────────────── 结构化 Brief 构建（移植 buildHot70BriefContent） ─────────────── */
function getHot70ContentDirections(k: Koc): BriefDirection[] {
  const cat = String(k.category || "").toLowerCase();
  const directions: BriefDirection[] = [
    { title: "外观颜值", desc: "拿出来有面子，设计好看，上镜，适合课堂、宿舍、校园路上等日常场景。" },
    {
      title: "45W 快充对比",
      desc: "用计时方式展示 Hot 70 约 20 分钟完成快充，对比同价位常见 18W 约 1 小时；不提竞品品牌名，用数字说话。",
    },
  ];
  if (cat.includes("campus") || cat.includes("lifestyle"))
    directions.push({ title: "校园日常 Vlog", desc: "从上课、社团、宿舍到晚间出门，把 Hot 70 作为日常随身手机自然带入。" });
  if (cat.includes("skin") || cat.includes("beauty") || cat.includes("fashion"))
    directions.push({ title: "上镜外观 + 穿搭搭配", desc: "结合自拍、镜前展示或 outfit check，突出手机外观、配色和年轻感。" });
  if (cat.includes("tech"))
    directions.push({ title: "真实测试型内容", desc: "用简洁数据讲清楚充电速度、屏幕流畅度和日常使用体验，避免过度广告化。" });
  return directions;
}

export function buildBriefContent(k: Koc): BriefContent {
  const platform =
    k.platform === "instagram" ? "Instagram" : k.platform === "youtube" ? "YouTube" : "TikTok";
  const localAudience = localPct(k);
  const cityText =
    [k.city, k.school].filter(Boolean).join(" / ") || "Lagos & Ibadan campus audience";
  const kocLabel = k.name || k.username;
  const collabFee = Number(k.collabFee || k.price || 0);
  const targetPostDate = k.postDate || "待确认";
  const profileLink =
    k.url ||
    (k.username ? `https://www.tiktok.com/@${String(k.username).replace(/^@/, "")}` : "待补充");
  const category = catLabel(k.category || k.styleTag);
  const ksp = k.ksp || "Appearance + 45W fast charging";
  const tags = ["#BeSeenBeHot", "#infinixhot70series", "#InfinixHot70", "#InfinixNigeria"];
  if (String(k.category || "").toLowerCase().includes("campus")) tags.push("#CampusLife");

  return {
    title: `Infinix Hot 70 · ${kocLabel} 定制 Brief`,
    platform,
    kocLabel,
    profileLink,
    scoreLine: `${k.entryGrade || "待定"} · ${k.score ?? "-"} 分 · ${fmtNum(k.followers)} followers`,
    product: {
      name: "Infinix Hot 70",
      brand: "Infinix",
      sellingPoint: ksp,
      price: "₦189,700",
      purchaseChannel: "待填：Jumia / 官网 / 线下门店",
      targetAudience: `${cityText} · 18-25 岁年轻学生 / 校园人群`,
    },
    kocFit: {
      category,
      localAudience: localAudience
        ? `${localAudience}% Nigeria / Lagos-Ibadan audience`
        : "待核实本地受众占比",
      instagram:
        k.hasInstagram === "Yes" || k.hasInstagram === "yes"
          ? "同时运营 Instagram，可做二次传播"
          : "Instagram 二次传播待确认",
      source:
        k.recruitmentSource ||
        ({ self: "Self Apply", outreach: "Outreach", referral: "Referral" } as Record<string, string>)[
          k.source || ""
        ] ||
        "待确认",
    },
    contentDirections: getHot70ContentDirections(k),
    competitorLine:
      "Most phones at this price take 1 hour to charge — Hot 70 does it in 20 minutes. That's the difference between 18W and 45W fast charging.",
    contentFormats: ["开箱视频", "快充实测（计时对比）", "外观展示 + 配色", "校园日常 Vlog"],
    avoid: ["避免提及竞品品牌名", "避免纯念稿广告感", "避免只拍产品不讲使用场景"],
    terms: {
      collaboration: collabFee
        ? `付费合作：USD ${collabFee}`
        : "免费寄送 Infinix Hot 70 一台（留用）",
      deliverable: "持续发布视频，直至单条达到 20,000 播放量",
      firstPost:
        targetPostDate === "待确认" ? "收货后 3 天内发出第一条" : `计划首条发布：${targetPostDate}`,
      duration: "30-60 秒",
      review: k.script === "Yes" ? "按品牌脚本方向拍摄，可直接发布" : "无需逐条审核，可直接发布",
      requiredTags: tags,
    },
    specs: [
      "竖屏拍摄，9:16 比例",
      "画面清晰，光线充足，避免昏暗宿舍光",
      "建议真人出镜或手持展示，增强真实感",
      "字幕建议使用英文或本地混合语言，便于校园用户理解",
      "BGM 不使用敏感/侵权音源",
    ],
    submission: {
      afterPost: "每条发布后将视频链接发送给 Olu 确认",
      dataBack: "发布后第 3 天和第 7 天各截图一次播放/互动数据",
      contact: "Olu（WhatsApp 号码待填）",
      postLink: k.postLink || "发布后补充",
    },
  };
}

/** Brief → 纯文本（用于导出 / 复制）。 */
export function briefToText(b: Brief, k: Koc): string {
  const c = b.content;
  return `【${c.title}】
KOC：${c.kocLabel} | 账号：${k.username} | 平台：${c.platform}
主页：${c.profileLink}
评级：${c.scoreLine}

【产品信息】
产品名称：${c.product.name}
品牌：${c.product.brand}
核心卖点：${c.product.sellingPoint}
官方售价：${c.product.price}
购买渠道：${c.product.purchaseChannel}
目标人群：${c.product.targetAudience}

【KOC 匹配信息】
内容垂类：${c.kocFit.category}
本地受众：${c.kocFit.localAudience}
Instagram：${c.kocFit.instagram}
招募来源：${c.kocFit.source}

【内容方向】
${c.contentDirections.map((d, i) => `${i + 1}. ${d.title}\n   ${d.desc}`).join("\n")}

竞品对比话术参考：
${c.competitorLine}

推荐内容形式：${c.contentFormats.join(" / ")}
避免：${c.avoid.join(" / ")}

【合作条款】
合作形式：${c.terms.collaboration}
交付内容：${c.terms.deliverable}
首条发布：${c.terms.firstPost}
视频时长：${c.terms.duration}
审核流程：${c.terms.review}
必须标注：${c.terms.requiredTags.join(" ")}

【技术规范】
${c.specs.map((s) => `- ${s}`).join("\n")}

【发布 & 提交】
每条发布后：${c.submission.afterPost}
数据回传：${c.submission.dataBack}
项目对接人：${c.submission.contact}
发布链接：${c.submission.postLink}${b.script ? `\n\n【定制脚本】\n${b.script}` : ""}`;
}

/* ─────────────── AI 评判结果 → 指标覆盖 ─────────────── */
export function aiMetricsFromJudgment(
  metrics: Partial<Record<string, number>> | undefined
): Partial<Record<MetricKey, { value: number; note?: string }>> | undefined {
  if (!metrics) return undefined;
  const out: Partial<Record<MetricKey, { value: number; note?: string }>> = {};
  for (const key of METRIC_KEYS) {
    const v = metrics[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[key] = { value: v, note: "AI 评判" };
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/* ─────────────── 视频监测投流预警 ─────────────── */
export function shouldBoost(vm: VideoMonitor | undefined, threshold = 20000): boolean {
  return (vm?.views || 0) >= threshold;
}
export function vmEngRate(vm: VideoMonitor | undefined): string {
  const views = vm?.views || 0;
  if (views <= 0) return "-";
  const inter = (vm?.likes || 0) + (vm?.comments || 0) + (vm?.shares || 0);
  return ((inter / views) * 100).toFixed(1);
}
