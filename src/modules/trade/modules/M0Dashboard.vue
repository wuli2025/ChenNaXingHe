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
import type { DashKpi } from "../types";
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
    <TSection title="经营驾驶舱" sub="澳鲸进口 · 澳洲进口分销全链路 · 数据实时汇总">
      <template #actions>
        <span class="t-pill">今日 · {{ todayStr }}</span>
        <button class="t-btn primary" :disabled="briefBusy || store.busy.value" @click="genBriefing">
          <TIcon :path="ICONS.workflow" :size="14" />
          {{ briefBusy ? "聚合各模块中…" : "一键生成今日晨报" }}
        </button>
      </template>
    </TSection>

    <!-- ═══ 6 张 KPI ═══ -->
    <div v-if="store.dashKpi.value.length" class="t-grid t-g6">
      <TKpi
        v-for="(x, i) in store.dashKpi.value"
        :key="i"
        :value="x.v"
        :label="x.l"
        :delta="x.d"
        :up="x.up"
        :acc="accOf(x)"
        :icon="x.ico"
      />
    </div>
    <TPanel v-else pad><div class="empty">暂无经营指标</div></TPanel>

    <!-- ═══ 经营趋势 ═══ -->
    <TSection title="经营趋势" sub="销售额 · 毛利率 · 现金转换周期 · 近 12 周">
      <template #actions><span class="t-pill">近 12 周</span></template>
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
          <div class="pipe-node">
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
      <b>一屏看全</b>：数字为各模块当前在办量，点击左侧功能栏进入对应模块下钻。带 ★
      的环节（报关确认 / 三单硬差异 / 缺证放行）会派单进
      <b>人工审核看板</b>，硬闸不可跳过导出。
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
