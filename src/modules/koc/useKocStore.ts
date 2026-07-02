/**
 * useKocStore —— KOC 工作流的响应式状态 + 持久化 + Claude 驱动动作。
 *
 * 直面用户提的两个核心问题：
 *  1) 「只能执行这次、没记录、没上下文工程」→ 一切落 localStorage：
 *     kocData / trackingList / briefs / briefTemplate / videoMonitor / runs，
 *     且每个 KOC 有 events 事件日志、每次采集/评判有 ScreeningRun 记录。
 *  2) 「怎么判断是否符合标准、AI 跑了什么没跑」→ runAiJudge 给每个 KOC AI 定性评判，
 *     与数值分并列；onTool/onDelta 推到 console（左侧实时可见）；run-status 暴露。
 */
import { ref, computed } from "vue";
import { useAgentRunner } from "../../composables/useAgentRunner";
import type {
  Koc,
  Brief,
  BriefTemplate,
  VideoMonitor,
  ScreeningRun,
  ConsoleLine,
  CollectCriteria,
  KocEvent,
  AiJudgment,
  MetricKey,
} from "./types";
import { LS } from "./types";
import { applyScore, scoreKOC } from "./scoring";
import {
  lsLoad,
  lsSave,
  uid,
  buildBriefContent,
  aiMetricsFromJudgment,
} from "./kocUtils";
import { buildSeed } from "./seed";
import { promptCollect, promptJudge, promptScript, promptBriefExtract } from "./prompts";

const DEFAULT_BRIEF: BriefTemplate = {
  product: "Infinix Hot 70",
  ksp: "颜值设计 + 45W 超级快充",
  audience: "Lagos & Ibadan 在校大学生，18–25 岁",
  price: "₦189,700",
  collabForm: "免费寄送 Infinix Hot 70 一台（留用）",
  boostThreshold: 20000,
  contentReq: `• 外观颜值 — 拿出来有面子，设计好看，上镜
• 45W 快充对比 — Hot 70 充满只需 20 分钟，市面同价位手机需 1 小时（18W 水平）
• 竞品策略：不提竞品品牌名，只用数字对比
• 必须标注：@infinixnigeria · #BeSeenBeHot · #infinixhot70series
• 避免：提及竞品品牌名、纯念稿广告感`,
};

/** 深拷贝（优先 structuredClone，兜底 JSON），用于隔离嵌套引用。 */
function deepClone<T>(v: T): T {
  try {
    if (typeof structuredClone === "function") return structuredClone(v);
  } catch {
    /* fall through */
  }
  return JSON.parse(JSON.stringify(v)) as T;
}

let singleton: ReturnType<typeof create> | null = null;

