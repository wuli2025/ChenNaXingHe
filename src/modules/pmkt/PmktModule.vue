<script setup lang="ts">
/**
 * PMKT 营销策略工作流 —— 1:1 克隆桌面模板「PMKT_营销策略工作流.html」。
 *
 * 单栏、从上到下：顶部居中标题 + 历史记录抽屉 → 横向 4 步 Tab → 当前步白卡面板
 * （标题 / 描述 / 第一步含输入栅格 / 运行按钮 / 状态行 / 结果区）→ 底部「清空 · 导出」。
 * 配色用模板原版 Tailwind 蓝（#2563eb）；后端唯一大脑仍是 Claude Code（useAgentRunner），
 * 第一步让 Claude 自带 WebSearch 真实联网检索、保留逐字英文原话 + 真实 URL。
 *
 * 持久化：state + history → localStorage（键前缀 chuanying.pmkt.*）。
 */
import { computed, onMounted, reactive, ref } from "vue";
import { useAgentRunner } from "../../composables/useAgentRunner";
import { promptStep1, promptStep2, promptStep3, promptStep4 } from "./prompts";
import {
  LS,
  STAGE_LABELS,
  type PmktInputs,
  type PmktState,
  type HistoryEntry,
  type StageNo,
  type Step1Data,
  type Step2Data,
  type Step3Data,
  type Step4Data,
} from "./types";

const { running, runJson } = useAgentRunner();

// ───────────────────────── state ─────────────────────────
const DEFAULT_INPUTS: PmktInputs = {
  model: "Infinix Hot 50",
  market: "Nigeria",
  competitors: "Tecno Spark, Samsung A05, Redmi A3",
  age: "18-25",
};

const state = reactive<PmktState>({ inputs: null, step1: null, step2: null, step3: null, step4: null });
const form = reactive<PmktInputs>({ ...DEFAULT_INPUTS });

const activeStage = ref<StageNo>(1);
const runningStage = ref<StageNo | null>(null);
const stageStatus = reactive<Record<StageNo, string>>({ 1: "", 2: "", 3: "", 4: "" });

const showHistory = ref(false);
const history = ref<HistoryEntry[]>([]);

const stages: StageNo[] = [1, 2, 3, 4];

// ───────────────────────── persistence ─────────────────────────
function loadState() {
  try {
    const raw = localStorage.getItem(LS.state);
    if (raw) {
      const parsed = JSON.parse(raw) as PmktState;
      state.inputs = parsed.inputs ?? null;
      state.step1 = parsed.step1 ?? null;
      state.step2 = parsed.step2 ?? null;
      state.step3 = parsed.step3 ?? null;
      state.step4 = parsed.step4 ?? null;
      if (state.inputs) Object.assign(form, state.inputs);
    }
  } catch {
    /* ignore corrupt state */
  }
}

function saveState() {
  try {
    localStorage.setItem(
      LS.state,
      JSON.stringify({
        inputs: state.inputs,
        step1: state.step1,
        step2: state.step2,
        step3: state.step3,
        step4: state.step4,
      })
    );
  } catch {
    /* quota / ignore */
  }
}

function loadHistory() {
  try {
    history.value = JSON.parse(localStorage.getItem(LS.history) || "[]");
  } catch {
    history.value = [];
  }
}

