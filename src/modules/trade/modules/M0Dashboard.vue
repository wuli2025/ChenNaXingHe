<script setup lang="ts">
/**
 * M0 · 经营驾驶舱
 * 澳鲸进口 / Orca Imports —— 从选品到对账，一屏看全。
 *  - dashKpi：6 张 KPI 卡（acc → gold/blue/amber/red/green/purple）。
 *  - trends：3 条经营趋势（SPARK + 数值 + delta）。
 *  - pipeline：端到端流水线节点链（选品→建联→采购→在途→待报关→在库→分销→待对账）。
 *  - briefing：今日晨报 3 块（昨日完成/今日待办/风险预警）。
 *  - 「一键生成今日晨报」→ store.runChat(...)，把 Claude 返回文本展示。
 * 零 props，数据全部取自单例 store（ref → .value）。
 */
import { ref, computed } from "vue";
import { useTradeStore } from "../useTradeStore";
import type { DashKpi, ModId } from "../types";
import { ICONS } from "../types";
import TSection from "../components/TSection.vue";
import TPanel from "../components/TPanel.vue";
import TKpi from "../components/TKpi.vue";
import TSpark from "../components/TSpark.vue";
import TBadge from "../components/TBadge.vue";
import TIcon from "../components/TIcon.vue";

const store = useTradeStore();

