<script setup lang="ts">
/**
 * 竞品分析 Agent —— 两种互斥拆解模式（A 增长标杆 / B 危机诊断）。
 *
 * 后端唯一大脑 = Claude Code（useAgentRunner）。原版「回答得不行」根因是单次
 * gemini-flash 塞全部活儿；这里换成真·三段流水线（research → reason → finalize），
 * 复用同一 conversationId 串起来，节点动画由真实阶段切换驱动，工具调用/增量流式可见。
 *
 * 仅新增本模块文件，不改任何既有文件。主题全部走 style.css 的 CSS 变量。
 */
import { computed, onMounted, reactive, ref } from "vue";
import { useAgentRunner } from "../../composables/useAgentRunner";
import { sanitizeHtml } from "../../lib/sanitize";
import LineChart from "./LineChart.vue";
import { DEMO_A, DEMO_B } from "./demo";
import {
  researchPromptA,
  reasonPromptA,
  finalizePromptA,
  researchPromptB,
  reasonPromptB,
  finalizePromptB,
} from "./prompts";
import type {
  Mode,
  ModeAData,
  ModeBData,
  PipelineNode,
  Stage,
  LogLine,
  PersistedRun,
  ConfTag,
} from "./types";

/* ────────────────────────── 持久化键 ────────────────────────── */
const LS_RUN = "chuanying.competitive.lastRun";
const LS_MODE = "chuanying.competitive.mode";

const { running, run, runJson } = useAgentRunner();

/* ────────────────────────── 状态 ────────────────────────── */
const mode = ref<Mode>("A");
const company = ref("");
const product = ref("");

const stage = ref<Stage>("idle");
const errMsg = ref("");
const isDemo = ref(false); // 当前右侧展示的是否为样例

const dataA = ref<ModeAData | null>(null);
const dataB = ref<ModeBData | null>(null);

const logLines = ref<LogLine[]>([]);
const bTab = ref(0);

/* 节点条：A 4 节点 / B 4 节点（与原版一致；finalize 复用最后一个节点收尾）。 */
const NODE_DEFS: Record<Mode, Array<[string, string, string]>> = {
  A: [
    ["💰", "财报投入", "S&M剥离"],
    ["🎯", "PMKT链路", "痛点→研发"],
    ["📦", "产品包装", "JTBD排序"],
    ["📡", "IMC宣发", "AICP漏斗"],
  ],
  B: [
    ["📉", "市占趋势", "份额拐点"],
    ["💎", "高端困局", "价格段夹击"],
    ["🎤", "场景战场", "路线对比"],
    ["🔥", "危机时间轴", "烈度诊断"],
  ],
};
const nodes = reactive<PipelineNode[]>([]);
function rebuildNodes() {
  nodes.splice(0, nodes.length, ...NODE_DEFS[mode.value].map(([ico, nm, meta]) => ({ ico, nm, meta, state: "" as const })));
}

const CHIPS: Record<Mode, Array<[string, string, string]>> = {
  A: [
    ["安克创新 Anker", "Nano 充电器", "安克 × Nano"],
    ["传音控股 Transsion", "Tecno 手机", "传音 Tecno"],
    ["绿联 UGREEN", "", "绿联 UGREEN"],
    ["大疆 DJI", "", "大疆 DJI"],
  ],
  B: [
    ["OPPO", "", "OPPO"],
    ["小米 汽车", "SU7", "小米汽车 SU7"],
    ["极氪 ZEEKR", "", "极氪 ZEEKR"],
    ["vivo", "", "vivo"],
  ],
};
const chips = computed(() => CHIPS[mode.value]);

/* ────────────────────────── 派生 ────────────────────────── */
const curA = computed(() => (mode.value === "A" ? dataA.value ?? DEMO_A : null));
const curB = computed(() => (mode.value === "B" ? dataB.value ?? DEMO_B : null));
const showEmptyDemo = computed(() => (mode.value === "A" ? !dataA.value : !dataB.value));
const flowStatusText = computed(() => {
  switch (stage.value) {
    case "research": return "检索取证…";
    case "reason": return "分析推理…";
    case "finalize": return "生成结构化报告…";
    case "done": return "✓ 完成";
    case "error": return "✗ 出错";
    default: return "待命";
  }
});

const bTabLabels = ["📉 市占趋势", "💎 高端化困局", "🎤 场景战场", "⚔️ 竞品对决", "🔥 危机拆解"];

/* ────────────────────────── 工具方法 ────────────────────────── */
const S = (h?: string) => sanitizeHtml(h ?? "");

function tagLabel(t?: ConfTag): string {
  return t === "ok" ? "✓ 确认" : t === "est" ? "~ 估算" : t === "待补充" ? "待补充" : "";
}
function maxPct(arr: { pct: number }[]): number {
  return Math.max(1, ...arr.map((c) => c.pct || 0));
}

function setMode(m: Mode) {
  if (running.value) return;
  mode.value = m;
  bTab.value = 0;
  rebuildNodes();
  try { localStorage.setItem(LS_MODE, m); } catch { /* ignore */ }
}
function fill(c: string, p: string) {
  if (running.value) return;
  company.value = c;
  product.value = p;
}
function log(kind: LogLine["kind"], text: string) {
  logLines.value.push({ kind, text, at: Date.now() });
  if (logLines.value.length > 400) logLines.value.splice(0, logLines.value.length - 400);
}
function setNode(i: number, state: PipelineNode["state"]) {
  if (nodes[i]) nodes[i].state = state;
}
/** 把整条节点条推进到「截至 i 全 done、第 i 个 active」。 */
function advanceNodes(activeIdx: number) {
  nodes.forEach((n, i) => (n.state = i < activeIdx ? "done" : i === activeIdx ? "active" : ""));
}