function create() {
  const { running, run, runJson } = useAgentRunner();

  // ── 持久化状态 ──
  const kocData = ref<Koc[]>([]);
  const trackingList = ref<Koc[]>([]);
  const briefs = ref<Record<string, Brief>>({});
  const briefTemplate = ref<BriefTemplate>({ ...DEFAULT_BRIEF });
  const videoMonitor = ref<Record<string, VideoMonitor>>({});
  const runs = ref<ScreeningRun[]>([]);

  // ── 控制台 / run-status（「AI 跑了什么」surface）──
  const consoleLines = ref<ConsoleLine[]>([]);
  const runStatus = ref<string>("");
  const busy = computed(() => running.value);
  const selectedKocId = ref<string | null>(null);

  function log(kind: ConsoleLine["kind"], text: string) {
    consoleLines.value.push({ kind, text, at: Date.now() });
    if (consoleLines.value.length > 400) consoleLines.value.splice(0, consoleLines.value.length - 400);
  }
  function clearConsole() {
    consoleLines.value = [];
    runStatus.value = "";
  }

  // ── 初始化 / 持久化 ──
  function load() {
    kocData.value = lsLoad<Koc[]>(LS.kocData, []);
    trackingList.value = lsLoad<Koc[]>(LS.tracking, []);
    briefs.value = lsLoad<Record<string, Brief>>(LS.briefs, {});
    briefTemplate.value = lsLoad<BriefTemplate>(LS.briefTemplate, { ...DEFAULT_BRIEF });
    videoMonitor.value = lsLoad<Record<string, VideoMonitor>>(LS.videoMonitor, {});
    runs.value = lsLoad<ScreeningRun[]>(LS.runs, []);
    const seeded = lsLoad<boolean>(LS.seeded, false);
    if (!seeded && kocData.value.length === 0) {
      kocData.value = buildSeed();
      lsSave(LS.seeded, true);
      saveKoc();
    }
  }
  function saveKoc() {
    lsSave(LS.kocData, kocData.value);
  }
  function saveTracking() {
    lsSave(LS.tracking, trackingList.value);
  }
  function saveBriefs() {
    lsSave(LS.briefs, briefs.value);
  }
  function saveBriefTemplate() {
    lsSave(LS.briefTemplate, briefTemplate.value);
  }
  function saveVM() {
    lsSave(LS.videoMonitor, videoMonitor.value);
  }
  function saveRuns() {
    lsSave(LS.runs, runs.value);
  }

  // ── 事件日志 ──
  function addEvent(kocId: string, ev: Omit<KocEvent, "id" | "at">) {
    const k = kocData.value.find((x) => x.id === kocId);
    if (!k) return;
    if (!k.events) k.events = [];
    k.events.unshift({ id: uid("ev"), at: Date.now(), ...ev });
    saveKoc();
  }
  function addRun(run: Omit<ScreeningRun, "id" | "at">) {
    runs.value.unshift({ id: uid("run"), at: Date.now(), ...run });
    if (runs.value.length > 50) runs.value.length = 50;
    saveRuns();
  }

  // ── CRUD ──
  function addKoc(koc: Koc) {
    kocData.value.push(applyScore(koc));
    saveKoc();
  }
  function addManyKoc(list: Koc[]) {
    list.forEach((k) => kocData.value.push(applyScore(k)));
    saveKoc();
  }
  function removeKoc(id: string) {
    kocData.value = kocData.value.filter((k) => k.id !== id);
    saveKoc();
  }
  function rescore(id: string) {
    const k = kocData.value.find((x) => x.id === id);
    if (!k) return;
    const ov = aiMetricsFromJudgment(
      k.aiJudgment ? (k.aiJudgment as unknown as { metrics?: Record<string, number> }).metrics : undefined
    );
    Object.assign(k, scoreKOC(k, ov));
    saveKoc();
  }
  function rescoreAll() {
    kocData.value = kocData.value.map((k) => applyScore(k));
    saveKoc();
  }
  function resetSeed() {
    kocData.value = buildSeed();
    // 同时清空按 id 关联的派生集合，否则会残留指向已删除 KOC 的孤儿条目。
    trackingList.value = [];
    briefs.value = {};
    videoMonitor.value = {};
    lsSave(LS.seeded, true);
    saveKoc();
    saveTracking();
    saveBriefs();
    saveVM();
  }

  // 标签
  function toggleTag(id: string, tag: string) {
    const k = kocData.value.find((x) => x.id === id);
    if (!k) return;
    if (!Array.isArray(k.tags)) k.tags = [];
    if (k.tags.includes(tag)) k.tags = k.tags.filter((t) => t !== tag);
    else k.tags.push(tag);
    saveKoc();
  }
  function addTag(id: string, tag: string) {
    const k = kocData.value.find((x) => x.id === id);
    if (!k || !tag.trim()) return;
    if (!Array.isArray(k.tags)) k.tags = [];
    if (!k.tags.includes(tag)) k.tags.push(tag);
    saveKoc();
  }
  function removeTag(id: string, tag: string) {
    const k = kocData.value.find((x) => x.id === id);
    if (!k || !Array.isArray(k.tags)) return;
    k.tags = k.tags.filter((t) => t !== tag);
    saveKoc();
  }

  // 脚本（持久化 —— 修复 reload 丢失）
  function saveScript(id: string, script: string) {
    const k = kocData.value.find((x) => x.id === id);
    if (!k) return;
    k.videoScript = script.trim();
    saveKoc();
    if (briefs.value[id]) {
      briefs.value[id].script = k.videoScript;
      saveBriefs();
    }
  }

  // ── Tracking ──
  function addToTracking(id: string): boolean {
    const k = kocData.value.find((x) => x.id === id);
    if (!k) return false;
    if (trackingList.value.find((t) => t.id === id)) return false;
    // 深拷贝：浅拷贝会共享 events/tags/scoring 等嵌套引用，导致 screening 与 tracking 互相串改。
    trackingList.value.push(deepClone(k));
    saveTracking();
    addEvent(id, { kind: "tracking", title: "加入 Tracking List" });
    return true;
  }
  function removeFromTracking(id: string) {
    trackingList.value = trackingList.value.filter((t) => t.id !== id);
    saveTracking();
  }
  function updateTrackingField(id: string, field: keyof Koc, value: unknown) {
    const entry = trackingList.value.find((t) => t.id === id);
    if (entry) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (entry as any)[field] = value;
      saveTracking();
    }
  }

  // 视频监测
  function updateVM(id: string, field: keyof VideoMonitor, value: unknown) {
    if (!videoMonitor.value[id]) videoMonitor.value[id] = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (videoMonitor.value[id] as any)[field] = value;
    videoMonitor.value[id].updatedAt = new Date().toLocaleDateString("zh-CN");
    saveVM();
  }

  // ── Brief ──
  function setBriefTemplate(t: BriefTemplate) {
    briefTemplate.value = { ...t };
    saveBriefTemplate();
  }
  function generateBrief(id: string): Brief | null {
    const k = kocData.value.find((x) => x.id === id);
    if (!k) return null;
    const brief: Brief = {
      kocId: id,
      content: buildBriefContent(k),
      script: k.videoScript || briefs.value[id]?.script,
      at: Date.now(),
    };
    briefs.value = { ...briefs.value, [id]: brief };
    saveBriefs();
    addEvent(id, { kind: "brief", title: "生成结构化 Brief" });
    return brief;
  }
  function generateAllBriefs(): number {
    const targets = kocData.value.filter((k) => k.status !== "fail");
    targets.forEach((k) => generateBrief(k.id));
    return targets.length;
  }
  function deleteBrief(id: string) {
    const next = { ...briefs.value };
    delete next[id];
    briefs.value = next;
    saveBriefs();
  }

  // ════════════════ Claude 驱动动作 ════════════════

  /** 流式回调：把 delta/tool 推到控制台。 */
  function makeCallbacks(toolSink?: ScreeningRun["tools"]) {
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

  /** (a) Claude 采集候选 KOC。 */
  async function runCollect(cr: CollectCriteria): Promise<number> {
    clearConsole();
    runStatus.value = "采集中…";
    log("info", `🚀 开始 Claude 采集：关键词「${cr.keywords.join("、") || "(空)"}」，目标 ${cr.limit} 个`);
    const toolSink: ScreeningRun["tools"] = [];
    try {
      const { data } = await runJson<{ kocs: Partial<Koc>[] }>({
        prompt: promptCollect(cr, briefTemplate.value),
        goal: `采集 ${cr.limit} 个符合条件的 KOC 账号并返回结构化 JSON`,
        useKb: false,
        ...makeCallbacks(toolSink),
      });
      const list = Array.isArray(data?.kocs) ? data.kocs : [];
      const newKocs: Koc[] = list.slice(0, cr.limit).map((c) => {
        const koc: Koc = {
          id: uid("ai"),
          platform: (c.platform as Koc["platform"]) || "tiktok",
          name: c.name || c.username || "未知账号",
          username: (c.username || "").replace(/^@/, ""),
          url: c.url || (c.username ? `https://www.tiktok.com/@${c.username}` : ""),
          followers: Number(c.followers) || 0,
          avgViews: Number(c.avgViews) || 0,
          engagementRate: Number(c.engagementRate) || 0,
          bio: c.bio || "",
          region: c.region || "",
          city: c.city || cr.geo || "",
          language: c.language || cr.lang || "",
          category: c.category || cr.category || "",
          nigeriaLocalAudience: c.nigeriaLocalAudience || 0,
          tags: [],
          manualRisks: [],
          source_type: "ai-collect",
          addedAt: new Date().toISOString(),
          events: [
            { id: uid("ev"), kind: "imported", title: "Claude 采集导入", at: Date.now() },
          ],
        };
        return applyScore(koc);
      });
      newKocs.forEach((k) => kocData.value.push(k));
      saveKoc();
      addRun({
        kind: "collect",
        inputSummary: `关键词「${cr.keywords.join("、")}」 粉丝≥${cr.minFollowers} 播放≥${cr.minViews} 目标${cr.limit}`,
        resultSummary: `采集到 ${newKocs.length} 个 KOC`,
        tools: toolSink,
        kocIds: newKocs.map((k) => k.id),
      });
      runStatus.value = `✅ 采集完成，新增 ${newKocs.length} 个`;
      log("ok", runStatus.value);
      return newKocs.length;
    } catch (e) {
      runStatus.value = `❌ 采集失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return 0;
    }
  }

  /** AI 定性评判单个 KOC（与数值分并列）。 */
  async function runAiJudge(id: string): Promise<AiJudgment | null> {
    const k = kocData.value.find((x) => x.id === id);
    if (!k) return null;
    runStatus.value = `评判 @${k.username}…`;
    log("info", `🤖 AI 评判 @${k.username}`);
    const toolSink: ScreeningRun["tools"] = [];
    try {
      const { data } = await runJson<{
        verdict: string;
        reasoning: string;
        risks?: string[];
        fitScore?: number;
        metrics?: Record<string, number>;
      }>({
        prompt: promptJudge(k, briefTemplate.value),
        useKb: false,
        ...makeCallbacks(toolSink),
      });
      // 长时 await 期间「删除」仍可用：若该 KOC 已被删，丢弃结果，不写入已脱管对象、不误报成功。
      if (!kocData.value.some((x) => x.id === id)) {
        runStatus.value = `⚠️ @${k.username} 评判完成但账号已被删除，结果已丢弃`;
        log("info", runStatus.value);
        return null;
      }
      const judgment: AiJudgment = {
        verdict: data.verdict || "C",
        reasoning: data.reasoning || "",
        risks: Array.isArray(data.risks) ? data.risks : [],
        fitScore: typeof data.fitScore === "number" ? data.fitScore : undefined,
        at: Date.now(),
      };
      k.aiJudgment = judgment;
      // 把 AI 给的维度分作为 provenance=ai 的覆盖重新评分
      const overrides = aiMetricsFromJudgment(data.metrics) as
        | Partial<Record<MetricKey, { value: number; note?: string }>>
        | undefined;
      // 把 metrics 暂存进 aiJudgment 以便 rescore 复用
      (k.aiJudgment as unknown as { metrics?: Record<string, number> }).metrics = data.metrics;
      Object.assign(k, scoreKOC(k, overrides));
      saveKoc();
      addEvent(id, {
        kind: "ai-judge",
        title: `AI 评判 → ${judgment.verdict}`,
        output: judgment.reasoning.slice(0, 200),
      });
      addRun({
        kind: "judge",
        inputSummary: `@${k.username}`,
        resultSummary: `AI: ${judgment.verdict}${judgment.fitScore != null ? ` · ${judgment.fitScore}分` : ""}`,
        tools: toolSink,
        kocIds: [id],
      });
      runStatus.value = `✅ @${k.username} → ${judgment.verdict}`;
      log("ok", runStatus.value);
      return judgment;
    } catch (e) {
      runStatus.value = `❌ 评判失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return null;
    }
  }

  /** 生成脚本（runJson 不适用，用 run 取全文）→ 自动落库。 */
  async function runScript(id: string): Promise<string | null> {
    const k = kocData.value.find((x) => x.id === id);
    if (!k) return null;
    runStatus.value = `生成脚本 @${k.username}…`;
    log("info", `📝 生成脚本 @${k.username}`);
    const toolSink: ScreeningRun["tools"] = [];
    try {
      const res = await run({
        prompt: promptScript(k, briefTemplate.value),
        useKb: false,
        ...makeCallbacks(toolSink),
      });
      const script = res.raw.trim();
      // 生成期间该 KOC 若被删除：丢弃结果，避免写入已脱管对象并误报成功。
      if (!kocData.value.some((x) => x.id === id)) {
        runStatus.value = `⚠️ @${k.username} 脚本已生成但账号已被删除，结果已丢弃`;
        log("info", runStatus.value);
        return null;
      }
      saveScript(id, script);
      if (!briefs.value[id]) generateBrief(id);
      else {
        briefs.value[id].script = script;
        saveBriefs();
      }
      addEvent(id, { kind: "script", title: "生成定制脚本", output: script.slice(0, 200) });
      runStatus.value = `✅ @${k.username} 脚本已生成并保存`;
      log("ok", runStatus.value);
      return script;
    } catch (e) {
      runStatus.value = `❌ 脚本生成失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return null;
    }
  }

  /** 从上传/粘贴的 brief 文档抽取字段。 */
  async function runBriefExtract(docText: string): Promise<BriefTemplate | null> {
    runStatus.value = "解析 Brief 文档…";
    log("info", "📄 Claude 解析 Brief 文档");
    try {
      const { data } = await runJson<Partial<BriefTemplate>>({
        prompt: promptBriefExtract(docText),
        useKb: false,
        ...makeCallbacks(),
      });
      const t: BriefTemplate = {
        product: data.product || briefTemplate.value.product,
        ksp: data.ksp || briefTemplate.value.ksp,
        audience: data.audience || briefTemplate.value.audience,
        price: data.price || briefTemplate.value.price,
        collabForm: data.collabForm || briefTemplate.value.collabForm,
        boostThreshold: Number(data.boostThreshold) || 20000,
        contentReq: data.contentReq || briefTemplate.value.contentReq,
      };
      setBriefTemplate(t);
      runStatus.value = "✅ 已从文档抽取并填入 Brief";
      log("ok", runStatus.value);
      return t;
    } catch (e) {
      runStatus.value = `❌ 解析失败：${(e as Error).message}`;
      log("error", runStatus.value);
      return null;
    }
  }

  load();

  return {
    // state
    kocData,
    trackingList,
    briefs,
    briefTemplate,
    videoMonitor,
    runs,
    consoleLines,
    runStatus,
    busy,
    selectedKocId,
    // console
    log,
    clearConsole,
    // crud
    addKoc,
    addManyKoc,
    removeKoc,
    rescore,
    rescoreAll,
    resetSeed,
    toggleTag,
    addTag,
    removeTag,
    saveScript,
    addEvent,
    // tracking
    addToTracking,
    removeFromTracking,
    updateTrackingField,
    updateVM,
    // brief
    setBriefTemplate,
    generateBrief,
    generateAllBriefs,
    deleteBrief,
    // claude
    runCollect,
    runAiJudge,
    runScript,
    runBriefExtract,
  };
}

export function useKocStore() {
  if (!singleton) singleton = create();
  return singleton;
}
