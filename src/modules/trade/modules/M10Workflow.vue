<script setup lang="ts">
/**
 * M10 工作流自动化 —— 编排心脏。
 *
 * 展示跨模块长流程的运行清单（触发 → 动作 → 等待 → 分支；可挂起 / 恢复，每步落盘）。
 * 挂起的流程高亮并可「查看人工闸」：调 store.claimReview 认领对应审核任务，推进到「审核中」。
 * 人工审核汇总：汇总 store.pendingCount 个待办闸，统一引导至中央审核看板处置。
 * 「报关触发说明 / 查看挂起流程」两个说明动作真接线 store.runChat（对话坞输出）。
 *
 * 零 props；数据与动作全部来自单例 store（ref → .value）。
 */
import { computed } from "vue";
import { useTradeStore } from "../useTradeStore";
import TSection from "../components/TSection.vue";
import TPanel from "../components/TPanel.vue";
import TBadge from "../components/TBadge.vue";
import TKpi from "../components/TKpi.vue";
import { ICONS } from "../types";
import type { WorkflowRun, ReviewTask } from "../types";

const store = useTradeStore();

/** state → TBadge tone。 */
function stateTone(state: string): "green" | "amber" | "blue" {
  if (state === "完成") return "green";
  if (state === "挂起") return "amber";
  return "blue";
}

/** 进度条填充色随状态变化（完成=绿，挂起=金，运行=主色）。 */
function barColor(state: string): string {
  if (state === "完成") return "var(--ok)";
  if (state === "挂起") return "var(--gold)";
  return "var(--primary)";
}

/** 挂起的流程排前、其余保持原序，便于人工优先处理。 */
const orderedFlows = computed<WorkflowRun[]>(() => {
  const list = store.workflows.value;
  const suspended = list.filter((w) => w.state === "挂起");
  const others = list.filter((w) => w.state !== "挂起");
  return [...suspended, ...others];
});

const runningCount = computed(() => store.workflows.value.filter((w) => w.state === "运行").length);
const suspendedCount = computed(() => store.workflows.value.filter((w) => w.state === "挂起").length);

/** 当前待人工介入的审核任务（挂起流程的落点）。 */
const pendingReviews = computed<ReviewTask[]>(() =>
  store.reviewTasks.value.filter((t) => t.status === "pending" || t.status === "in_review")
);

/** 尚未认领（待审核）的人工闸数量 —— 驱动「查看人工闸」按钮可用态。 */
const claimableCount = computed(() => pendingReviews.value.filter((t) => t.status === "pending").length);

/** 「查看人工闸」：认领一条最相关的待审核任务，把它推进「审核中」。 */
function claimNextGate() {
  const next = pendingReviews.value.find((t) => t.status === "pending");
  if (next) store.claimReview(next.id);
}

/** 让 Claude 讲清「哪些工作流正在挂起、分别在等什么」——真接线 runChat。 */
function explainSuspended() {
  if (store.busy.value) return;
  store.runChat("工作流自动化", "编排心脏 · 挂起 / 恢复", "有哪些工作流正在挂起等待，分别在等什么？请逐条说明触发条件与恢复条件。", false)
    .catch((e) => store.log("error", `工作流说明生成失败：${(e as Error).message || String(e)}`));
}

/** 让 Claude 讲清「报关草稿 ETA-5d 触发」的编排链路。 */
function explainCustomsTrigger() {
  if (store.busy.value) return;
  store.runChat("工作流自动化", "编排心脏 · 挂起 / 恢复", "报关草稿 ETA-5d 触发是怎么编排的？触发 → 动作 → 等待 → 分支逐节点说明。", false)
    .catch((e) => store.log("error", `报关触发说明生成失败：${(e as Error).message || String(e)}`));
}

/** 示意流程图节点（触发 → 聚合 → 归类 → 校验 → 人工闸 → 分支）。 */
interface FlowNode {
  label: string;
  desc: string;
  kind: "trigger" | "action" | "wait" | "gate" | "branch";
}
const diagram: FlowNode[] = [
  { label: "触发", desc: "ETA-5d / 定时 / 事件", kind: "trigger" },
  { label: "动作", desc: "聚合 PO·物流·LCV", kind: "action" },
  { label: "动作", desc: "LLM 归类 + 税费", kind: "action" },
  { label: "等待", desc: "挂起落盘 · 供应商回信", kind: "wait" },
  { label: "人工闸", desc: "审核看板确认", kind: "gate" },
  { label: "分支", desc: "放行 / 驳回 / 重试", kind: "branch" },
];
function nodeTone(kind: FlowNode["kind"]): "blue" | "gold" | "amber" | "green" | "purple" {
  if (kind === "trigger") return "blue";
  if (kind === "action") return "purple";
  if (kind === "wait") return "amber";
  if (kind === "gate") return "gold";
  return "green";
}
</script>