/* ────────────────────────── 流式回调 ────────────────────────── */
let deltaBuf = "";
function onDelta(text: string) {
  deltaBuf += text;
  // 攒到换行/标点再落一行日志，避免逐字刷屏。
  const idx = deltaBuf.lastIndexOf("\n");
  if (idx >= 0) {
    const chunk = deltaBuf.slice(0, idx).trim();
    deltaBuf = deltaBuf.slice(idx + 1);
    if (chunk) chunk.split("\n").forEach((l) => l.trim() && log("text", l.trim()));
  } else if (deltaBuf.length > 160) {
    log("text", deltaBuf.trim());
    deltaBuf = "";
  }
}
function flushDelta() {
  if (deltaBuf.trim()) log("text", deltaBuf.trim());
  deltaBuf = "";
}
function onTool(tool: string, detail?: string) {
  log("tool", detail ? `${tool} · ${detail}` : tool);
}

/* ────────────────────────── 三段流水线 ────────────────────────── */
async function runPipeline() {
  const c = company.value.trim();
  if (!c) { errMsg.value = "请先输入竞品公司"; return; }
  errMsg.value = "";
  isDemo.value = false;
  logLines.value = [];
  deltaBuf = "";
  rebuildNodes();

  const goal =
    mode.value === "A"
      ? `产出「${c}」的增长标杆全链路营销拆解（财报投入/PMKT/产品包装JTBD/IMC漏斗），数据带引用。`
      : `产出「${c}」的危机诊断拆解（市占/高端困局/场景战场/竞品对决/危机时间轴），数据带引用。`;

  try {
    /* Stage 1 — research */
    stage.value = "research";
    advanceNodes(0);
    log("stage", "▸ 阶段 1/3 · 检索取证");
    const r1 = await run({
      prompt: mode.value === "A" ? researchPromptA(c, product.value.trim()) : researchPromptB(c),
      goal,
      onDelta: (t) => onDelta(t),
      onTool,
    });
    flushDelta();
    const convId = r1.convId;

    /* Stage 2 — reason */
    stage.value = "reason";
    advanceNodes(mode.value === "A" ? 1 : 1);
    setNode(0, "done");
    log("stage", "▸ 阶段 2/3 · 分析推理");
    await run({
      prompt: mode.value === "A" ? reasonPromptA(c) : reasonPromptB(c),
      conversationId: convId,
      onDelta: (t) => onDelta(t),
      onTool,
    });
    flushDelta();
    // 中段两节点也点亮
    setNode(1, "done");
    setNode(2, "active");

    /* Stage 3 — finalize（严格 JSON） */
    stage.value = "finalize";
    log("stage", "▸ 阶段 3/3 · 生成结构化报告");
    if (mode.value === "A") {
      const { data } = await runJson<ModeAData>({
        prompt: finalizePromptA(c, product.value.trim()),
        conversationId: convId,
        onTool,
      });
      dataA.value = data;
    } else {
      const { data } = await runJson<ModeBData>({
        prompt: finalizePromptB(c),
        conversationId: convId,
        onTool,
      });
      dataB.value = data;
      bTab.value = 0;
    }
    nodes.forEach((n) => (n.state = "done"));
    stage.value = "done";
    log("stage", "✓ 完成");
    persist();
  } catch (e: unknown) {
    flushDelta();
    stage.value = "error";
    const msg = e instanceof Error ? e.message : String(e);
    errMsg.value = "拆解失败：" + msg;
    log("stage", "✗ " + msg);
  }
}

/* ────────────────────────── 持久化 ────────────────────────── */
function persist() {
  try {
    // 读回既有记录，保留另一模式的输入槽（本次只覆盖当前模式那一份）。
    let prev: Partial<PersistedRun> = {};
    try { prev = JSON.parse(localStorage.getItem(LS_RUN) || "{}") as Partial<PersistedRun>; } catch { /* ignore */ }
    const rec: PersistedRun = {
      mode: mode.value,
      company: company.value,
      product: product.value,
      companyA: mode.value === "A" ? company.value : prev.companyA,
      productA: mode.value === "A" ? product.value : prev.productA,
      companyB: mode.value === "B" ? company.value : prev.companyB,
      productB: mode.value === "B" ? product.value : prev.productB,
      dataA: dataA.value ?? undefined,
      dataB: dataB.value ?? undefined,
      at: Date.now(),
    };
    localStorage.setItem(LS_RUN, JSON.stringify(rec));
  } catch { /* ignore quota */ }
}
function restore() {
  try {
    const m = localStorage.getItem(LS_MODE) as Mode | null;
    if (m === "A" || m === "B") mode.value = m;
    const raw = localStorage.getItem(LS_RUN);
    if (raw) {
      const rec = JSON.parse(raw) as PersistedRun;
      // 按当前模式取对应输入槽；旧记录（无分模式槽）仅在其模式与当前一致时迁移。
      const hasPerMode =
        rec.companyA !== undefined || rec.companyB !== undefined ||
        rec.productA !== undefined || rec.productB !== undefined;
      if (hasPerMode) {
        company.value = (mode.value === "A" ? rec.companyA : rec.companyB) ?? "";
        product.value = (mode.value === "A" ? rec.productA : rec.productB) ?? "";
      } else if (rec.mode === mode.value) {
        company.value = rec.company || "";
        product.value = rec.product || "";
      }
      if (rec.dataA) dataA.value = rec.dataA;
      if (rec.dataB) dataB.value = rec.dataB;
      if (rec.dataA || rec.dataB) stage.value = "done";
    }
  } catch { /* ignore */ }
  rebuildNodes();
}