/** 今日日期（YYYY-MM-DD，本地时区）—— 避免硬编码某天造成每天都显示错。 */
const todayStr = computed(() => {
  const d = new Date();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mo}-${dd}`;
});

/** DashKpi.acc 是宽 string，收窄成 TKpi 接受的联合类型。 */
type KpiAcc = "gold" | "blue" | "green" | "amber" | "red" | "purple";
function accOf(x: DashKpi): KpiAcc {
  const ok: KpiAcc[] = ["gold", "blue", "green", "amber", "red", "purple"];
  return (ok as string[]).includes(x.acc) ? (x.acc as KpiAcc) : "gold";
}
/** 趋势线着色：上行走绿、下行走金。 */
function trendTone(up: boolean): "green" | "gold" {
  return up ? "green" : "gold";
}
/** 晨报三块的强调色（昨日完成/今日待办/风险预警）。 */
function briefTone(k: string): "green" | "gold" | "red" {
  if (k.includes("风险")) return "red";
  if (k.includes("待办")) return "gold";
  return "green";
}

/* ── 下钻：KPI 卡 / 流水线节点 → 对应模块（与 store 派生数据同序） ── */
const kpiTargets: (ModId | "review")[] = ["m6", "m5", "m4", "m6", "review", "m8"];
const pipeTargets: (ModId | "review")[] = ["m1", "m2", "m3", "m5", "m4", "m6", "m7", "m8"];
function drill(target: ModId | "review") {
  store.go(target);
}

/* ── 无人化度量 + 最近已执行动作（核准即执行的证据流） ── */
const autonomy = computed(() => store.autonomyStats.value);
const recentActions = computed(() => store.executedActions.value.slice(0, 6));

/* ── 一键生成今日晨报（Claude 动作，实时过程在右侧 Console 可见） ── */
const briefText = ref<string>("");
const briefBusy = ref<boolean>(false);
async function genBriefing() {
  if (briefBusy.value || store.busy.value) return;
  briefBusy.value = true;
  briefText.value = "";
  try {
    const out = await store.runChat(
      "经营驾驶舱",
      "晨报",
      "请聚合各模块今日状态生成昨日完成/今日待办/风险预警晨报",
      false,
    );
    briefText.value = (out || "").trim();
  } catch (e) {
    // 后端不可用时给出可见反馈，避免静默失败 + 未处理的 promise 拒绝。
    const msg = (e as Error).message || String(e);
    briefText.value = `❌ 晨报生成失败：${msg}`;
    store.log("error", `❌ 晨报生成失败：${msg}`);
  } finally {
    briefBusy.value = false;
  }
}
</script>

<template>
  <div class="t-view-anim m0">
    <!-- ═══ 顶部：标题 + 一键晨报 ═══ -->
    <TSection title="经营驾驶舱" sub="澳鲸进口 · 全链路真实状态实时派生 · 点卡片下钻">
      <template #actions>
        <span class="t-pill">今日 · {{ todayStr }}</span>
        <button class="t-btn primary" :disabled="briefBusy || store.busy.value" @click="genBriefing">
          <TIcon :path="ICONS.workflow" :size="14" />
          {{ briefBusy ? "聚合各模块中…" : "一键生成今日晨报" }}
        </button>
      </template>
    </TSection>

    <!-- ═══ 6 张 KPI（真实派生 · 可点击下钻） ═══ -->
    <div v-if="store.dashKpi.value.length" class="t-grid t-g6">
      <div
        v-for="(x, i) in store.dashKpi.value"
        :key="i"
        class="kpi-drill"
        role="button"
        tabindex="0"
        :title="`下钻到 ${kpiTargets[i] === 'review' ? '审核看板' : kpiTargets[i].toUpperCase()}`"
        @click="drill(kpiTargets[i])"
        @keydown.enter="drill(kpiTargets[i])"
      >
        <TKpi :value="x.v" :label="x.l" :delta="x.d" :up="x.up" :acc="accOf(x)" :icon="x.ico" />
      </div>
    </div>
    <TPanel v-else pad><div class="empty">暂无经营指标</div></TPanel>

    <!-- ═══ 无人化仪表 + 最近已执行 ═══ -->
    <div class="auto-row">
      <TPanel pad class="auto-meter">
        <div class="am-h">无人化仪表</div>
        <div class="am-main">
          <span class="am-v">{{ autonomy.autoRate }}%</span>
          <span class="am-l">自动放行占比</span>
        </div>
        <div class="am-sub">
          共执行 <b>{{ autonomy.total }}</b> 项 · 自动 <b>{{ autonomy.auto }}</b> · 人工闸 <b>{{ autonomy.human }}</b>
        </div>
        <div class="am-hint">高置信自动放行率越高，人越只需守关键闸口（目标 ≥90%）。</div>
      </TPanel>
      <TPanel pad class="auto-feed">
        <div class="am-h">最近已执行 · 核准即生效</div>
        <div v-if="recentActions.length" class="af-list">
          <div v-for="a in recentActions" :key="a.id" class="af-row">
            <span class="af-tag" :class="a.by === 'auto' ? 'af-auto' : 'af-human'">{{ a.by === 'auto' ? '自动' : '人工' }}</span>
            <div class="af-body"><b>{{ a.title }}</b><span>{{ a.detail }}</span></div>
          </div>
        </div>
        <div v-else class="af-empty">暂无已执行动作 —— 在各模块跑 AI 或到审核看板核准后，这里实时记录「到底做了什么」。</div>
      </TPanel>
    </div>

    <!-- ═══ 经营趋势 ═══ -->
    <TSection title="经营趋势" sub="销售额 · 毛利率 · 现金转换周期 · 近 12 周">
      <template #actions><span class="t-pill">示例趋势 · 待接入历史库</span></template>
    </TSection>
    <div v-if="store.trends.value.length" class="t-grid t-g3">
      <TPanel v-for="(t, i) in store.trends.value" :key="i" pad class="tr-card">
        <div class="tr-head">
          <span class="tr-val">{{ t.v }}</span>
          <TBadge :tone="t.up ? 'green' : 'red'">{{ t.up ? "▲" : "▼" }} {{ t.delta }}</TBadge>
        </div>
        <div class="tr-lbl">{{ t.l }}</div>
        <TSpark :series="t.series" :tone="trendTone(t.up)" />
      </TPanel>
    </div>
    <TPanel v-else pad><div class="empty">暂无趋势数据</div></TPanel>

    <!-- ═══ 端到端流水线 ═══ -->
    <TSection
      title="端到端流水线"
      sub="选品 → 建联 → 采购 → 在途 → 待报关 → 在库 → 分销 → 待对账"
    />
    <TPanel pad>
      <div v-if="store.pipeline.value.length" class="pipe">
        <template v-for="(p, i) in store.pipeline.value" :key="i">
          <div
            class="pipe-node"
            role="button"
            tabindex="0"
            :title="`下钻到 ${pipeTargets[i]?.toUpperCase?.() || ''}`"
            @click="drill(pipeTargets[i])"
            @keydown.enter="drill(pipeTargets[i])"
          >
            <div class="pn-c">{{ p.c }}</div>
            <div class="pn-l">{{ p.l }}</div>
          </div>
          <div v-if="i < store.pipeline.value.length - 1" class="pipe-arrow">
            <span>›</span>
          </div>
        </template>
      </div>
      <div v-else class="empty">暂无流水线数据</div>
    </TPanel>
    <div class="t-note info">
      <b>数字为各模块当前在办量</b>，点节点即下钻进对应模块。带 ★ 的环节（报关确认 / 三单硬差异 / 缺证放行）派单进<b>人工审核看板</b>，硬闸不可跳过导出。
    </div>

    <!-- ═══ 今日晨报 ═══ -->
    <TSection title="今日晨报" sub="Claude Code 聚合各模块当日状态生成">
      <template #actions>
        <span class="t-pill">昨日完成 / 今日待办 / 风险预警</span>
      </template>
    </TSection>

    <!-- Claude 生成结果（点了按钮才出现） -->
    <div v-if="briefBusy" class="t-note info brief-live">
      <span class="dot" /> Claude Code 正在聚合选品 / 建联 / 报关 / 物流 / 分销 /
      财务各模块今日状态，生成过程见右侧控制台…
    </div>
    <TPanel v-else-if="briefText" pad class="brief-out">
      <div class="brief-out-h">
        <TBadge tone="blue">AI 晨报</TBadge>
        <span class="t-muted">Claude Code · 聚合生成</span>
      </div>
      <pre class="brief-text">{{ briefText }}</pre>
    </TPanel>

    <!-- 结构化晨报（种子/派生，始终可见） -->
    <div v-if="store.briefing.value.length" class="t-grid t-g3">
      <TPanel v-for="(b, i) in store.briefing.value" :key="i" pad class="brief-card">
        <div class="brief-k" :class="`bk-${briefTone(b.k)}`">
          <span class="brief-dot" />{{ b.k }}
          <span class="brief-n">{{ b.items.length }}</span>
        </div>
        <ul v-if="b.items.length" class="brief-list">
          <li v-for="(it, j) in b.items" :key="j">
            <span class="li-dot">·</span><span>{{ it }}</span>
          </li>
        </ul>
        <div v-else class="empty">暂无条目</div>
      </TPanel>
    </div>
    <TPanel v-else pad><div class="empty">暂无晨报数据</div></TPanel>
  </div>
</template>

<style scoped>
.m0 { padding-bottom: 12px; }

/* ── 示例数据提示条 ── */
.demo-note {
  margin: 0 0 12px;
  padding: 8px 12px;
  border: 1px solid var(--amber, #d9a441);
  border-left-width: 3px;
  border-radius: 6px;
  background: rgba(217, 164, 65, 0.08);
  color: var(--text, #333);
  font-size: 12.5px;
  line-height: 1.5;
}
.demo-note b { color: var(--amber, #b8860b); }

/* ── KPI 下钻 ── */
.kpi-drill { cursor: pointer; border-radius: 12px; transition: transform 0.14s ease; outline: none; }
.kpi-drill:hover { transform: translateY(-2px); }
.kpi-drill:focus-visible { box-shadow: 0 0 0 2px var(--primary); }

/* ── 无人化仪表 + 已执行 ── */
.auto-row {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 12px;
  margin: 12px 0 4px;
}
@media (max-width: 720px) { .auto-row { grid-template-columns: 1fr; } }
.am-h { font-size: 11.5px; font-weight: 800; letter-spacing: 0.04em; color: var(--muted); margin-bottom: 8px; }
.auto-meter { display: flex; flex-direction: column; }
.am-main { display: flex; align-items: baseline; gap: 8px; }
.am-v { font-size: 32px; font-weight: 800; color: var(--primary); letter-spacing: -1px; font-variant-numeric: tabular-nums; }
.am-l { font-size: 12px; color: var(--muted); }
.am-sub { font-size: 12px; color: var(--text-2); margin-top: 8px; }
.am-sub b { color: var(--text); font-variant-numeric: tabular-nums; }
.am-hint { font-size: 11px; color: var(--muted); margin-top: 6px; line-height: 1.5; }
.auto-feed { min-width: 0; }
.af-list { display: flex; flex-direction: column; gap: 8px; }
.af-row { display: flex; gap: 9px; align-items: flex-start; }
.af-tag {
  flex-shrink: 0; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 5px; margin-top: 1px;
}
.af-human { background: var(--vermilion-soft, rgba(200,80,60,.12)); color: var(--vermilion); }
.af-auto { background: rgba(80,160,120,.14); color: var(--ok); }
.af-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; font-size: 12px; line-height: 1.5; }
.af-body b { color: var(--text); }
.af-body span { color: var(--text-2); }
.af-empty { font-size: 12px; color: var(--muted); line-height: 1.6; }

/* ── 趋势卡 ── */
.tr-card { transition: border-color 0.14s ease, transform 0.14s ease; }
.tr-card:hover { border-color: var(--primary); transform: translateY(-2px); }
.tr-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tr-val {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.4px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.tr-lbl { font-size: 11.5px; color: var(--muted); margin: 3px 0 8px; }

/* ── 端到端流水线 ── */
.pipe {
  display: flex;
  align-items: stretch;
  flex-wrap: wrap;
  gap: 4px;
}
.pipe-node {
  flex: 1 1 88px;
  min-width: 84px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 10px;
  text-align: center;
  transition: border-color 0.14s, transform 0.14s;
}
.pipe-node:hover { border-color: var(--primary); transform: translateY(-2px); }
.pn-c {
  font-size: 21px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.5px;
  font-variant-numeric: tabular-nums;
}
.pn-l { font-size: 11px; color: var(--muted); margin-top: 3px; }
.pipe-arrow {
  display: flex;
  align-items: center;
  color: var(--muted);
  font-size: 18px;
  font-weight: 700;
  opacity: 0.55;
  padding: 0 1px;
}
.empty { text-align: center; color: var(--muted); font-size: 12.5px; padding: 20px 0; }

/* ── 晨报 ── */
.brief-live { display: flex; align-items: center; gap: 8px; }
.brief-live .dot,
.brief-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--primary);
  animation: pulse 1.1s ease-in-out infinite;
}
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

.brief-out { margin: 12px 0; }
.brief-out-h { display: flex; align-items: center; gap: 8px; font-size: 11.5px; margin-bottom: 8px; }
.brief-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-2);
}

.brief-card { min-width: 0; transition: border-color 0.14s ease, transform 0.14s ease; }
.brief-card:hover { border-color: var(--primary); transform: translateY(-2px); }
.brief-k {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 7px;
}
.brief-k .brief-dot { animation: none; }
.brief-n {
  margin-left: auto;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--bg-soft);
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  letter-spacing: 0;
}
.bk-green { color: var(--ok); }
.bk-green .brief-dot { background: var(--ok); }
.bk-gold { color: var(--gold); }
.bk-gold .brief-dot { background: var(--gold); }
.bk-red { color: var(--vermilion); }
.bk-red .brief-dot { background: var(--vermilion); }
.brief-list { list-style: none; display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; }
.brief-list li { font-size: 12.5px; color: var(--text-2); display: flex; gap: 7px; line-height: 1.55; }
.li-dot { color: var(--muted); flex-shrink: 0; }
</style>