<template>
  <div class="t-view-anim">
    <!-- 能力说明：编排心脏 -->
    <div class="t-note info">
      <b>编排心脏：</b>触发 → 动作 → 等待 → 分支；可挂起 / 恢复（<b>每步落盘</b>，供应商 3 天后回信不丢）；审批 / 重试 / 幂等。
      跨模块长流程统一在此编排，所有「人工闸」落到<b>中央审核看板</b>处理。
    </div>

    <!-- KPI 概览 -->
    <div class="t-grid t-g4">
      <TKpi
        :value="String(store.workflows.value.length)"
        label="活跃流程"
        acc="blue"
        :icon="ICONS.workflow"
      />
      <TKpi
        :value="String(runningCount)"
        label="运行中"
        acc="green"
      />
      <TKpi
        :value="String(suspendedCount)"
        label="挂起等待"
        acc="amber"
      />
      <TKpi
        :value="String(store.pendingCount.value)"
        label="待办人工闸"
        acc="gold"
        :icon="ICONS.review"
      />
    </div>

    <!-- 示意流程图 -->
    <TSection
      title="编排示意"
      sub="触发 → 动作 → 等待 → 分支 · 每节点可挂起落盘并恢复"
    />
    <TPanel pad>
      <div class="flow-diagram">
        <template
          v-for="(n, i) in diagram"
          :key="i"
        >
          <div
            class="flow-node"
            :class="'fn-' + n.kind"
          >
            <TBadge :tone="nodeTone(n.kind)">
              {{ n.label }}
            </TBadge>
            <div class="fn-desc">
              {{ n.desc }}
            </div>
          </div>
          <div
            v-if="i < diagram.length - 1"
            class="flow-link"
          >
            <span class="fl-line" />
            <span class="fl-arrow">▸</span>
          </div>
        </template>
      </div>
      <div
        class="t-note ok"
        style="margin-bottom: 0"
      >
        <b>幂等 + 可恢复：</b>「等待」节点把状态落盘，进程重启或供应商延迟回信都不丢上下文；
        「人工闸」阻断自动流转，直至审核看板给出放行 / 驳回。
      </div>
    </TPanel>

    <!-- 流程运行清单 -->
    <TSection
      title="流程运行清单"
      sub="跨模块长流程 · 定时采集 / 报关触发 / 建联挂起 / 临期预警"
    >
      <template #actions>
        <button
          class="t-btn sm"
          :disabled="store.busy.value"
          @click="explainCustomsTrigger"
        >
          {{ store.busy.value ? "运行中…" : "报关触发说明" }}
        </button>
        <button
          class="t-btn sm primary"
          :disabled="store.busy.value"
          @click="explainSuspended"
        >
          {{ store.busy.value ? "运行中…" : "查看挂起流程" }}
        </button>
      </template>
    </TSection>

    <div
      v-if="orderedFlows.length"
      class="flow-list"
    >
      <TPanel
        v-for="w in orderedFlows"
        :key="w.name"
        pad
      >
        <div
          class="wf-card"
          :class="{ suspended: w.state === '挂起' }"
        >
          <div class="wf-head">
            <b class="wf-name">{{ w.name }}</b>
            <TBadge :tone="stateTone(w.state)">
              {{ w.state }}
            </TBadge>
            <span class="t-muted t-mono wf-time">{{ w.updated }}</span>
          </div>
          <div class="wf-step">
            当前步骤：<b>{{ w.step }}</b>
          </div>
          <div class="wf-bar-row">
            <div class="t-bar wf-bar">
              <span :style="{ width: Math.max(w.pct, 2) + '%', background: barColor(w.state) }" />
            </div>
            <span class="wf-pct t-mono">{{ w.pct }}%</span>
          </div>

          <!-- 挂起流程：高亮提示 + 查看人工闸 -->
          <div
            v-if="w.state === '挂起'"
            class="wf-suspend"
          >
            <div class="t-note warn wf-note">
              <b>已挂起落盘：</b>此流程停在人工闸，等待审核看板放行；上下文已持久化，恢复后从本步继续。
            </div>
            <button
              class="t-btn sm gold wf-gate-btn"
              :disabled="!claimableCount"
              :title="claimableCount ? '认领一条待办人工闸并推进到审核中' : '当前没有待认领的人工闸'"
              @click="claimNextGate"
            >
              查看人工闸<span
                v-if="claimableCount"
                class="wf-gate-pip"
              >{{ claimableCount }}</span>
            </button>
          </div>
        </div>
      </TPanel>
    </div>
    <TPanel
      v-else
      pad
    >
      <div class="wf-empty">
        暂无运行中的工作流。触发条件命中后（ETA-5d / 定时 / 事件），流程将自动入列并在此显示。
      </div>
    </TPanel>

    <!-- 人工审核汇总 -->
    <TSection
      title="人工审核汇总"
      sub="所有人工闸的统一入口 · 在审核看板逐条处置"
    />
    <div class="t-note warn">
      当前有 <b>{{ store.pendingCount.value }}</b> 个待办人工闸（待审核 + 审核中）。
      工作流的每一个「★人工闸」都不在流程内直接决策，而是<b>统一进审核看板</b>处理（放行 / 驳回 / 认领 / 重开）。
    </div>

    <TPanel v-if="pendingReviews.length">
      <table class="t-table">
        <thead>
          <tr>
            <th>审核任务</th>
            <th>来源模块</th>
            <th>风险</th>
            <th>状态</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="t in pendingReviews"
            :key="t.id"
            class="rv-row"
          >
            <td>
              <b>{{ t.title }}</b>
              <div class="t-muted rv-sum">
                {{ t.summary }}
              </div>
            </td>
            <td class="t-mono">
              {{ t.mod.toUpperCase() }}
            </td>
            <td>
              <TBadge :tone="t.risk === 'hard' ? 'red' : t.risk === 'high' ? 'amber' : 'gray'">
                {{ t.risk === 'hard' ? '硬闸' : t.risk === 'high' ? '高' : t.risk === 'low' ? '低' : '普通' }}
              </TBadge>
            </td>
            <td>
              <TBadge :tone="t.status === 'in_review' ? 'blue' : 'gold'">
                {{ t.status === 'in_review' ? '审核中' : '待审核' }}
              </TBadge>
            </td>
            <td>
              <button
                v-if="t.status === 'pending'"
                class="t-btn sm"
                @click="store.claimReview(t.id)"
              >
                认领
              </button>
              <span
                v-else
                class="t-muted rv-claimed"
              >已认领</span>
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>
    <TPanel
      v-else
      pad
    >
      <div class="wf-empty">
        当前没有待办人工闸，所有流程均可自动流转。
      </div>
    </TPanel>
  </div>