onMounted(restore);
</script>

<template>
  <div class="cw">
   <div class="wrap">
    <!-- ═══════════ header ═══════════ -->
    <div class="hdr">
      <div class="logo">◆</div>
      <div>
        <h1>竞品分析 Agent</h1>
        <div class="sub">两种拆解思路 · 增长标杆 / 危机诊断</div>
      </div>
    </div>

    <!-- mode toggle -->
    <div class="modes">
      <div class="mode" :class="{ on: mode === 'A' }" @click="!running && setMode('A')">
        <div class="mt">📈 增长标杆拆解</div>
        <div class="md">回答「怎么赢的」· 财报投入 → PMKT → 产品包装JTBD → IMC漏斗</div>
      </div>
      <div class="mode" :class="{ on: mode === 'B' }" @click="!running && setMode('B')">
        <div class="mt">🔥 危机诊断拆解</div>
        <div class="md">回答「为何困」· 市占趋势 → 高端困局 → 场景战场 → 竞品对决 → 危机时间轴</div>
      </div>
    </div>

    <!-- input panel -->
    <div class="panel">
      <div class="row">
        <div class="field">
          <label>竞品公司</label>
          <input
            v-model="company"
            :disabled="running"
            :placeholder="mode === 'A' ? '例如：安克创新 Anker' : '例如：OPPO'"
            @keydown.enter="runPipeline"
          />
        </div>
        <div v-if="mode === 'A'" class="field sm">
          <label>具体产品（可选）</label>
          <input v-model="product" :disabled="running" placeholder="例如：Nano 充电器" @keydown.enter="runPipeline" />
        </div>
        <button class="btn" :disabled="running || !company.trim()" @click="runPipeline">
          {{ running ? "拆解中…" : "▶ 开始拆解" }}
        </button>
      </div>
      <div class="chips">
        <span v-for="(c, i) in chips" :key="i" class="chip" @click="fill(c[0], c[1])">{{ c[2] }}</span>
      </div>
    </div>

    <!-- pipeline strip -->
    <div class="flow" :class="{ show: stage !== 'idle' }">
      <div class="flow-title"><span>ANALYSIS PIPELINE</span><span>{{ flowStatusText }}</span></div>
      <div class="nodes">
        <template v-for="(n, i) in nodes" :key="i">
          <div v-if="i" class="arrow">→</div>
          <div class="node" :class="n.state">
            <span class="st">{{ n.state === 'done' ? '✓' : i + 1 }}</span>
            <span class="ico">{{ n.ico }}</span>
            <div class="nm">{{ n.nm }}</div>
            <div class="meta">{{ n.meta }}</div>
          </div>
        </template>
      </div>
    </div>

    <div v-if="errMsg" class="errbox show">{{ errMsg }}</div>
    <div v-if="isDemo || showEmptyDemo" class="demo-banner show">
      ⚠️ 当前为{{ mode === 'A' ? ' Anker ' : ' OPPO ' }}样例。输入公司点「开始拆解」即用 Claude Code 实时多阶段分析任意公司。
    </div>

    <!-- ===== Mode A ===== -->
    <div v-if="mode === 'A' && curA" class="result show">
        <!-- 01 财报投入 -->
        <section class="chapter">
          <div class="ch-head"><span class="ch-num">01</span><h2>财报投入</h2><span class="en">FINANCIAL FOUNDATION</span></div>
          <div class="lead" v-html="S(curA.ch1?.lead)" />
          <div class="kpis">
            <div v-for="(x, i) in curA.ch1?.kpis || []" :key="i" class="kpi">
              <span v-if="x.tag" class="tag" :class="x.tag">{{ tagLabel(x.tag) }}</span>
              <div class="v" :class="x.cls">{{ x.v }}</div>
              <div class="k">{{ x.k }}</div>
              <div class="d">{{ x.d }}</div>
            </div>
          </div>
          <table class="tbl">
            <thead><tr><th>费用项</th><th>金额</th><th>占销售费用</th><th>依据</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in curA.ch1?.rows || []" :key="i" :class="{ total: r.tag === 'total' }">
                <td>
                  {{ r.item }}
                  <span v-if="r.tag === 'ok'" class="il-tag tag ok">✓确认</span>
                  <span v-else-if="r.tag === 'est'" class="il-tag tag est">~估算</span>
                </td>
                <td class="num">{{ r.amt }}</td>
                <td>{{ r.pct }}</td>
                <td class="src">{{ r.src }}</td>
              </tr>
            </tbody>
          </table>
          <div class="signal" v-html="S(curA.ch1?.signal)" />
        </section>

        <!-- 02 PMKT -->
        <section class="chapter">
          <div class="ch-head"><span class="ch-num">02</span><h2>PMKT 策略</h2><span class="en">PAIN-DRIVEN PIPELINE</span></div>
          <div class="lead" v-html="S(curA.ch2?.lead)" />
          <div class="split">
            <div class="theory">
              <h4>{{ curA.ch2?.theory?.title }}</h4>
              <div v-html="S(curA.ch2?.theory?.body)" />
            </div>
            <div class="prodlist">
              <div v-for="(p, i) in curA.ch2?.products || []" :key="i" class="prod">
                <span class="pi">{{ p.ico || '•' }}</span>
                <div><div class="pn">{{ p.name }}</div><div class="pp">{{ p.pain }}</div></div>
                <span class="pb" :class="p.bcls || 'b'">{{ p.badge }}</span>
              </div>
            </div>
          </div>
          <div class="steps">
            <div v-for="(s, i) in curA.ch2?.steps || []" :key="i" class="step">
              <span class="dot">✓</span>
              <div class="en">{{ s.en }}</div>
              <h4>{{ s.title }}</h4>
              <p v-html="S(s.desc)" />
              <div class="tags"><span v-for="(t, j) in s.tags || []" :key="j">{{ t }}</span></div>
            </div>
          </div>
        </section>

        <!-- 03 JTBD -->
        <section class="chapter">
          <div class="ch-head"><span class="ch-num">03</span><h2>产品包装 × JTBD</h2><span class="en">SELLING-POINT ORDERING</span></div>
          <div class="lead" v-html="S(curA.ch3?.lead)" />
          <div class="jtbd-def" v-html="S(curA.ch3?.def)" />
          <div v-for="(s, i) in curA.ch3?.sellpoints || []" :key="i" class="sp">
            <div class="rank">{{ s.rank }}</div>
            <div>
              <div class="layer">{{ s.layer }}</div>
              <h4>{{ s.headline }}</h4>
              <div class="job">{{ s.job }}</div>
              <div class="why" v-html="S(s.why)" />
              <div v-if="s.voc" class="voc">{{ s.voc }}</div>
            </div>
          </div>
          <div class="decpath">
            <div v-for="(p, i) in curA.ch3?.path || []" :key="i" class="dp">
              <div class="stage">{{ p.stage }}</div>
              <div class="q">"{{ p.q }}"</div>
              <div class="a">{{ p.a }}</div>
            </div>
          </div>
        </section>

        <!-- 04 IMC -->
        <section class="chapter">
          <div class="ch-head"><span class="ch-num">04</span><h2>IMC × AICP</h2><span class="en">INTEGRATED FUNNEL</span></div>
          <div class="lead" v-html="S(curA.ch4?.lead)" />
          <div class="funnel">
            <div v-for="(f, i) in curA.ch4?.funnel || []" :key="i" class="fn" :class="'fn' + (i + 1)">
              <div class="stg">{{ f.stg }}</div>
              <div class="en">{{ f.en }}</div>
              <div class="pct">{{ f.pct }}</div>
              <div class="bud">{{ f.bud }}</div>
            </div>
          </div>
          <div v-for="(x, i) in curA.ch4?.detail || []" :key="'d' + i" class="fnd">
            <span class="lbl">{{ x.lbl }}</span>&#12288;<span v-html="S(x.text)" />
          </div>
          <div class="channels">
            <div v-for="(c, i) in curA.ch4?.channels || []" :key="'c' + i" class="chrow">
              <span class="cn">{{ c.name }}</span>
              <span class="bar"><i :style="{ width: (c.pct / maxPct(curA!.ch4!.channels!)) * 100 + '%' }" /></span>
              <span class="cp">~{{ c.pct }}%</span>
            </div>
          </div>
          <div class="weak">
            <h4>⚠ {{ curA.ch4?.weak?.title }}</h4>
            <div v-html="S(curA.ch4?.weak?.text)" />
          </div>
        </section>

        <div class="foot">{{ curA.foot }}</div>
      </div>

    <!-- ===== Mode B ===== -->
    <div v-else-if="mode === 'B' && curB" class="result show">
        <div class="ch-head"><span class="ch-num">⚑</span><h2>{{ curB.title }}</h2><span class="en">{{ curB.subtitle }}</span></div>
        <div class="tabbar">
          <button v-for="(t, i) in bTabLabels" :key="i" class="tab" :class="{ on: bTab === i }" @click="bTab = i">{{ t }}</button>
        </div>

        <!-- T1 市占趋势 -->
        <div v-show="bTab === 0" class="tabpane">
          <div class="chart-card">
            <h3>{{ curB.t1_share?.title }}</h3>
            <div class="csub">{{ curB.t1_share?.subtitle }}</div>
            <span class="csrc">{{ curB.t1_share?.source }}</span>
            <LineChart
              v-if="curB.t1_share?.chart"
              :labels="curB.t1_share.chart.labels"
              :series="[{ name: '份额', color: '#1f9d57', data: curB.t1_share.chart.data, markers: curB.t1_share.chart.markers }]"
              unit="%"
            />
          </div>
          <div class="statcards">
            <div v-for="(s, i) in curB.t1_share?.stats || []" :key="i" class="statcard">
              <div class="sl">{{ s.label }}</div>
              <div class="sv" :class="s.cls">{{ s.value }}</div>
            </div>
          </div>
        </div>

        <!-- T2 高端化困局 -->
        <div v-show="bTab === 1" class="tabpane">
          <div class="chart-card">
            <h3>{{ curB.t2_premium?.title }}</h3>
            <div class="csub">{{ curB.t2_premium?.subtitle }}</div>
            <span class="csrc">{{ curB.t2_premium?.source }}</span>
            <LineChart
              v-if="curB.t2_premium?.chart"
              :labels="curB.t2_premium.chart.labels"
              :series="(curB.t2_premium.chart.series || []).map(s => ({ name: s.name, color: s.color || '#1f9d57', data: s.data }))"
              unit="%"
              :legend="true"
            />
          </div>
          <div class="infocards">
            <div v-for="(c, i) in curB.t2_premium?.cards || []" :key="i" class="info">
              <h4 :class="c.cls">{{ c.title }}</h4>
              <ul><li v-for="(it, j) in c.items || []" :key="j">{{ it }}</li></ul>
            </div>
          </div>
        </div>

        <!-- T3 场景战场 -->
        <div v-show="bTab === 2" class="tabpane">
          <div class="lead" v-html="S(curB.t3_scene?.lead)" />
          <div class="versus">
            <div v-for="(v, i) in [curB.t3_scene?.a, curB.t3_scene?.b].filter(Boolean)" :key="i" class="vs">
              <div class="vh"><span class="vn" :class="v!.ncls || 'b'">{{ v!.name }}</span><span class="vtag">{{ v!.tagline }}</span></div>
              <div v-for="(p, j) in v!.points || []" :key="j" class="vrow">
                <div class="vi">{{ p.ico }} {{ p.title }}</div>
                <div class="vs2">{{ p.sub }}</div>
              </div>
              <div class="verdict" :class="v!.verdict?.type || 'ok'">
                {{ v!.verdict?.type === 'ok' ? '✅' : '⚠️' }} {{ v!.verdict?.text }}
              </div>
            </div>
          </div>
          <div class="lead" style="margin-top:6px" v-html="S(curB.t3_scene?.poslead)" />
          <div class="versus">
            <div v-for="(v, i) in [curB.t3_scene?.posA, curB.t3_scene?.posB].filter(Boolean)" :key="i" class="vs">
              <div class="vh"><span class="vn" :class="v!.ncls || 'b'">{{ v!.name }}</span><span class="vtag">{{ v!.since }}</span></div>
              <div v-for="(it, j) in v!.items || []" :key="j" class="vrow"><div class="vs2">· {{ it }}</div></div>
              <div class="verdict" :class="v!.vtype || 'ok'">
                {{ v!.slogan }}&#12288;<span style="opacity:.7;font-weight:400">{{ v!.sub }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- T4 竞品对决 -->
        <div v-show="bTab === 3" class="tabpane">
          <div class="lead" v-html="S(curB.t4_duel?.lead)" />
          <div class="duel">
            <div v-for="(d, i) in [['win', curB.t4_duel?.sideA], ['lose', curB.t4_duel?.sideB]].filter(x => x[1])" :key="i" class="duelcol" :class="d[0] as string">
              <h4>{{ d[0] === 'win' ? '🏆' : '💡' }} {{ (d[1] as any).name }}</h4>
              <div v-for="(r, j) in (d[1] as any).rows || []" :key="j" class="duelrow"><b>{{ r.label }}：</b>{{ r.text }}</div>
            </div>
          </div>
          <div class="essence">
            <h4>🔑 {{ curB.t4_duel?.essence?.title || '本质差距' }}</h4>
            <div v-for="(r, i) in curB.t4_duel?.essence?.rows || []" :key="i" class="er">{{ r }}</div>
          </div>
        </div>

        <!-- T5 危机拆解 -->
        <div v-show="bTab === 4" class="tabpane">
          <div class="lead" v-html="S(curB.t5_crisis?.lead)" />
          <div class="crisis">
            <div v-for="(e, i) in curB.t5_crisis?.events || []" :key="i" class="cev">
              <div class="score" :class="e.cls">{{ e.score }}</div>
              <div class="cmid">
                <div class="cnm">{{ e.name }}</div>
                <div class="cdate">{{ e.date }}</div>
                <div class="cbar" :class="e.cls" :style="{ width: e.score * 10 + '%' }" />
              </div>
              <div class="ctype">{{ e.type }}</div>
            </div>
          </div>
          <div class="weak">
            <h4>🔥 总结</h4>
            <div v-html="S(curB.t5_crisis?.conclusion)" />
          </div>
        </div>

      <div class="foot">{{ curB.foot }}</div>
    </div>
   </div>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════════════════════
   1:1 克隆自桌面模板「Competitive product analysis Agent.html」。
   模板自带配色硬编码到根 .cw 上（同时覆盖 LineChart 用到的 token），
   单栏从上到下布局；后端仍走 Claude（useAgentRunner）。
   ═══════════════════════════════════════════════════════════════ */
