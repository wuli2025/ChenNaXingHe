<script setup lang="ts">
/**
 * E8 · 报税合规 —— 申报日历驱动：国内增值税 / 德国 VAT / 出口退税 / 所得税预缴。
 *
 * 零 props。数据/动作全部来自 useErpStore（状态皆 ref，须 .value）。
 *  - 「税务官检查」→ store.runTaxCheck()：AI 生成申报前检查报告（.e-auto），
 *    资料齐 + 检查通过 → 状态置 ready 并自动入提交确认闸。
 *  - 「提交确认」→ store.gateFilingSubmit()：tax-filing / export-rebate 属
 *    HUMAN_ONLY_ACTIONS，策略引擎无条件 review + hardGate —— 对税局的任何提交永远人工。
 */
import { ref, computed } from "vue";
import { useErpStore } from "../useErpStore";
import type { TaxFiling, FilingStatus } from "../types";
import TSection from "../../trade/components/TSection.vue";
import TPanel from "../../trade/components/TPanel.vue";
import TBadge from "../../trade/components/TBadge.vue";

const store = useErpStore();

/* ── 申报卡按截止日升序：最近到期置顶，已提交/已归档沉底 ── */
const DONE = new Set<FilingStatus>(["submitted", "archived"]);
const sortedFilings = computed(() =>
  store.filings.value.slice().sort((a, b) => {
    const ad = DONE.has(a.status) ? 1 : 0;
    const bd = DONE.has(b.status) ? 1 : 0;
    return ad !== bd ? ad - bd : a.due.localeCompare(b.due);
  })
);

/* ── 状态 → 徽标（申报生命周期） ── */
const STATUS: Record<FilingStatus, { label: string; tone: "gray" | "amber" | "green" | "blue" }> = {
  upcoming: { label: "待启动", tone: "gray" },
  preparing: { label: "准备中", tone: "amber" },
  ready: { label: "就绪待提交", tone: "green" },
  submitted: { label: "已提交", tone: "blue" },
  archived: { label: "已归档", tone: "gray" },
};

/* ── 地区 → 徽标色 ── */
function regionTone(region: string): "blue" | "purple" | "gold" | "gray" {
  return region === "国内" ? "blue" : region === "德国" ? "purple" : region === "美国" ? "gold" : "gray";
}

/* ── 截止日判定：已过期标「已逾期」，14 天内标「临近」，都走红色高亮 ── */
function dueState(f: TaxFiling): "" | "soon" | "overdue" {
  if (f.status === "submitted" || f.status === "archived") return "";
  const diff = new Date(f.due + "T23:59:59").getTime() - Date.now();
  if (diff < 0) return "overdue";
  return diff < 14 * 86400000 ? "soon" : "";
}

/* ── 动作：申报前检查（AI 自动） ── */
async function check(f: TaxFiling) {
  if (store.busy.value) return;
  await store.runTaxCheck(f.id);
}

/* ── 动作：提交确认 —— 入强制人工闸，卡片内提示去审批中心 ── */
const gatedId = ref("");
function submitGate(f: TaxFiling) {
  store.gateFilingSubmit(f.id);
  gatedId.value = f.id;
}
</script>