function saveToHistory(stepN: number) {
  if (!state.inputs) return;
  if (!state.inputs._runId) state.inputs._runId = Date.now();
  const list = history.value.slice();
  const entry: HistoryEntry = {
    runId: state.inputs._runId,
    time: new Date().toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    inputs: { ...state.inputs },
    stepsComplete: stepN,
    step1: state.step1,
    step2: state.step2,
    step3: state.step3,
    step4: state.step4,
  };
  const idx = list.findIndex((h) => h.runId === state.inputs!._runId);
  if (idx >= 0) list[idx] = entry;
  else list.unshift(entry);
  if (list.length > 30) list.pop();
  history.value = list;
  try {
    localStorage.setItem(LS.history, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function loadHistoryEntry(runId: number) {
  const entry = history.value.find((h) => h.runId === runId);
  if (!entry) return;
  state.inputs = { ...entry.inputs };
  state.step1 = entry.step1;
  state.step2 = entry.step2;
  state.step3 = entry.step3;
  state.step4 = entry.step4;
  Object.assign(form, entry.inputs);
  saveState();
  activeStage.value = (entry.stepsComplete || 1) as StageNo;
  showHistory.value = false;
}

function deleteHistoryEntry(runId: number) {
  history.value = history.value.filter((h) => h.runId !== runId);
  try {
    localStorage.setItem(LS.history, JSON.stringify(history.value));
  } catch {
    /* ignore */
  }
}

function clearHistory() {
  if (!confirm("清空所有历史记录？")) return;
  history.value = [];
  try {
    localStorage.removeItem(LS.history);
  } catch {
    /* ignore */
  }
}

function openHistory() {
  showHistory.value = true;
}

// ───────────────────────── stage tab state ─────────────────────────
const stageState = computed<Record<StageNo, "done" | "active" | "todo">>(() => {
  const out = {} as Record<StageNo, "done" | "active" | "todo">;
  stages.forEach((i) => {
    if (i === activeStage.value) out[i] = "active";
    else if (state[`step${i}` as const]) out[i] = "done";
    else out[i] = "todo";
  });
  return out;
});

function stageDone(n: StageNo): boolean {
  return !!state[`step${n}` as const];
}

function runBtnLabel(n: StageNo): string {
  if (runningStage.value === n) return "运行中…";
  if (stageDone(n)) return "重新运行 · " + STAGE_LABELS[n];
  return ["开始扫描", "开始解码", "提炼锚点", "生成策略"][n - 1];
}

function statusTone(text: string): string {
  if (text.startsWith("✓")) return "st-ok";
  if (text.startsWith("✗")) return "st-err";
  return "";
}

// ───────────────────────── run a stage ─────────────────────────
async function runStage(n: StageNo) {
  if (running.value) return;

  // 第一步：收集表单 → 写回 inputs（新一轮，重置后续步骤）
  if (n === 1) {
    const inputs: PmktInputs = {
      model: form.model.trim(),
      market: form.market.trim(),
      competitors: form.competitors.trim(),
      age: form.age.trim(),
    };
    if (!inputs.model || !inputs.market) {
      alert("请至少填入机型与目标市场");
      return;
    }
    state.inputs = { ...inputs, _runId: Date.now() };
    // 不在此清空既有步骤：若本轮 run 失败会留白屏。改为在成功拿到新结果后再作废下游步骤。
  }

  if (!state.inputs) {
    alert("请先在第一步填入参数并跑过一次");
    return;
  }
  // 依赖检查
  if (n >= 2 && !state.step1) return alert("请先完成第一步");
  if (n >= 3 && !state.step2) return alert("请先完成第二步");
  if (n >= 4 && !state.step3) return alert("请先完成第三步");

  runningStage.value = n;
  activeStage.value = n;
  stageStatus[n] =
    n === 1 ? "联网检索真实用户声音 + 提炼话题中…（约 20-40 秒）" : "Claude AI 推理中…（约 10-20 秒）";

  const inputs = state.inputs;
  let prompt = "";
  const goal =
    n === 1
      ? `针对 ${inputs.model}（${inputs.market}）做真实联网用户洞察检索，保留逐字英文原话 + 真实来源 URL，输出 schema JSON。`
      : undefined;

  if (n === 1) prompt = promptStep1(inputs);
  else if (n === 2) prompt = promptStep2(inputs, state.step1 as Step1Data);
  else if (n === 3) prompt = promptStep3(inputs, state.step1 as Step1Data, state.step2 as Step2Data);
  else
    prompt = promptStep4(
      inputs,
      state.step1 as Step1Data,
      state.step2 as Step2Data,
      state.step3 as Step3Data
    );

  try {
    // 每步成功后作废其下游步骤：它们基于旧的上游结果，重跑上游后必须失效，
    // 否则会把陈旧结果当作「当前」展示，且 saveToHistory 的 stepsComplete 计数也随之失真。
    if (n === 1) {
      const { data } = await runJson<Step1Data>({ prompt, goal });
      state.step1 = data;
      state.step2 = state.step3 = state.step4 = null;
    } else if (n === 2) {
      const { data } = await runJson<Step2Data>({ prompt });
      state.step2 = data;
      state.step3 = state.step4 = null;
    } else if (n === 3) {
      const { data } = await runJson<Step3Data>({ prompt });
      state.step3 = data;
      state.step4 = null;
    } else {
      const { data } = await runJson<Step4Data>({ prompt });
      state.step4 = data;
    }

    saveState();
    saveToHistory(n);
    stageStatus[n] = "✓ 完成";
    if (n < 4) setTimeout(() => (activeStage.value = (n + 1) as StageNo), 800);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stageStatus[n] = "✗ " + msg;
  } finally {
    runningStage.value = null;
  }
}

// ───────────────────────── export / reset ─────────────────────────
function exportJSON() {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          inputs: state.inputs,
          step1: state.step1,
          step2: state.step2,
          step3: state.step3,
          step4: state.step4,
        },
        null,
        2
      ),
    ],
    { type: "application/json" }
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pmkt-${state.inputs?.model || "export"}-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function resetAll() {
  if (!confirm("清空所有步骤结果？历史记录会保留。")) return;
  state.inputs = null;
  state.step1 = state.step2 = state.step3 = state.step4 = null;
  Object.assign(form, DEFAULT_INPUTS);
  activeStage.value = 1;
  stages.forEach((i) => (stageStatus[i] = ""));
  saveState();
}

// ───────────────────────── render helpers ─────────────────────────
function scoreClass(s: number): string {
  if (s >= 8) return "sc-hi";
  if (s >= 6) return "sc-mid";
  return "sc-lo";
}
function sentClass(s: string): string {
  if (s === "negative") return "se-neg";
  if (s === "positive") return "se-pos";
  if (s === "mixed") return "se-mix";
  return "se-neu";
}

onMounted(() => {
  loadState();
  loadHistory();
});
</script>

<template>
  <div class="pm">
    <div class="container">
      <!-- ════════ header ════════ -->
      <div class="header">
        <div class="header-spacer" />
        <div class="header-title">
          <h1>PMKT 营销策略工作流</h1>
          <p>趋势雷达 → 人群解码 → 产品锚点 → 策略蓝图 · Claude 真实联网检索 · 用户原话保留英文</p>
        </div>
        <button class="hist-btn" @click="openHistory">
          <span>🗂</span><span>历史记录</span>
          <span v-if="history.length" class="hist-badge">{{ history.length }}</span>
        </button>
      </div>

      <!-- ════════ step tabs ════════ -->
      <div class="step-tabs">
        <button
          v-for="n in stages"
          :key="n"
          class="step-tab"
          :class="stageState[n]"
          @click="activeStage = n"
        >
          {{ ["①", "②", "③", "④"][n - 1] }} {{ STAGE_LABELS[n] }}
        </button>
      </div>

      <!-- ════════ Step 1: 趋势雷达 ════════ -->
      <div v-show="activeStage === 1" class="panel">
        <h2>第一步：趋势雷达</h2>
        <p class="panel-desc">
          扫描 Reddit / 评测网站的真实用户声音，对每条话题打营销机会分（1-10）。<br />
          <span class="hint-blue">⚡ 这步用 Claude 自带 WebSearch 真实检索 + 提炼话题 · 后续 3 步纯推理</span>
        </p>

        <div class="in-grid">
          <label><span>机型 / 品类</span><input v-model="form.model" placeholder="Infinix Hot 50" /></label>
          <label><span>目标市场</span><input v-model="form.market" placeholder="Nigeria" /></label>
          <label><span>竞品（逗号分隔）</span><input v-model="form.competitors" placeholder="Tecno Spark, Samsung A05, Redmi A3" /></label>
          <label><span>用户年龄段</span><input v-model="form.age" placeholder="18-25" /></label>
        </div>

        <button class="run-btn" :disabled="running" @click="runStage(1)">{{ runBtnLabel(1) }}</button>
        <div v-if="runningStage === 1 || stageStatus[1]" class="run-status">
          <span v-if="runningStage === 1" class="pulse-dot">●</span>
          <span :class="statusTone(stageStatus[1])">{{ stageStatus[1] }}</span>
        </div>

        <div v-if="state.step1" class="result">
          <div v-if="state.step1.汇总" class="summary-box">
            <div class="sb-title">汇总洞察</div>
            <div class="sb-row"><strong>高机会话题 Top3：</strong>{{ (state.step1.汇总.高机会话题Top3 || []).join(" · ") }}</div>
            <div class="sb-row"><strong>竞品被吐槽点：</strong>{{ (state.step1.汇总.竞品被吐槽点 || []).join(" · ") }}</div>
            <div class="sb-row">
              <strong>可直接套用的原话：</strong>
              <ul class="sb-quotes">
                <li v-for="(q, i) in state.step1.汇总.可直接套用的用户原话Top5 || []" :key="i" class="quote-en">"{{ q }}"</li>
              </ul>
            </div>
          </div>
          <div v-for="(t, i) in state.step1.话题列表 || []" :key="i" class="topic-card">
            <div class="tc-head">
              <div class="tc-title">{{ t.话题 }}</div>
              <div class="score-pill" :class="scoreClass(t.营销机会分)">机会分 {{ t.营销机会分 }}/10</div>
            </div>
            <div class="tc-badges">
              <span class="sent-badge" :class="sentClass(String(t.情绪))">{{ t.情绪 }}</span>
              <span class="sell-badge">{{ t.关联卖点 }}</span>
            </div>
            <div class="quote-block">
              <div class="quote-en">"{{ t.用户原话 }}"</div>
              <a v-if="/^https?:\/\//.test(t.原话来源)" class="quote-src" :href="t.原话来源" target="_blank" rel="noopener">— {{ t.原话来源 }}</a>
              <div v-else class="quote-src">— {{ t.原话来源 }}</div>
            </div>
            <div class="tc-reason">打分理由：{{ t.打分理由 }}</div>
          </div>
        </div>
      </div>

      <!-- ════════ Step 2: 人群解码 ════════ -->
      <div v-show="activeStage === 2" class="panel">
        <h2>第二步：人群解码</h2>
        <p class="panel-desc">基于第一步的真实声音，把用户聚类成 3-5 个具体人群，每群附决策驱动 + 代表性原话。</p>

        <button class="run-btn" :disabled="running" @click="runStage(2)">{{ runBtnLabel(2) }}</button>
        <div v-if="runningStage === 2 || stageStatus[2]" class="run-status">
          <span v-if="runningStage === 2" class="pulse-dot">●</span>
          <span :class="statusTone(stageStatus[2])">{{ stageStatus[2] }}</span>
        </div>

        <div v-if="state.step2" class="result">
          <div v-if="state.step2.人群对比洞察" class="insight-box"><strong>对比洞察：</strong>{{ state.step2.人群对比洞察 }}</div>
          <div v-for="(p, i) in state.step2.人群 || []" :key="i" class="persona-card">
            <div class="pc-head">
              <div class="pc-name">{{ p.群体名称 }}</div>
              <div class="pc-pct">{{ p.占比估计 }}</div>
            </div>
            <div class="pc-feat">{{ p.核心特征 }}</div>
            <div class="pc-driver"><span class="lbl">决策驱动：</span>{{ p.决策驱动 }}</div>
            <div class="quote-block"><div class="quote-en">"{{ p.代表性原话 }}"</div></div>
            <div class="pc-meta">
              <span>购买力：{{ p.购买力区间 }}</span>
              <span>主要触媒：{{ (p.主要触媒 || []).join(", ") }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ════════ Step 3: 产品锚点 ════════ -->
      <div v-show="activeStage === 3" class="panel">
        <h2>第三步：产品锚点</h2>
        <p class="panel-desc">把用户需求映射到具体卖点，每个锚点对应「哪类人 + 用户原话证据 + 竞品差异」。</p>

        <button class="run-btn" :disabled="running" @click="runStage(3)">{{ runBtnLabel(3) }}</button>
        <div v-if="runningStage === 3 || stageStatus[3]" class="run-status">
          <span v-if="runningStage === 3" class="pulse-dot">●</span>
          <span :class="statusTone(stageStatus[3])">{{ stageStatus[3] }}</span>
        </div>

        <div v-if="state.step3" class="result">
          <div v-for="(a, i) in state.step3.卖点锚点 || []" :key="i" class="anchor-card">
            <div class="ac-head">
              <span class="ac-rank">#{{ a.优先级 }}</span>
              <span class="ac-name">{{ a.锚点名称 }}</span>
            </div>
            <div class="ac-personas">面向：{{ (a.对应人群 || []).join(" · ") }}</div>
            <div class="quote-block"><div class="quote-en">"{{ a.用户证据 }}"</div></div>
            <div class="ac-diff"><strong>竞品差异：</strong>{{ a.竞品差异点 }}</div>
            <div class="ac-copy"><strong>文案方向：</strong>{{ a.建议文案方向 }}</div>
          </div>
        </div>
      </div>

      <!-- ════════ Step 4: 策略蓝图 ════════ -->
      <div v-show="activeStage === 4" class="panel">
        <h2>第四步：策略蓝图</h2>
        <p class="panel-desc">输出可执行的内容策略：核心信息、渠道选择、选题 Top5、AB 测试假设。</p>

        <button class="run-btn" :disabled="running" @click="runStage(4)">{{ runBtnLabel(4) }}</button>
        <div v-if="runningStage === 4 || stageStatus[4]" class="run-status">
          <span v-if="runningStage === 4" class="pulse-dot">●</span>
          <span :class="statusTone(stageStatus[4])">{{ stageStatus[4] }}</span>
        </div>

        <div v-if="state.step4" class="result">
          <div class="hero-box">
            <div class="hero-lbl">核心营销主张</div>
            <div class="hero-claim">{{ state.step4.核心营销主张 }}</div>
          </div>
          <div class="bp-grid">
            <div class="bp-card">
              <div class="bp-title">渠道优先级</div>
              <div v-for="(c, i) in state.step4.渠道优先级 || []" :key="i" class="channel-row">
                <div>
                  <div class="ch-name">{{ c.渠道 }}</div>
                  <div class="ch-reason">{{ c.理由 }}</div>
                </div>
                <div class="ch-pct">{{ c.投入占比建议 }}</div>
              </div>
            </div>
            <div class="bp-card">
              <div class="bp-title">AB 测试假设</div>
              <ul class="ab-list">
                <li v-for="(h, i) in state.step4.AB测试假设 || []" :key="i">· {{ h }}</li>
              </ul>
            </div>
          </div>
          <div class="bp-title section-title">内容选题 Top5</div>
          <div v-for="(t, i) in state.step4.内容选题Top5 || []" :key="i" class="content-card">
            <div class="cc-title">#{{ i + 1 }} {{ t.选题 }}</div>
            <div class="cc-badges">
              <span class="cb-fmt">{{ t.格式 }}</span>
              <span class="cb-anchor">{{ t.对应锚点 }}</span>
              <span class="cb-persona">{{ t.对应人群 }}</span>
            </div>
            <div class="cc-effect">预期：{{ t.预期效果 }}</div>
          </div>
          <div class="land-box"><strong>30 天落地：</strong>{{ state.step4["30天落地建议"] || state.step4.落地建议 || "" }}</div>
        </div>
      </div>

      <!-- ════════ footer ════════ -->
      <div class="footer">
        <button @click="resetAll">清空所有状态</button>
        <span class="dot">·</span>
        <button @click="exportJSON">导出 JSON</button>
      </div>
    </div>

    <!-- ════════ History Drawer ════════ -->
    <Teleport to="body">
      <div v-if="showHistory" class="hist-overlay" @click="showHistory = false">
        <div class="hist-drawer" @click.stop>
          <div class="hist-head">
            <span class="hist-title">历史记录</span>
            <div class="hist-head-actions">
              <button class="link-danger" @click="clearHistory">清空全部</button>
              <button class="icon-x" @click="showHistory = false">×</button>
            </div>
          </div>
          <div class="hist-list">
            <div v-if="!history.length" class="hist-empty">还没有历史记录<br />跑完第一步后会自动存档</div>
            <div v-for="h in history" :key="h.runId" class="hist-card">
              <div class="hc-head">
                <div>
                  <div class="hc-model">{{ h.inputs.model }}</div>
                  <div class="hc-meta">{{ h.inputs.market }} · {{ h.time }}</div>
                </div>
                <button class="hc-del" @click="deleteHistoryEntry(h.runId)">×</button>
              </div>
              <div class="hc-dots">
                <span v-for="i in 4" :key="i" class="hc-dot" :class="{ on: i <= h.stepsComplete }" />
                <span class="hc-step">完成到「{{ STAGE_LABELS[(h.stepsComplete || 1) as StageNo] || "?" }}」</span>
              </div>
              <button class="hc-load" @click="loadHistoryEntry(h.runId)">载入查看</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ════════════════════════════════════════════════════════════════
   1:1 克隆自桌面模板「PMKT_营销策略工作流.html」（Tailwind 蓝转写为原生 CSS）。
   单栏从上到下；后端仍走 Claude（useAgentRunner）。
   ════════════════════════════════════════════════════════════════ */
.pm {
  --blue: #2563eb;
  --blue-deep: #1d4ed8;
  --blue-50: #eff6ff;
  --blue-100: #dbeafe;
  --blue-200: #bfdbfe;
  --blue-600: #2563eb;
  --blue-700: #1d4ed8;
  --blue-800: #1e40af;
  --blue-900: #1e3a8a;
  --slate-50: #f8fafc;
  --slate-100: #f1f5f9;
  --slate-200: #e2e8f0;
  --slate-300: #cbd5e1;
  --slate-400: #94a3b8;
  --slate-500: #64748b;
  --slate-600: #475569;
  --slate-700: #334155;
  --slate-800: #1e293b;
  --amber-50: #fffbeb;
  --amber-200: #fde68a;
  --amber-700: #b45309;
  --amber-800: #92400e;
  --red-50: #fef2f2;
  --red-100: #fee2e2;
  --red-500: #ef4444;
  --red-600: #dc2626;
  --red-700: #b91c1c;
  --green-50: #f0fdf4;
  --green-600: #16a34a;
  --purple-50: #faf5ff;
  --purple-200: #e9d5ff;
  --purple-600: #9333ea;
  --purple-900: #581c87;

  height: 100%;
  min-height: 0;
  overflow-y: auto;
  background: var(--slate-50);
  color: var(--slate-800);
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  line-height: 1.6;
}
.pm * { box-sizing: border-box; }
.container { max-width: 1152px; margin: 0 auto; padding: 24px; }

/* ── header ── */
.header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 32px; }
.header-spacer { flex: 0 0 96px; }
.header-title { flex: 1; text-align: center; }
.header-title h1 { font-size: 30px; font-weight: 700; color: var(--slate-800); margin: 0; }
.header-title p { font-size: 14px; color: var(--slate-500); margin: 8px 0 0; }
.hist-btn {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px;
  background: var(--slate-100); color: var(--slate-600); border: none;
  padding: 8px 12px; border-radius: 8px; font-size: 14px; cursor: pointer;
}
.hist-btn:hover { background: var(--slate-200); }
.hist-badge {
  background: var(--blue-600); color: #fff; font-size: 12px; border-radius: 999px;
  padding: 1px 7px; line-height: 1.4;
}

/* ── step tabs ── */
.step-tabs { display: flex; gap: 8px; margin-bottom: 24px; }
.step-tab {
  flex: 1; padding: 12px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500;
  cursor: pointer; transition: 0.12s;
}
.step-tab.active { background: var(--blue-600); color: #fff; }
.step-tab.done { background: var(--blue-100); color: var(--blue-800); }
.step-tab.todo { background: var(--slate-100); color: var(--slate-500); }

/* ── panel ── */
.panel { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06); padding: 24px; }
.panel h2 { font-size: 20px; font-weight: 700; margin: 0 0 4px; color: var(--slate-800); }
.panel-desc { font-size: 14px; color: var(--slate-500); margin: 0 0 16px; line-height: 1.6; }
.hint-blue { color: var(--blue-600); }

.in-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
.in-grid label { display: flex; flex-direction: column; gap: 4px; }
.in-grid label span { font-size: 12px; font-weight: 500; color: var(--slate-600); }
.in-grid input {
  width: 100%; border: 1px solid var(--slate-300); border-radius: 6px; padding: 8px 10px;
  font-size: 14px; color: var(--slate-800); background: #fff; outline: none;
}
.in-grid input:focus { border-color: var(--blue-600); box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15); }

