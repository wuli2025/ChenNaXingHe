<script setup lang="ts">
/**
 * 人工审核看板 —— 全站每一个「人工闸」汇成一条流水线（Jira/Linear 式四列看板）。
 *
 * 数据源：store.reviewColumns.value = { pending, in_review, approved, rejected }。
 * 每张卡片是一个 ReviewTask，来自各模块的 enqueueReview（报关确认、三单硬差异、
 * 缺证放行、建联外发、报价回写、对账匹配、补货确认…）。
 * 接线的 store 动作：claimReview / approveReview / rejectReview / resetReview。
 * 全部走「人工闸」语义——这是给老板看的「每个要人工审核的流程都在这条流水线里」的门面。
 */
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useTradeStore } from "../useTradeStore";
import {
  REVIEW_COLUMNS,
  REVIEW_KIND_META,
  MODULES,
} from "../types";
import type { ReviewTask, ReviewRisk, ReviewStatus } from "../types";
import TSection from "../components/TSection.vue";
import TBadge from "../components/TBadge.vue";
import TIcon from "../components/TIcon.vue";
import { ICONS } from "../types";

const store = useTradeStore();

/* ── 风险排序权重（hard 置顶） ── */
const RISK_ORDER: Record<ReviewRisk, number> = { hard: 0, high: 1, normal: 2, low: 3 };
const RISK_META: Record<ReviewRisk, { label: string; tone: "red" | "amber" | "blue" | "gray" }> = {
  hard: { label: "硬闸", tone: "red" },
  high: { label: "高风险", tone: "amber" },
  normal: { label: "常规", tone: "blue" },
  low: { label: "低风险", tone: "gray" },
};

/** 模块名映射（M4 报关单撰写…）。 */
const MOD_NAME: Record<string, string> = Object.fromEntries(
  MODULES.map((m) => [m.id, `${m.no} · ${m.name}`])
);

/** 分列 + pending 按风险排序（hard 置顶），其余保持入列顺序。 */
function sortedCol(status: ReviewStatus): ReviewTask[] {
  const list = [...store.reviewColumns.value[status]];
  if (status === "pending" || status === "in_review") {
    list.sort((a, b) => {
      const r = RISK_ORDER[a.risk] - RISK_ORDER[b.risk];
      return r !== 0 ? r : b.createdAt - a.createdAt;
    });
  }
  return list;
}

const columns = computed(() =>
  REVIEW_COLUMNS.map((c) => ({ ...c, tasks: sortedCol(c.key) }))
);