</template>

<style scoped>
/* 流程图 */
.flow-diagram {
  display: flex;
  align-items: stretch;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 14px;
}
.flow-node {
  flex: 1 1 120px;
  min-width: 110px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-soft);
  transition: border-color 0.14s, box-shadow 0.14s, transform 0.14s;
}
.flow-node:hover {
  border-color: var(--primary);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  transform: translateY(-1px);
}
.flow-node.fn-gate { border-color: rgba(167, 140, 79, 0.4); background: rgba(167, 140, 79, 0.08); }
.flow-node.fn-gate:hover { border-color: var(--gold); }
.flow-node.fn-wait { border-color: rgba(210, 150, 40, 0.28); }
.fn-desc { font-size: 11px; color: var(--muted); line-height: 1.4; }
.flow-link {
  display: flex;
  align-items: center;
  align-self: center;
  color: var(--muted);
}
.fl-line { width: 8px; height: 1px; background: var(--border-strong); }
.fl-arrow { font-size: 12px; line-height: 1; }

/* 流程清单 */
.flow-list { display: flex; flex-direction: column; gap: 10px; }
.wf-card { display: flex; flex-direction: column; gap: 8px; }
.wf-card.suspended {
  position: relative;
  margin: -2px -4px;
  padding: 2px 4px 2px 12px;
  border-left: 3px solid var(--gold);
  border-radius: 4px;
}
.wf-head { display: flex; align-items: center; gap: 10px; }
.wf-name { flex: 1; min-width: 0; color: var(--text); font-weight: 700; }
.wf-time { font-size: 10.5px; }
.wf-step { font-size: 12px; color: var(--text-2); }
.wf-bar-row { display: flex; align-items: center; gap: 10px; }
.wf-bar { flex: 1; }
.wf-pct { font-size: 11px; color: var(--muted); min-width: 34px; text-align: right; }
.wf-suspend {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 2px;
}
.wf-note { flex: 1; min-width: 200px; margin: 0; }
.wf-empty { font-size: 12.5px; color: var(--muted); padding: 8px 2px; line-height: 1.6; }

/* 「查看人工闸」按钮 + 待办角标 */
.wf-gate-btn { position: relative; }
.wf-gate-pip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  margin-left: 5px;
  border-radius: 999px;
  background: var(--gold);
  color: #fff;
  font-size: 9.5px;
  font-weight: 800;
  line-height: 1;
}
/* 禁用态不响应 hover（避免与 .t-btn:hover 冲突产生误导性高亮） */
.t-btn:disabled:hover { background: var(--panel); border-color: var(--border-strong); }
.t-btn.gold:disabled:hover { background: rgba(167, 140, 79, 0.14); border-color: rgba(167, 140, 79, 0.4); }

/* 审核汇总表 */
.rv-row { transition: background 0.14s; }
.rv-row:hover { background: var(--panel-hover); }
.rv-sum { font-size: 11px; margin-top: 3px; line-height: 1.5; max-width: 520px; }
.rv-claimed { font-size: 11px; }
</style>