.run-btn {
  background: var(--blue-600); color: #fff; border: none; padding: 9px 24px;
  border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer;
}
.run-btn:hover:not(:disabled) { background: var(--blue-700); }
.run-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.run-status { font-size: 14px; color: var(--slate-500); margin-top: 12px; display: flex; align-items: center; gap: 6px; }
.run-status .st-ok { color: var(--green-600); }
.run-status .st-err { color: var(--red-600); }
.pulse-dot { color: var(--blue-600); animation: pm-pulse 1.5s ease-in-out infinite; }
@keyframes pm-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

.result { margin-top: 24px; }
.quote-en { font-family: Georgia, serif; font-style: italic; color: var(--slate-800); }

/* ── step1 ── */
.summary-box { background: var(--blue-50); border: 1px solid var(--blue-200); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.sb-title { font-weight: 700; color: var(--blue-900); margin-bottom: 8px; }
.sb-row { font-size: 14px; color: var(--slate-700); margin-bottom: 8px; line-height: 1.6; }
.sb-row strong { color: var(--blue-800); }
.sb-quotes { margin: 4px 0 0; padding-left: 20px; list-style: disc; }
.sb-quotes li { font-size: 12px; color: var(--slate-700); margin: 2px 0; }
.topic-card { border: 1px solid var(--slate-200); border-radius: 8px; padding: 16px; margin-bottom: 12px; }
.topic-card:hover { box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06); }
.tc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.tc-title { font-weight: 500; color: var(--slate-800); }
.score-pill { flex-shrink: 0; font-size: 12px; font-weight: 700; padding: 4px 8px; border-radius: 6px; white-space: nowrap; }
.score-pill.sc-hi { background: var(--red-100); color: var(--red-700); }
.score-pill.sc-mid { background: #fef3c7; color: var(--amber-700); }
.score-pill.sc-lo { background: var(--slate-100); color: var(--slate-600); }
.tc-badges { display: flex; gap: 8px; margin-bottom: 12px; }
.sent-badge, .sell-badge { font-size: 12px; padding: 2px 8px; border-radius: 6px; }
.sent-badge.se-neg { background: var(--red-50); color: var(--red-600); }
.sent-badge.se-pos { background: var(--green-50); color: var(--green-600); }
.sent-badge.se-mix { background: var(--purple-50); color: var(--purple-600); }
.sent-badge.se-neu { background: var(--slate-100); color: var(--slate-600); }
.sell-badge { background: var(--blue-50); color: var(--blue-600); }
.quote-block { background: var(--slate-50); border-radius: 6px; padding: 12px; margin: 8px 0; }
.quote-block .quote-en { font-size: 14px; line-height: 1.6; }
.quote-src { display: block; font-size: 12px; color: var(--slate-400); margin-top: 4px; word-break: break-all; text-decoration: none; }
a.quote-src:hover { color: var(--blue-600); }
.tc-reason { font-size: 12px; color: var(--slate-500); margin-top: 8px; }

/* ── step2 ── */
.insight-box { background: var(--purple-50); border: 1px solid var(--purple-200); border-radius: 6px; padding: 12px; font-size: 14px; color: var(--purple-900); margin-bottom: 16px; line-height: 1.6; }
.persona-card { border: 1px solid var(--slate-200); border-radius: 8px; padding: 16px; margin-bottom: 12px; }
.pc-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
.pc-name { font-weight: 700; color: var(--slate-800); }
.pc-pct { font-size: 14px; color: var(--blue-600); }
.pc-feat { font-size: 14px; color: var(--slate-600); margin-bottom: 8px; line-height: 1.6; }
.pc-driver { background: var(--amber-50); border-radius: 6px; padding: 12px; font-size: 14px; color: var(--slate-700); margin: 8px 0; line-height: 1.6; }
.pc-driver .lbl { font-weight: 500; color: var(--amber-800); }
.pc-meta { display: flex; gap: 12px; font-size: 12px; color: var(--slate-500); margin-top: 8px; flex-wrap: wrap; }

/* ── step3 ── */
.anchor-card { border: 1px solid var(--slate-200); border-radius: 8px; padding: 16px; margin-bottom: 12px; }
.ac-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
.ac-rank { background: var(--blue-600); color: #fff; font-size: 12px; padding: 2px 8px; border-radius: 4px; }
.ac-name { font-weight: 700; font-size: 18px; color: var(--slate-800); }
.ac-personas { font-size: 12px; color: var(--slate-500); margin-bottom: 8px; }
.ac-diff, .ac-copy { font-size: 14px; color: var(--slate-700); line-height: 1.6; margin-top: 4px; }
.ac-diff strong { color: var(--green-600); }
.ac-copy strong { color: var(--blue-700); }

/* ── step4 ── */
.hero-box { background: linear-gradient(90deg, var(--blue-50), #eef2ff); border: 1px solid var(--blue-200); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.hero-lbl { font-size: 12px; color: var(--blue-700); font-weight: 500; margin-bottom: 4px; }
.hero-claim { font-size: 18px; font-weight: 700; color: var(--slate-800); line-height: 1.5; }
.bp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
.bp-card { background: #fff; border: 1px solid var(--slate-200); border-radius: 8px; padding: 16px; }
.bp-title { font-weight: 700; color: var(--slate-800); margin-bottom: 8px; }
.section-title { margin-top: 4px; }
.channel-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--slate-100); }
.channel-row:last-child { border-bottom: none; }
.ch-name { font-weight: 500; }
.ch-reason { font-size: 12px; color: var(--slate-500); line-height: 1.5; }
.ch-pct { font-weight: 700; color: var(--blue-600); white-space: nowrap; }
.ab-list { margin: 0; padding: 0; list-style: none; }
.ab-list li { font-size: 14px; color: var(--slate-600); line-height: 1.6; margin-bottom: 4px; }
.content-card { border: 1px solid var(--slate-200); border-radius: 6px; padding: 12px; margin-bottom: 8px; }
.cc-title { font-weight: 500; color: var(--slate-800); margin-bottom: 4px; }
.cc-badges { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.cc-badges span { font-size: 12px; padding: 2px 8px; border-radius: 6px; }
.cb-fmt { background: var(--slate-100); color: var(--slate-700); }
.cb-anchor { background: var(--blue-50); color: var(--blue-600); }
.cb-persona { background: var(--purple-50); color: var(--purple-600); }
.cc-effect { font-size: 12px; color: var(--slate-500); }
.land-box { background: var(--amber-50); border: 1px solid var(--amber-200); border-radius: 6px; padding: 12px; font-size: 14px; color: var(--slate-700); line-height: 1.6; margin-top: 16px; }
.land-box strong { color: var(--amber-800); }

/* ── footer ── */
.footer { text-align: center; font-size: 12px; color: var(--slate-400); margin-top: 32px; }
.footer button { background: none; border: none; color: var(--slate-400); font-size: 12px; text-decoration: underline; cursor: pointer; }
.footer button:hover { color: var(--slate-600); }
.footer .dot { margin: 0 8px; }

/* ── history drawer ── */
.hist-overlay { position: fixed; inset: 0; z-index: 40; background: rgba(0, 0, 0, 0.3); animation: pm-fade 160ms ease; }
@keyframes pm-fade { from { opacity: 0; } }
.hist-drawer {
  position: absolute; top: 0; right: 0; height: 100%; width: 384px; max-width: 92vw;
  background: #fff; box-shadow: -8px 0 24px rgba(0, 0, 0, 0.15); display: flex; flex-direction: column;
  animation: pm-slide 280ms cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes pm-slide { from { transform: translateX(100%); } }
.hist-head { display: flex; align-items: center; justify-content: space-between; padding: 16px; border-bottom: 1px solid var(--slate-200); }
.hist-title { font-weight: 700; color: var(--slate-800); }
.hist-head-actions { display: inline-flex; align-items: center; gap: 8px; }
.link-danger { background: none; border: none; color: var(--red-500); font-size: 12px; padding: 4px 8px; border-radius: 4px; cursor: pointer; }
.link-danger:hover { color: var(--red-700); background: var(--red-50); }
.icon-x { background: none; border: none; color: var(--slate-400); font-size: 22px; line-height: 1; width: 26px; height: 26px; border-radius: 6px; cursor: pointer; }
.icon-x:hover { color: var(--slate-600); }
.hist-list { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.hist-empty { text-align: center; color: var(--slate-400); font-size: 14px; margin-top: 32px; line-height: 1.8; }
.hist-card { border: 1px solid var(--slate-200); border-radius: 8px; padding: 12px; transition: 0.15s; }
.hist-card:hover { border-color: var(--blue-200); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06); }
.hc-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 8px; }
.hc-model { font-weight: 500; color: var(--slate-800); }
.hc-meta { font-size: 12px; color: var(--slate-500); }
.hc-del { background: none; border: none; color: var(--slate-300); font-size: 18px; line-height: 1; cursor: pointer; }
.hc-del:hover { color: var(--red-500); }
.hc-dots { display: flex; align-items: center; gap: 4px; margin-bottom: 12px; }
.hc-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--slate-200); }
.hc-dot.on { background: var(--blue-500, #3b82f6); }
.hc-step { font-size: 12px; color: var(--slate-400); margin-left: 4px; }
.hc-load { width: 100%; border: none; background: var(--blue-50); color: var(--blue-700); font-size: 12px; padding: 6px 0; border-radius: 6px; cursor: pointer; }
.hc-load:hover { background: var(--blue-100); }

@media (max-width: 760px) {
  .in-grid { grid-template-columns: 1fr; }
  .bp-grid { grid-template-columns: 1fr; }
  .header-spacer { display: none; }
}
</style>