<template>
  <div class="e8-tax t-view-anim">
    <!-- 分流说明：AI 只做到申报表就绪，提交永远人工 -->
    <div class="e-gates">
      <span class="e-auto">自动</span>
      <span>申报表准备 · 数据勾稽 · 申报前检查报告由 AI 税务官生成</span>
      <span class="e-human">强制人工</span>
      <span>
        <b>申报提交与退税提交永远需要你亲自确认</b> —— AI 只做到申报表就绪，
        对税局的任何提交动作无条件进硬闸，参数中心也无法改成自动。
      </span>
    </div>

    <!-- 申报日历：一事项一卡 -->
    <TSection
      title="申报日历"
      sub="国内增值税 · 德国 VAT · 出口退税 · 所得税预缴 · 截止日驱动"
    >
      <template #actions>
        <span class="t-pill">在办 {{ store.dueFilings.value.length }}</span>
        <span class="t-pill">共 {{ store.filings.value.length }} 项</span>
      </template>
    </TSection>

    <div class="t-grid t-g2">
      <TPanel
        v-for="f in sortedFilings"
        :key="f.id"
        pad
      >
        <!-- 卡头：名称 + 地区 + 状态 -->
        <div class="t-row card-head">
          <b class="f-name">{{ f.name }}</b>
          <TBadge :tone="regionTone(f.region)">
            {{ f.region }}
          </TBadge>
          <TBadge :tone="STATUS[f.status].tone">
            {{ STATUS[f.status].label }}
          </TBadge>
        </div>

        <!-- 期间 / 截止 / 应缴 -->
        <div class="f-meta">
          <span>期间 <b class="t-mono">{{ f.period }}</b></span>
          <span :class="{ 'due-hot': dueState(f) !== '' }">
            截止 <b class="t-mono">{{ f.due }}</b><template v-if="dueState(f) === 'overdue'">（已逾期）</template><template v-else-if="dueState(f) === 'soon'">（临近）</template>
          </span>
          <span v-if="f.amountDue !== undefined">
            应缴 <b class="t-mono">{{ f.currency }} {{ f.amountDue.toLocaleString() }}</b>
          </span>
        </div>

        <!-- 申报前检查报告要点 -->
        <ul
          v-if="f.checkNotes && f.checkNotes.length"
          class="f-notes"
        >
          <li
            v-for="(n, i) in f.checkNotes"
            :key="i"
          >
            {{ n }}
          </li>
        </ul>

        <!-- 资料包配齐清单 -->
        <div
          v-if="f.docsReady && f.docsReady.length"
          class="f-docs"
        >
          <span
            v-for="doc in f.docsReady"
            :key="doc.name"
            class="doc-chip"
            :class="doc.ok ? 'ok' : 'miss'"
          >
            {{ doc.ok ? "✓" : "✗" }} {{ doc.name }}
          </span>
        </div>

        <!-- 动作区：检查（AI）+ 提交（强制人工闸） -->
        <div class="t-row card-actions">
          <button
            v-if="f.status !== 'submitted' && f.status !== 'archived'"
            class="t-btn sm"
            :disabled="store.busy.value"
            @click="check(f)"
          >
            税务官检查
          </button>
          <button
            v-if="f.status === 'ready'"
            class="t-btn sm gold"
            @click="submitGate(f)"
          >
            提交确认
          </button>
          <span
            v-if="f.status === 'submitted'"
            class="t-muted done-txt"
          >已提交，待回执归档</span>
        </div>
        <div
          v-if="gatedId === f.id"
          class="t-note ok gate-tip"
        >
          已入<b>强制人工提交闸</b>，去审批中心确认后才会真正提交。
        </div>
      </TPanel>
    </div>

    <!-- 定位与免责 -->
    <div class="t-note warn">
      <b>定位说明：</b>本系统是<b>备税助手</b> —— 负责数据勾稽、申报表准备与截止日提醒，
      不替代持牌税务师 / 税务代理的法律责任；出口退税、德国 VAT 等重大或存疑事项，请在提交前咨询专业人士。
    </div>
  </div>
</template>

<style scoped>
/* 卡头与元信息 */
.card-head { align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.f-name { font-size: 13px; margin-right: auto; }
.f-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 11.5px;
  color: var(--text-2);
  margin-bottom: 8px;
}
.due-hot { color: var(--vermilion); font-weight: 700; }
/* 检查要点 */
.f-notes {
  margin: 0 0 8px;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-2);
}
/* 资料包清单：✓/✗ 小片 */
.f-docs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.doc-chip {
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  white-space: nowrap;
}
.doc-chip.ok { color: var(--ok); border-color: rgba(60, 160, 110, 0.35); background: var(--ok-soft, rgba(60, 160, 110, 0.1)); }
.doc-chip.miss { color: var(--vermilion); border-color: rgba(200, 80, 60, 0.35); background: rgba(200, 80, 60, 0.08); }
/* 动作区 */
.card-actions { gap: 8px; align-items: center; }
.done-txt { font-size: 11px; }
.gate-tip { margin: 10px 0 0; }
</style>