/* ── 主编工作台：键盘流（J/K 移动 · A 通过 · R 驳回重跑 · C 认领） ── */
const actionable = computed<ReviewTask[]>(() => [...sortedCol("pending"), ...sortedCol("in_review")]);
const selId = ref<string>("");
const selectedId = computed(() => {
  const list = actionable.value;
  if (list.some((t) => t.id === selId.value)) return selId.value;
  return list[0]?.id || "";
});
function moveSel(delta: number) {
  const list = actionable.value;
  if (!list.length) return;
  const cur = list.findIndex((t) => t.id === selectedId.value);
  const next = Math.max(0, Math.min(list.length - 1, (cur < 0 ? 0 : cur) + delta));
  selId.value = list[next].id;
  // 滚动到可见
  requestAnimationFrame(() => {
    document.querySelector(`[data-rvid="${selId.value}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}
function onKey(e: KeyboardEvent) {
  // 仅在审核看板为当前视图时响应快捷键，避免在其他模块误触 A/R 等单键。
  if (store.view.value !== "review") return;
  const el = document.activeElement as HTMLElement | null;
  if (el && (/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable)) return;
  if (rejecting.value) return;
  const k = e.key.toLowerCase();
  const id = selectedId.value;
  // 导航（j/k）随时可用；决策动作（a/r/c）与按钮一致，AI 忙时禁用。
  if (k === "j") { moveSel(1); e.preventDefault(); }
  else if (k === "k") { moveSel(-1); e.preventDefault(); }
  else if (store.busy.value) { return; }
  else if (k === "a" && id) { store.approveReview(id); e.preventDefault(); }
  else if (k === "r" && id) { openReject(id); e.preventDefault(); }
  else if (k === "c" && id) { store.claimReview(id); e.preventDefault(); }
}
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));

/* 点击卡片选中 —— 仅待办/审核中的卡可成为键盘选中项，避免选中已决卡后 A 键误核准他卡。 */
function selectCard(t: ReviewTask) {
  if (t.status === "pending" || t.status === "in_review") selId.value = t.id;
}

/* ── 任务来源徽标 ── */
const ORIGIN_META: Record<string, { label: string; tone: "blue" | "green" | "gray" }> = {
  ai: { label: "AI 待审", tone: "blue" },
  auto: { label: "自动放行", tone: "green" },
  manual: { label: "人工发起", tone: "gray" },
};

/* ── 顶部统计 ── */
const pending = computed(() => store.reviewColumns.value.pending.length);
const inReview = computed(() => store.reviewColumns.value.in_review.length);
const hardPending = computed(() =>
  store.reviewColumns.value.pending.filter((t) => t.hardGate || t.risk === "hard").length
);
const decidedToday = computed(() => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  return store.reviewTasks.value.filter(
    (t) => t.decidedAt != null && t.decidedAt >= t0
  ).length;
});

/* ── 驳回批注弹层 ── */
const rejecting = ref<string | null>(null);
const rejectNote = ref("");

function openReject(id: string) {
  rejecting.value = id;
  rejectNote.value = "";
}
function confirmReject() {
  if (rejecting.value) {
    store.rejectReview(rejecting.value, rejectNote.value.trim() || undefined);
    rejecting.value = null;
    rejectNote.value = "";
  }
}
function cancelReject() {
  rejecting.value = null;
  rejectNote.value = "";
}

/* ── 时间格式化 ── */
function fmtTime(ts?: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `今天 ${hh}:${mm}`;
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mo}-${dd} ${hh}:${mm}`;
}

/* ── 置信度提取（facts value 里若含「NN%」则渲染一条置信度条） ── */
function factConf(v: string): number | null {
  const m = /(\d{1,3})\s*%/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}
function confTone(n: number): string {
  return n >= 90 ? "hi" : n >= 75 ? "mid" : "lo";
}

/* ── 空态文案 ── */
const EMPTY_TEXT: Record<ReviewStatus, string> = {
  pending: "暂无待审任务",
  in_review: "暂无处理中任务",
  approved: "暂无已通过记录",
  rejected: "暂无已驳回记录",
};
</script>

<template>
  <div class="t-view-anim rv-root">
    <TSection
      title="人工审核看板"
      sub="全链路每一个人工闸，汇成一条可追溯的审核流水线"
    >
      <template #actions>
        <span class="rv-kbd">
          <b>J</b>/<b>K</b> 移动 · <b>A</b> 通过 · <b>R</b> 驳回重跑 · <b>C</b> 认领
        </span>
        <span class="t-pill">共 {{ store.reviewTasks.value.length }} 项</span>
      </template>
    </TSection>

    <!-- 顶部统计条 -->
    <div class="rv-stats">
      <div class="rv-stat">
        <span class="rv-stat-v">{{ pending }}</span>
        <span class="rv-stat-l">待审核</span>
        <span
          v-if="hardPending"
          class="rv-stat-hard"
        >含 {{ hardPending }} 硬闸</span>
      </div>
      <div class="rv-stat">
        <span class="rv-stat-v">{{ inReview }}</span>
        <span class="rv-stat-l">审核中</span>
      </div>
      <div class="rv-stat">
        <span class="rv-stat-v">{{ decidedToday }}</span>
        <span class="rv-stat-l">今日已决</span>
      </div>
      <div class="rv-stat rv-stat-note">
        <TIcon
          :path="ICONS.review"
          :size="15"
        />
        <span>来自选品、建联、报关、合规、物流、补货、报价、对账等模块的人工闸，均在此统一决策。</span>
      </div>
    </div>

    <div
      v-if="hardPending"
      class="t-note danger"
    >
      <b>{{ hardPending }} 项硬闸待处理</b> —— 硬差异 / 缺证类任务不可跳过导出，请优先处理（已置顶）。
    </div>

    <!-- 四列看板 -->
    <div class="rv-board">
      <div
        v-for="col in columns"
        :key="col.key"
        class="rv-col"
        :class="`col-${col.key}`"
      >
        <div class="rv-col-head">
          <div class="rv-col-title">
            <span
              class="rv-col-dot"
              :class="`dot-${col.key}`"
            />
            {{ col.label }}
            <span class="rv-col-count">{{ col.tasks.length }}</span>
          </div>
          <span class="rv-col-hint">{{ col.hint }}</span>
        </div>

        <div class="rv-col-body">
          <!-- 空态 -->
          <div
            v-if="!col.tasks.length"
            class="rv-empty"
          >
            <TIcon
              :path="ICONS.review"
              :size="18"
            />
            <span>{{ EMPTY_TEXT[col.key] }}</span>
          </div>

          <!-- 卡片 -->
          <article
            v-for="t in col.tasks"
            :key="t.id"
            :data-rvid="t.id"
            class="rv-card"
            :class="{ 'is-hard': t.hardGate || t.risk === 'hard', 'is-sel': t.id === selectedId && (t.status === 'pending' || t.status === 'in_review') }"
            @click="selectCard(t)"
          >
            <!-- 卡头：来源模块 + 来源 + 风险 -->
            <div class="rv-card-top">
              <span class="rv-card-src">
                <span class="rv-card-mod">{{ MOD_NAME[t.mod] || t.mod }}</span>
                <span class="rv-card-kind">{{ REVIEW_KIND_META[t.kind]?.label || t.kind }}</span>
              </span>
              <span class="rv-badges">
                <TBadge
                  v-if="t.origin && ORIGIN_META[t.origin]"
                  :tone="ORIGIN_META[t.origin].tone"
                >{{ ORIGIN_META[t.origin].label }}</TBadge>
                <TBadge :tone="RISK_META[t.risk].tone">{{ RISK_META[t.risk].label }}</TBadge>
              </span>
            </div>

            <!-- 硬闸醒目标记 -->
            <div
              v-if="t.hardGate"
              class="rv-hardgate"
            >
              <TIcon
                :path="ICONS.compliance"
                :size="13"
              />
              硬闸 · 拦截导出，必须处理
            </div>

            <h4 class="rv-card-title">
              {{ t.title }}
            </h4>
            <p class="rv-card-sum">
              {{ t.summary }}
            </p>

            <!-- facts 小表（value 含百分比时附置信度条） -->
            <dl
              v-if="t.facts.length"
              class="rv-facts"
            >
              <div
                v-for="(f, i) in t.facts"
                :key="i"
                class="rv-fact"
                :class="{ warn: f.warn }"
              >
                <div class="rv-fact-line">
                  <dt>{{ f.k }}</dt>
                  <dd :class="{ 'warn-v': f.warn }">
                    {{ f.v }}
                  </dd>
                </div>
                <div
                  v-if="!f.warn && factConf(f.v) !== null"
                  class="rv-conf"
                  :class="`conf-${confTone(factConf(f.v)!)}`"
                >
                  <span
                    class="rv-conf-fill"
                    :style="{ width: factConf(f.v)! + '%' }"
                  />
                </div>
                <div
                  v-if="f.source"
                  class="rv-fact-src"
                >
                  <span class="rv-src-ico">⌖</span>依据：{{ f.source }}
                </div>
              </div>
            </dl>

            <!-- 决策信息（已决卡） -->
            <div
              v-if="t.status === 'approved' || t.status === 'rejected'"
              class="rv-decided"
            >
              <span class="rv-decided-line">
                <TBadge :tone="t.status === 'approved' ? 'green' : 'red'">{{
                  t.status === "approved" ? "已通过" : "已驳回"
                }}</TBadge>
                <span class="t-muted">{{ t.decidedBy || "运营" }} · {{ fmtTime(t.decidedAt) }}</span>
              </span>
              <p
                v-if="t.note"
                class="rv-note"
              >
                批注：{{ t.note }}
              </p>
            </div>

            <!-- 卡脚：时间 + 动作 -->
            <div class="rv-card-foot">
              <span class="rv-time t-mono">{{ fmtTime(t.createdAt) }} 入列</span>
              <div class="rv-acts">
                <template v-if="t.status === 'pending'">
                  <button
                    class="t-btn sm"
                    :disabled="store.busy.value"
                    @click="store.claimReview(t.id)"
                  >
                    认领
                  </button>
                  <button
                    class="t-btn sm primary"
                    :disabled="store.busy.value"
                    @click="store.approveReview(t.id)"
                  >
                    通过
                  </button>
                  <button
                    class="t-btn sm rv-reject"
                    :disabled="store.busy.value"
                    @click="openReject(t.id)"
                  >
                    驳回
                  </button>
                </template>
                <template v-else-if="t.status === 'in_review'">
                  <button
                    class="t-btn sm primary"
                    :disabled="store.busy.value"
                    @click="store.approveReview(t.id)"
                  >
                    通过
                  </button>
                  <button
                    class="t-btn sm rv-reject"
                    :disabled="store.busy.value"
                    @click="openReject(t.id)"
                  >
                    驳回
                  </button>
                </template>
                <template v-else>
                  <button
                    class="t-btn sm"
                    :disabled="store.busy.value"
                    @click="store.resetReview(t.id)"
                  >
                    退回待审
                  </button>
                </template>
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>

    <!-- 驳回批注弹层 -->
    <div
      v-if="rejecting"
      class="rv-modal-mask"
      @click.self="cancelReject"
    >
      <div class="rv-modal">
        <h4>驳回并退回修正</h4>
        <p class="t-muted">
          填写驳回原因。AI 产出类任务（归类 / 对账 / 开发信 / 报价）将<b>带这条批注自动重跑</b>并重新入闸；其余任务退回来源修正。
        </p>
        <textarea
          v-model="rejectNote"
          class="rv-textarea"
          rows="3"
          placeholder="例如：发票金额与报关不符，请重开发票后再提交…"
        />
        <div class="rv-modal-acts">
          <button
            class="t-btn sm"
            @click="cancelReject"
          >
            取消
          </button>
          <button
            class="t-btn sm rv-reject"
            @click="confirmReject"
          >
            确认驳回
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rv-root {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* ── 顶部统计条 ── */
.rv-stats {
  display: flex;
  gap: 12px;
  align-items: stretch;
  margin: 4px 0 6px;
  flex-wrap: wrap;
}
.rv-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 16px;
  border: 1px solid var(--card-border);
  border-radius: 14px;
  background: var(--card-bg);
  box-shadow: var(--card-shadow);
  min-width: 96px;
}
.rv-stat-v {
  font-size: 22px;
  font-weight: 800;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.rv-stat-l {
  font-size: 11px;
  color: var(--muted);
  font-weight: 600;
}
.rv-stat-hard {
  font-size: 10px;
  font-weight: 700;
  color: var(--vermilion);
}
.rv-stat-note {
  flex: 1;
  min-width: 220px;
  flex-direction: row;
  align-items: center;
  gap: 9px;
  background: var(--bg-soft);
  color: var(--text-2);
  font-size: 12px;
  line-height: 1.5;
}
.rv-stat-note :deep(svg) {
  color: var(--primary);
  flex-shrink: 0;
}

/* ── 看板 ── */
.rv-board {
  display: flex;
  gap: 14px;
  overflow-x: auto;
  padding: 6px 2px 10px;
  align-items: flex-start;
}
.rv-col {
  flex: 1 0 300px;
  min-width: 300px;
  max-width: 380px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
}
.rv-col-head {
  padding: 12px 14px 8px;
  border-bottom: 1px solid var(--border-soft);
}
.rv-col-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 750;
  color: var(--text);
}
.rv-col-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex-shrink: 0;
}
.dot-pending { background: var(--gold); }
.dot-in_review { background: var(--primary); }
.dot-approved { background: var(--ok); }
.dot-rejected { background: var(--vermilion); }
.rv-col-count {
  margin-left: auto;
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 999px;
  padding: 1px 9px;
  min-width: 22px;
  text-align: center;
}
.rv-col-hint {
  font-size: 10.5px;
  color: var(--muted);
}
.rv-col-body {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 80px;
}

/* ── 空态 ── */
.rv-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 26px 12px;
  color: var(--muted);
  font-size: 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
}
.rv-empty :deep(svg) { opacity: 0.4; }

/* ── 卡片 ── */
.rv-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 11px;
  padding: 12px 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: var(--card-shadow);
  transition: box-shadow 0.16s, transform 0.16s, border-color 0.16s;
}
.rv-card:hover {
  border-color: var(--primary);
  box-shadow: var(--card-shadow-hover);
  transform: translateY(-1px);
}
.rv-card.is-hard {
  border-left: 3px solid var(--vermilion);
}
.rv-card.is-sel {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary), var(--card-shadow-hover);
}
.rv-badges { display: flex; gap: 5px; align-items: center; flex-shrink: 0; }

