<script setup lang="ts">
/**
 * E0 经营驾驶舱 —— 晨报 · KPI · 三块简报 · AI 代理编制 · 无人化度量。
 *
 * 零 props。数据全部来自 useErpStore（单例）。
 *  - KPI 六卡：store.dashKpi（GMV / 待审批 / 无人化率 / 库存 / 履约 / 申报）。
 *  - 「经营晨报」：store.runBrief() 让总管代理汇总经营快照，Markdown 本地渲染。
 *  - 三块简报：store.briefing（代理做了什么 / 今日待你决策 / 风险预警），实时派生。
 *  - AI 代理编制：AGENTS 常量 —— 8 个代理的职责、自治边界与「哪些必须人工」总览。
 *  - 无人化度量：store.autonomyStats（auto/human 台账比）。
 */
import { ref, computed } from "vue";
import { useErpStore } from "../useErpStore";
import { AGENTS } from "../types";
import { renderMarkdown } from "../../../lib/markdown";
import TSection from "../../trade/components/TSection.vue";
import TPanel from "../../trade/components/TPanel.vue";
import TKpi from "../../trade/components/TKpi.vue";

const store = useErpStore();

/* dashKpi 是 computed 数组，acc 字面量被 TS 拓宽为 string —— 这里收窄回 TKpi 的联合类型。 */
type KpiAcc = "gold" | "blue" | "green" | "amber" | "red" | "purple";
function kpiAcc(a: string): KpiAcc {
  return a as KpiAcc;
}

/* ── 经营晨报：总管代理产出 Markdown，存本地 ref 渲染 ── */
const briefMd = ref("");
const briefHtml = computed(() => (briefMd.value ? renderMarkdown(briefMd.value, { enhance: true }) : ""));

async function genBrief() {
  if (store.busy.value) return;
  try {
    const md = await store.runBrief();
    briefMd.value = md;
  } catch (e) {
    store.log("error", `晨报生成失败：${(e as Error).message}`);
  }
}
</script>

<template>
  <div class="e0 t-view-anim">
    <!-- 分流说明：驾驶舱本身只读观察，动作的自动/人工边界一目了然 -->
    <div class="e-gates">
      <b>本页分流</b>
      <span class="e-auto">自动</span> 晨报生成、简报/KPI 聚合 —— AI 只读汇总，直接产出；
      <span class="e-human soft">需审批</span> 「今日待你决策」里的卡片全部要去审批中心核准；
      <span class="e-human">强制人工</span> 付款 / 报税提交 / 出口退税 —— AI 永远只备料，见下方代理编制。
    </div>

    <!-- KPI 六卡 -->
    <div class="t-grid t-g6">
      <TKpi
        v-for="k in store.dashKpi.value"
        :key="k.l"
        :value="k.v"
        :label="k.l"
        :delta="k.d"
        :up="k.up"
        :acc="kpiAcc(k.acc)"
        :icon="k.ico"
      />
    </div>

    <!-- 经营晨报 -->
    <TSection
      title="经营晨报"
      sub="总管代理汇总经营快照 → Markdown 晨报（生成过程见右侧 Console）"
    >
      <template #actions>
        <button
          class="t-btn sm primary"
          :disabled="store.busy.value"
          @click="genBrief"
        >
          {{ store.busy.value ? "生成中…" : "生成晨报" }}
        </button>
      </template>
    </TSection>
    <TPanel pad>
      <div
        v-if="briefHtml"
        class="md-body e0-brief"
        v-html="briefHtml"
      />
      <div
        v-else
        class="t-muted e0-hint"
      >
        点右上「生成晨报」——总管代理会汇总本月 GMV、待审批硬闸、库存/物流/对账/申报异常，产出一份可直接过目的经营晨报。
      </div>
    </TPanel>

    <!-- 三块简报（实时派生，无需生成） -->
    <TSection
      title="今日简报"
      sub="代理动态 · 待你决策 · 风险预警 —— 由台账与审批队列实时派生"
    />
    <div class="t-grid t-g3">
      <TPanel
        v-for="b in store.briefing.value"
        :key="b.k"
        pad
      >
        <div class="e0-bk t-row">
          <b>{{ b.k }}</b>
          <button
            v-if="b.k === '今日待你决策'"
            class="t-btn sm gold"
            @click="store.go('review')"
          >
            去审批中心
          </button>
        </div>
        <ul class="e0-list">
          <li
            v-for="(it, i) in b.items"
            :key="i"
          >
            {{ it }}
          </li>
        </ul>
      </TPanel>
    </div>

    <!-- AI 代理编制：哪些需要人工介入的总览 -->
    <TSection
      title="AI 代理编制"
      sub="8 个代理 · 职责 · 自治边界 · 强制人工动作总览"
    />
    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>代理</th>
            <th>职责</th>
            <th>自治边界</th>
            <th>人工介入</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="a in AGENTS"
            :key="a.key"
          >
            <td><b>{{ a.name }}</b></td>
            <td>{{ a.duty }}</td>
            <td class="t-muted">
              {{ a.boundary }}
            </td>
            <td>
              <span
                v-if="a.humanNote"
                class="e-human"
              >{{ a.humanNote }}</span>
              <span
                v-else
                class="e-auto"
              >边界内自动</span>
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>

    <!-- 无人化度量 -->
    <TSection
      title="无人化度量"
      sub="执行台账 auto / human 比 —— 有界自治的健康指标"
    />
    <TPanel pad>
      <div class="t-row e0-auto">
        <span class="t-pill">累计执行 {{ store.autonomyStats.value.total }}</span>
        <span class="t-pill">自动 {{ store.autonomyStats.value.auto }}</span>
        <span class="t-pill">人工 {{ store.autonomyStats.value.human }}</span>
        <b class="e0-rate">{{ store.autonomyStats.value.autoRate }}%</b>
      </div>
      <div class="t-bar e0-bar">
        <span :style="{ width: store.autonomyStats.value.autoRate + '%' }" />
      </div>
      <div class="t-muted e0-note">
        无人化率 = 自动执行 / 全部执行。数字越高说明策略引擎替你消化的动作越多；强制人工清单（付款/报税/退税）永远计入人工，不参与「自动化」。
      </div>
    </TPanel>
  </div>
</template>

<style scoped>
.e0-hint { font-size: 12px; line-height: 1.7; }
.e0-brief { font-size: 13px; line-height: 1.75; }

/* 简报块：标题行 + 列表 */
.e0-bk { justify-content: space-between; margin-bottom: 8px; font-size: 12.5px; }
.e0-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
.e0-list li { font-size: 12px; line-height: 1.6; color: var(--text-2); }

/* 无人化度量 */
.e0-auto { flex-wrap: wrap; }
.e0-rate { margin-left: auto; font-size: 18px; color: var(--ok); font-variant-numeric: tabular-nums; }
.e0-bar { margin: 10px 0 8px; }
.e0-note { font-size: 11.5px; line-height: 1.65; }
</style>