.cw {
  --bg: #f5f6f8;
  --surface: #ffffff;
  --surface2: #f4f6f8;
  --border: #e5e7ec;
  --border-soft: #eef0f3;
  --ink: #1a1d24;
  --muted: #6b7280;
  --faint: #9aa0aa;
  --dim: #9aa0aa;
  --panel: #ffffff;
  --red: #e5484d;
  --amber: #c2790a;
  --blue: #3666cc;
  --green: #1f9d57;
  --purple: #7c5cdb;
  --mono: "SFMono-Regular", "Consolas", "JetBrains Mono", monospace;
  --font: "Microsoft YaHei", "PingFang SC", "Helvetica Neue", sans-serif;

  height: 100%;
  min-height: 0;
  overflow-y: auto;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font);
  line-height: 1.65;
  padding: 24px 18px;
}
.cw * { box-sizing: border-box; margin: 0; padding: 0; }
.wrap { max-width: 1080px; margin: 0 auto; }

.hdr { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.logo {
  width: 38px; height: 38px; border-radius: 9px;
  background: linear-gradient(135deg, #e5484d, #b3343a);
  display: flex; align-items: center; justify-content: center; color: #fff; font-size: 18px;
}
.hdr h1 { font-size: 18px; font-weight: 800; }
.hdr .sub { font-size: 12px; color: var(--muted); }

/* mode toggle */
.modes { display: flex; gap: 10px; margin-bottom: 16px; }
.mode {
  flex: 1; background: var(--surface); border: 1.5px solid var(--border);
  border-radius: 12px; padding: 14px 16px; cursor: pointer; transition: 0.15s;
}
.mode.on { border-color: var(--red); box-shadow: 0 0 0 3px rgba(229, 72, 77, 0.1); }
.mode .mt { font-size: 14px; font-weight: 700; margin-bottom: 3px; }
.mode .md { font-size: 11.5px; color: var(--muted); line-height: 1.5; }
.mode.on .mt { color: var(--red); }

.panel {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; padding: 18px; margin-bottom: 18px;
}
.panel .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
.field { flex: 1; min-width: 190px; }
.field.sm { flex: 0.7; min-width: 150px; }
.field label { display: block; font-size: 11px; color: var(--muted); font-weight: 600; margin-bottom: 6px; }
.field input {
  width: 100%; padding: 11px 13px; border: 1px solid var(--border); border-radius: 9px;
  font-size: 14px; background: var(--surface2); color: var(--ink); outline: none; font-family: var(--font);
}
.field input:focus { border-color: var(--red); box-shadow: 0 0 0 3px rgba(229, 72, 77, 0.13); }
.btn {
  padding: 11px 26px; border: none; border-radius: 9px;
  background: linear-gradient(135deg, #e5484d, #b3343a);
  color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; white-space: nowrap;
}
.btn:hover { filter: brightness(1.08); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.chips { margin-top: 11px; display: flex; gap: 7px; flex-wrap: wrap; }
.chip {
  font-size: 12px; padding: 5px 12px; border-radius: 16px; background: var(--surface2);
  border: 1px solid var(--border); color: var(--muted); cursor: pointer;
}
.chip:hover { border-color: var(--red); color: var(--red); }

.flow {
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  padding: 16px; margin-bottom: 18px; display: none;
}
.flow.show { display: block; }
.flow-title {
  font-size: 11px; letter-spacing: 0.12em; color: var(--faint);
  margin: 0 4px 12px; display: flex; justify-content: space-between;
}
.nodes { display: flex; gap: 0; overflow-x: auto; }
.node {
  flex: 1; min-width: 115px; background: var(--surface2); border: 1px solid var(--border);
  border-radius: 11px; padding: 11px 13px; position: relative; opacity: 0.4; transition: 0.3s;
}
.node.active { opacity: 1; border-color: var(--red); box-shadow: 0 0 0 3px rgba(229, 72, 77, 0.1); }
.node.done { opacity: 1; }
.node .ico { font-size: 15px; margin-bottom: 6px; display: block; }
.node .nm { font-size: 12.5px; font-weight: 600; }
.node .meta { font-size: 10px; color: var(--faint); font-family: var(--mono); }
.node .st {
  position: absolute; top: 10px; right: 10px; width: 15px; height: 15px; border-radius: 50%;
  background: var(--border); color: #fff; font-size: 9px;
  display: flex; align-items: center; justify-content: center;
}
.node.done .st { background: var(--green); }
.node.active .st { background: var(--amber); animation: cm-spin 1s linear infinite; }
@keyframes cm-spin { to { transform: rotate(360deg); } }
.arrow { display: flex; align-items: center; color: var(--faint); padding: 0 4px; }

.errbox {
  background: #fdecec; border: 1px solid #f3c2c2; color: #b3343a;
  border-radius: 12px; padding: 14px 16px; font-size: 13px; margin-bottom: 18px; display: none;
}
.errbox.show { display: block; }
.demo-banner {
  background: #fdf3e0; border: 1px solid #f0d79a; color: #8a5a08;
  border-radius: 10px; padding: 10px 14px; font-size: 12.5px; margin-bottom: 18px; display: none;
}
.demo-banner.show { display: block; }

.result { display: none; }
.result.show { display: block; }
.ch-head {
  display: flex; align-items: baseline; gap: 12px; margin-bottom: 16px;
  border-bottom: 1px solid var(--border); padding-bottom: 12px;
}
.ch-num {
  font-family: var(--mono); font-size: 13px; font-weight: 700; color: #fff;
  background: var(--red); padding: 3px 9px; border-radius: 5px;
}
.ch-head h2 { font-size: 20px; font-weight: 800; }
.ch-head .en {
  font-family: var(--mono); font-size: 11px; color: var(--faint); letter-spacing: 0.1em; margin-left: auto;
}
.chapter { margin-bottom: 32px; }
.lead { font-size: 13.5px; color: #3f4654; line-height: 1.8; margin-bottom: 18px; }
.lead :deep(b) { color: #111; }
.lead :deep(.hl) { color: var(--red); font-weight: 600; }

/* === Mode A === */
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
@media (max-width: 680px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
.kpi {
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 15px; position: relative;
}
.kpi .v { font-size: 24px; font-weight: 800; font-family: var(--mono); }
.kpi .v.red { color: var(--red); }
.kpi .v.blue { color: var(--blue); }
.kpi .v.amber { color: var(--amber); }
.kpi .v.green { color: var(--green); }
.kpi .k { font-size: 12px; color: var(--muted); margin-top: 6px; }
.kpi .d { font-size: 11px; color: var(--faint); margin-top: 2px; }
.kpi .tag { position: absolute; top: 13px; right: 13px; }
.tag { font-size: 10px; padding: 2px 7px; border-radius: 4px; font-weight: 600; }
.tag.ok { background: rgba(31, 157, 87, 0.14); color: #1f9d57; }
.tag.est { background: rgba(54, 102, 204, 0.14); color: #3666cc; }
.tag.待补充 { background: var(--surface2); color: var(--muted); }

.tbl {
  width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; overflow: hidden; margin-bottom: 18px;
}
.tbl th {
  padding: 11px 16px; text-align: left; font-size: 11px; color: var(--faint);
  background: var(--surface2); border-bottom: 1px solid var(--border);
}
.tbl td { padding: 12px 16px; font-size: 13px; border-bottom: 1px solid var(--border-soft); color: #3f4654; }
.tbl tr:last-child td { border-bottom: none; }
.tbl tr.total td { background: rgba(229, 72, 77, 0.08); color: #b3343a; font-weight: 600; }
.tbl .num { font-family: var(--mono); color: var(--amber); }
.tbl .src { color: var(--faint); font-size: 12px; }
.il-tag { font-size: 10px; padding: 1px 6px; border-radius: 4px; margin-left: 6px; }

.signal {
  background: var(--surface2); border-left: 3px solid var(--amber); border-radius: 8px;
  padding: 13px 16px; font-size: 12.5px; color: #3f4654; line-height: 1.75;
}
.signal :deep(b) { color: var(--amber); }

.split { display: grid; grid-template-columns: 240px 1fr; gap: 14px; margin-bottom: 20px; }
@media (max-width: 680px) { .split { grid-template-columns: 1fr; } }
.theory { background: #15171c; border-radius: 12px; padding: 18px; }
.theory h4 { font-size: 14px; margin-bottom: 10px; color: #fff; }
.theory :deep(p) { font-size: 12px; color: #b8bdc7; line-height: 1.75; margin-bottom: 8px; }
.theory :deep(em) { color: #ff7a7e; font-style: normal; }
.prodlist {
  display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; overflow: hidden;
}
.prod { display: flex; align-items: center; gap: 12px; padding: 13px 16px; border-bottom: 1px solid var(--border-soft); }
.prod:last-child { border-bottom: none; }
.prod .pi { font-size: 20px; }
.prod .pn { font-size: 13.5px; font-weight: 600; }
.prod .pp { font-size: 11.5px; color: var(--faint); }
.prod .pb { margin-left: auto; font-size: 10.5px; padding: 3px 9px; border-radius: 5px; white-space: nowrap; }
.pb.r { background: rgba(229, 72, 77, 0.14); color: #b3343a; }
.pb.b { background: rgba(54, 102, 204, 0.14); color: #3666cc; }
.pb.g { background: rgba(31, 157, 87, 0.14); color: #1f9d57; }

.steps { position: relative; padding-left: 8px; }
.step { position: relative; padding: 0 0 22px 34px; border-left: 2px solid var(--border); margin-left: 10px; }
.step:last-child { border-left-color: transparent; }
.step .dot {
  position: absolute; left: -11px; top: 0; width: 20px; height: 20px; border-radius: 50%;
  background: var(--surface); border: 2px solid var(--red); display: flex; align-items: center;
  justify-content: center; font-size: 9px; color: var(--red);
}
.step .en { font-family: var(--mono); font-size: 10.5px; color: var(--red); letter-spacing: 0.08em; }
.step h4 { font-size: 15px; margin: 3px 0 6px; }
.step p { font-size: 12.5px; color: #3f4654; line-height: 1.7; }
.step p :deep(b) { color: #111; }
.step .tags { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }
.step .tags span {
  font-size: 11px; padding: 3px 9px; border-radius: 5px; background: var(--surface2);
  border: 1px solid var(--border); color: var(--muted);
}

.jtbd-def { background: #15171c; border-radius: 12px; padding: 16px 18px; margin-bottom: 16px; font-size: 12.5px; color: #b8bdc7; line-height: 1.8; }
.jtbd-def :deep(b) { color: #fff; }
.sp {
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px;
  margin-bottom: 12px; display: grid; grid-template-columns: 34px 1fr; gap: 14px;
}
.sp .rank { font-size: 24px; font-weight: 800; font-family: var(--mono); color: var(--red); }
.sp .layer { font-size: 11px; color: var(--red); font-family: var(--mono); letter-spacing: 0.06em; }
.sp h4 { font-size: 14.5px; margin: 3px 0 8px; }
.sp .job { font-size: 12px; color: #8a5a08; background: rgba(194, 121, 10, 0.1); padding: 7px 11px; border-radius: 7px; margin-bottom: 8px; }
.sp .why { font-size: 12.5px; color: #3f4654; line-height: 1.7; margin-bottom: 8px; }
.sp .voc { font-size: 12px; color: var(--muted); border-left: 2px solid var(--green); padding-left: 11px; font-style: italic; }

.decpath { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 14px; }
@media (max-width: 680px) { .decpath { grid-template-columns: repeat(2, 1fr); } }
.dp { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 13px; }
.dp .stage { font-size: 10.5px; color: var(--red); font-family: var(--mono); margin-bottom: 6px; }
.dp .q { font-size: 12.5px; color: var(--ink); font-style: italic; margin-bottom: 6px; }
.dp .a { font-size: 11.5px; color: var(--muted); }

.funnel { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
@media (max-width: 680px) { .funnel { grid-template-columns: repeat(2, 1fr); } }
.fn { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 15px; border-top: 3px solid var(--blue); }
.fn:nth-child(1) { border-top-color: var(--red); }
.fn:nth-child(2) { border-top-color: var(--amber); }
.fn:nth-child(3) { border-top-color: var(--blue); }
.fn:nth-child(4) { border-top-color: var(--green); }
.fn .stg { font-family: var(--mono); font-size: 13px; font-weight: 700; }
.fn .en { font-size: 10px; color: var(--faint); font-family: var(--mono); }
.fn .pct { font-size: 22px; font-weight: 800; font-family: var(--mono); margin-top: 8px; }
.fn .bud { font-size: 11px; color: var(--muted); }
.fnd { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 13px 16px; margin-bottom: 10px; font-size: 12.5px; color: #3f4654; line-height: 1.7; }
.fnd :deep(b) { color: #111; }
.fnd .lbl { color: var(--red); font-weight: 600; font-size: 11px; font-family: var(--mono); }
.channels { margin-bottom: 4px; }
.chrow { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 12px; }
.chrow .cn { width: 140px; color: var(--muted); }
.chrow .bar { flex: 1; height: 14px; background: var(--surface2); border-radius: 4px; overflow: hidden; }
.chrow .bar i { display: block; height: 100%; background: var(--red); }
.chrow .cp { width: 44px; text-align: right; font-family: var(--mono); color: var(--amber); }

.weak {
  background: var(--surface2); border-left: 3px solid var(--amber); border-radius: 8px;
  padding: 14px 16px; font-size: 12.5px; color: #3f4654; line-height: 1.75; margin-top: 14px;
}
.weak h4 { color: var(--amber); font-size: 13px; margin-bottom: 6px; }

/* === Mode B === */
.tabbar { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 18px; overflow-x: auto; }
.tab {
  padding: 10px 16px; font-size: 13px; color: var(--muted); cursor: pointer; border: none; background: transparent;
  border-bottom: 2px solid transparent; white-space: nowrap; font-weight: 600;
}
.tab.on { color: var(--green); border-bottom-color: var(--green); }
.tabpane { animation: cm-fade 0.2s ease; }
@keyframes cm-fade { from { opacity: 0; } }
.chart-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px; margin-bottom: 16px; }
.chart-card h3 { font-size: 15px; font-weight: 700; }
.chart-card .csub { font-size: 12px; color: var(--muted); margin: 3px 0 6px; }
.chart-card .csrc {
  display: inline-block; font-size: 10.5px; color: var(--faint); background: var(--surface2);
  border: 1px solid var(--border); padding: 2px 9px; border-radius: 5px; margin-bottom: 14px; font-family: var(--mono);
}
.statcards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px; }
.statcard { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 13px 16px; }
.statcard .sl { font-size: 12px; color: var(--muted); }
.statcard .sv { font-size: 15px; font-weight: 700; font-family: var(--mono); }
.sv.g { color: var(--green); }
.sv.r { color: var(--red); }
.sv.a { color: var(--amber); }
.infocards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 14px; }
@media (max-width: 680px) { .infocards { grid-template-columns: 1fr; } .statcards { grid-template-columns: 1fr; } }
.info { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
.info h4 { font-size: 14px; margin-bottom: 10px; }
.info h4.g { color: var(--green); }
.info h4.r { color: var(--red); }
.info li { font-size: 12.5px; color: #3f4654; line-height: 1.9; list-style: none; padding-left: 14px; position: relative; }
.info li::before { content: "·"; position: absolute; left: 2px; color: var(--faint); }

.versus { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
@media (max-width: 680px) { .versus { grid-template-columns: 1fr; } }
.vs { background: #15171c; border-radius: 14px; padding: 18px; }
.vs .vh { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.vs .vn { font-size: 16px; font-weight: 800; }
.vs .vn.b { color: #6b9bff; }
.vs .vn.g { color: #4cc38a; }
.vs .vtag { font-size: 11px; color: #9aa0aa; background: #23262e; padding: 4px 10px; border-radius: 6px; }
.vrow { padding: 10px 0; border-bottom: 1px solid #23262e; }
.vrow:last-of-type { border-bottom: none; }
.vrow .vi { font-size: 13px; font-weight: 600; color: #fff; }
.vrow .vs2 { font-size: 12px; color: #b8bdc7; margin-top: 2px; }
.verdict { margin-top: 12px; padding: 10px 13px; border-radius: 9px; font-size: 12.5px; font-weight: 600; }
.verdict.ok { background: rgba(54, 102, 204, 0.16); color: #9bbbf5; }
.verdict.warn { background: rgba(194, 121, 10, 0.16); color: #f3c06b; }

.duel { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 8px; }
@media (max-width: 680px) { .duel { grid-template-columns: 1fr; } }
.duelcol { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
.duelcol h4 { font-size: 15px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.duelcol.win h4 { color: var(--blue); }
.duelcol.lose h4 { color: var(--amber); }
.duelrow { padding: 9px 0 9px 16px; position: relative; font-size: 12.5px; color: #3f4654; line-height: 1.65; border-bottom: 1px solid var(--border-soft); }
.duelrow:last-child { border-bottom: none; }
.duelrow::before { content: "→"; position: absolute; left: 0; color: var(--faint); }
.duelrow b { color: #111; }

.essence { background: #15171c; border-radius: 12px; padding: 18px; margin-top: 6px; }
.essence h4 { color: #ff7a7e; font-size: 14px; margin-bottom: 12px; }
.essence .er { font-size: 12.5px; color: #c8ccd4; line-height: 1.7; padding: 7px 0 7px 18px; position: relative; }
.essence .er::before { content: "→"; position: absolute; left: 0; color: var(--red); }

.crisis { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 8px 18px; margin-bottom: 14px; }
.cev { display: flex; align-items: center; gap: 14px; padding: 14px 0; border-bottom: 1px solid var(--border-soft); }
.cev:last-child { border-bottom: none; }
.cev .score {
  width: 38px; height: 38px; border-radius: 9px; display: flex; align-items: center; justify-content: center;
  font-size: 17px; font-weight: 800; font-family: var(--mono); color: #fff; flex-shrink: 0;
}
.score.g { background: var(--green); }
.score.y { background: var(--amber); }
.score.r { background: var(--red); }
.cev .cmid { flex: 1; }
.cev .cnm { font-size: 13.5px; font-weight: 600; }
.cev .cdate { font-size: 11.5px; color: var(--faint); font-family: var(--mono); }
.cev .cbar { height: 5px; border-radius: 3px; margin-top: 6px; }
.cbar.g { background: var(--green); }
.cbar.y { background: var(--amber); }
.cbar.r { background: var(--red); }
.cev .ctype {
  font-size: 10.5px; color: var(--muted); background: var(--surface2); border: 1px solid var(--border);
  padding: 3px 9px; border-radius: 5px; white-space: nowrap;
}

.foot { text-align: center; font-size: 11px; color: var(--faint); margin: 22px 0 8px; line-height: 1.8; }
</style>