/* 键盘提示 */
.rv-kbd { font-size: 11px; color: var(--muted); margin-right: 4px; }
.rv-kbd b {
  display: inline-block; font-family: var(--mono, monospace);
  background: var(--bg-soft); border: 1px solid var(--border-strong);
  border-radius: 4px; padding: 0 5px; color: var(--text-2); margin: 0 1px;
}

/* fact 出处 */
.rv-fact-src {
  font-size: 10px; color: var(--muted); line-height: 1.5;
  display: flex; gap: 4px; align-items: baseline;
}
.rv-src-ico { color: var(--primary); flex-shrink: 0; }
.rv-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.rv-card-src {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.rv-card-mod {
  font-size: 10px;
  font-weight: 700;
  color: var(--muted);
  letter-spacing: 0.02em;
}
.rv-card-kind {
  font-size: 11px;
  font-weight: 600;
  color: var(--primary-deep);
}
.rv-hardgate {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--vermilion);
  background: var(--vermilion-soft);
  border-radius: 7px;
  padding: 4px 8px;
  width: fit-content;
}
.rv-card-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.35;
}
.rv-card-sum {
  font-size: 11.5px;
  color: var(--text-2);
  line-height: 1.5;
}

/* ── facts ── */
.rv-facts {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  overflow: hidden;
}
.rv-fact {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 9px;
  font-size: 11px;
  border-bottom: 1px solid var(--border-soft);
}
.rv-fact:last-child { border-bottom: none; }
.rv-fact.warn { background: rgba(210, 150, 40, 0.08); }
.rv-fact-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.rv-fact dt { color: var(--muted); flex-shrink: 0; }
.rv-fact dd {
  color: var(--text);
  font-weight: 600;
  text-align: right;
  font-variant-numeric: tabular-nums;
  min-width: 0;
}
.rv-fact dd.warn-v { color: var(--vermilion); }

/* ── 置信度条 ── */
.rv-conf {
  height: 3px;
  border-radius: 3px;
  background: var(--bg-soft);
  overflow: hidden;
}
.rv-conf-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s cubic-bezier(0.22, 0.7, 0.25, 1);
}
.conf-hi .rv-conf-fill { background: var(--ok); }
.conf-mid .rv-conf-fill { background: var(--gold); }
.conf-lo .rv-conf-fill { background: var(--vermilion); }

/* ── 已决 ── */
.rv-decided {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 9px;
  background: var(--bg-soft);
  border-radius: 8px;
}
.rv-decided-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.rv-note {
  font-size: 11px;
  color: var(--text-2);
  line-height: 1.5;
}

/* ── 卡脚 ── */
.rv-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 2px;
  padding-top: 8px;
  border-top: 1px solid var(--border-soft);
}
.rv-time { font-size: 10px; color: var(--muted); }
.rv-acts { display: flex; gap: 6px; }
.rv-reject {
  color: var(--vermilion);
  border-color: var(--border-strong);
}
.rv-reject:hover:not(:disabled) {
  border-color: var(--vermilion);
  background: var(--vermilion-soft);
}

/* ── 驳回弹层 ── */
.rv-modal-mask {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  backdrop-filter: blur(10px) saturate(120%);
  -webkit-backdrop-filter: blur(10px) saturate(120%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
  animation: rvFade 0.16s ease;
}
@keyframes rvFade { from { opacity: 0; } to { opacity: 1; } }
/* 弹层：真磨砂 chrome */
.rv-modal {
  position: relative;
  width: min(420px, 92vw);
  background: var(--chrome-bg);
  backdrop-filter: var(--chrome-blur);
  -webkit-backdrop-filter: var(--chrome-blur);
  border: 1px solid var(--chrome-border);
  border-radius: 18px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: var(--chrome-shadow);
}
/* 棱边折射环：跟随圆角的 1px 玻璃棱光 */
.rv-modal::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
  background: var(--edge-refract);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  pointer-events: none; z-index: 3;
}
.rv-modal h4 { font-size: 14px; font-weight: 750; color: var(--text); letter-spacing: -0.01em; }
.rv-modal p { font-size: 12px; }
.rv-textarea {
  width: 100%;
  resize: vertical;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--bg-soft);
  color: var(--text);
  font-size: 12.5px;
  line-height: 1.5;
  padding: 9px 11px;
  font-family: inherit;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.rv-textarea:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.rv-modal-acts {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
}
</style>
