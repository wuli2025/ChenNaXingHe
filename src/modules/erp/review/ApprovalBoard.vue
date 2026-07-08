<script setup lang="ts">
/**
 * ApprovalBoard —— 审批中心（星河无头ERP 唯一必须人做的地方）。
 *
 * 设计（PRD 8.2 审批卡片五要素）：
 *  ① 一句话摘要 ② AI 依据与推理链 ③ 风险提示 ④ 不批准的后果 ⑤ 结构化要点（可带出处）
 * 强制人工清单（付款/报税/退税提交）卡片带标记，永远不会被策略引擎自动放行。
 * 驳回必填一句理由 —— AI 按批注自动重跑（学习闭环）。
 */
import { ref, computed } from "vue";
import { useErpStore } from "../useErpStore";
import { REVIEW_COLUMNS, REVIEW_KIND_META, ERP_MODULES } from "../types";
import type { ReviewTask, ReviewStatus } from "../types";
import TBadge from "../../trade/components/TBadge.vue";

const store = useErpStore();

/* 过滤：按模块 */
const filterMod = ref<string>("all");
const mods = computed(() => {
  const used = new Set(store.reviewTasks.value.map((t) => t.mod));
  return ERP_MODULES.filter((m) => used.has(m.id));
});
// 每列任务：computed 缓存（模板一列引用 3 次，函数形式会重复过滤排序）。
const colTasks = computed<Record<ReviewStatus, ReviewTask[]>>(() => {
  const rank = { hard: 0, high: 1, normal: 2, low: 3 } as const;
  const out = {} as Record<ReviewStatus, ReviewTask[]>;
  for (const col of REVIEW_COLUMNS) {
    const list = store.reviewColumns.value[col.key];
    const filtered = filterMod.value === "all" ? list : list.filter((t) => t.mod === filterMod.value);
    // 硬闸置顶，其余按风险与时间
    out[col.key] = [...filtered].sort((a, b) => (a.hardGate === b.hardGate ? rank[a.risk] - rank[b.risk] || b.createdAt - a.createdAt : a.hardGate ? -1 : 1));
  }
  return out;
});

/* 展开的卡片 + 批注 */
const openId = ref<string | null>(null);
const note = ref("");
function toggle(t: ReviewTask) {
  openId.value = openId.value === t.id ? null : t.id;
  note.value = "";
}
function approve(t: ReviewTask) {
  store.approveReview(t.id, note.value.trim() || undefined);
  openId.value = null;
  note.value = "";
}
function reject(t: ReviewTask) {
  if (!note.value.trim()) return; // 驳回必填理由（喂给 AI 重跑）
  store.rejectReview(t.id, note.value.trim());
  openId.value = null;
  note.value = "";
}

function kindLabel(t: ReviewTask): string {
  return REVIEW_KIND_META[t.kind]?.label ?? t.kind;
}
function modName(t: ReviewTask): string {
  return ERP_MODULES.find((m) => m.id === t.mod)?.name ?? t.mod.toUpperCase();
}
function riskTone(t: ReviewTask): "red" | "amber" | "blue" | "gray" {
  return t.risk === "hard" ? "red" : t.risk === "high" ? "amber" : t.risk === "normal" ? "blue" : "gray";
}
function fmtAt(at?: number): string {
  if (!at) return "";
  return new Date(at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
const stats = computed(() => store.autonomyStats.value);
</script>

<template>
  <div class="board t-view-anim">
    <!-- 头：无人化度量 + 过滤 -->
    <div class="board-head">
      <div class="bh-l">
        <h2>审批中心</h2>
        <span class="bh-sub">AI 把功课做完，你只回答「批 / 驳 / 改」。驳回的理由会喂给 AI 重跑并沉淀为规则。</span>
      </div>
      <div class="bh-r">
        <div class="stat">
          <b>{{ stats.autoRate }}%</b><span>无人化率</span>
        </div>
        <div class="stat">
          <b>{{ stats.auto }}</b><span>自动执行</span>
        </div>
        <div class="stat">
          <b>{{ stats.human }}</b><span>人工核准</span>
        </div>
        <select
          v-model="filterMod"
          class="mod-filter"
          title="按模块过滤"
        >
          <option value="all">
            全部模块
          </option>
          <option
            v-for="m in mods"
            :key="m.id"
            :value="m.id"
          >
            {{ m.no }} {{ m.name }}
          </option>
        </select>
      </div>
    </div>

    <div
      class="t-note info"
      style="margin-top:0"
    >
      <b>强制人工清单：</b>采购付款 · 税务申报提交 · 出口退税提交 —— 这三类动作写死在核心层，无论参数怎么调，AI 只能备好材料等你确认，永远不会自动执行。
    </div>

    <!-- 四列看板 -->
    <div class="cols">
      <div
        v-for="col in REVIEW_COLUMNS"
        :key="col.key"
        class="col"
      >
        <div class="col-head">
          <span class="col-name">{{ col.label }}</span>
          <span class="col-n">{{ colTasks[col.key].length }}</span>
          <span class="col-hint">{{ col.hint }}</span>
        </div>
        <div class="col-body">
          <div
            v-if="colTasks[col.key].length === 0"
            class="col-empty"
          >
            —
          </div>
          <div
            v-for="t in colTasks[col.key]"
            :key="t.id"
            class="card"
            :class="{ hard: t.hardGate, open: openId === t.id, decided: t.status === 'approved' || t.status === 'rejected' }"
            @click="toggle(t)"
          >
            <div class="card-top">
              <span
                v-if="t.hardGate"
                class="e-human"
              >强制人工</span>
              <TBadge :tone="riskTone(t)">
                {{ t.risk === "hard" ? "硬闸" : t.risk === "high" ? "高风险" : t.risk === "normal" ? "常规" : "低" }}
              </TBadge>
              <span class="kind">{{ kindLabel(t) }}</span>
              <span class="mod">{{ modName(t) }}</span>
            </div>
            <div class="card-title">
              {{ t.title }}
            </div>
            <div class="card-sum">
              {{ t.summary }}
            </div>

            <!-- 展开：五要素 + 决策区 -->
            <template v-if="openId === t.id">
              <div
                v-if="t.reasoning"
                class="sect"
              >
                <div class="sect-k">
                  AI 依据与推理
                </div>
                <div class="sect-v">
                  {{ t.reasoning }}
                </div>
              </div>
              <div
                v-if="t.consequence"
                class="sect"
              >
                <div class="sect-k">
                  不批准的后果
                </div>
                <div class="sect-v">
                  {{ t.consequence }}
                </div>
              </div>
              <div
                v-if="t.facts.length"
                class="facts"
                @click.stop
              >
                <div
                  v-for="(f, i) in t.facts"
                  :key="i"
                  class="fact"
                  :class="{ warn: f.warn }"
                >
                  <span class="f-k">{{ f.k }}</span>
                  <span class="f-v">{{ f.v }}</span>
                  <span
                    v-if="f.source"
                    class="f-src"
                    :title="f.source"
                  >依据</span>
                </div>
              </div>

              <div
                v-if="t.status === 'pending' || t.status === 'in_review'"
                class="decide"
                @click.stop
              >
                <!-- 批注框里 Enter 只拦截默认行为、不触发任何决策：批/驳必须点按钮 ——
                     否则「输完驳回理由顺手回车」会在付款/报税硬闸上反向执行成批准。 -->
                <input
                  v-model="note"
                  class="note"
                  :placeholder="t.hardGate ? '批注（驳回必填，将喂给 AI 改进）' : '批注（驳回必填）'"
                  @keydown.enter.prevent
                >
                <div class="btns">
                  <button
                    class="t-btn primary sm"
                    @click="approve(t)"
                  >
                    ✓ 批准执行
                  </button>
                  <button
                    class="t-btn sm rej"
                    :disabled="!note.trim() || store.busy.value"
                    :title="store.busy.value ? 'AI 正在运行，请稍候再驳回（避免并发重跑）' : note.trim() ? '驳回并让 AI 按批注重跑' : '驳回必须填一句理由'"
                    @click="reject(t)"
                  >
                    驳回
                  </button>
                  <button
                    v-if="t.status === 'pending'"
                    class="t-btn sm"
                    @click="store.claimReview(t.id)"
                  >
                    认领
                  </button>
                </div>
              </div>
              <div
                v-else
                class="decided-row"
                @click.stop
              >
                <span>{{ t.status === "approved" ? "已批准" : "已驳回" }} · {{ t.decidedBy }} · {{ fmtAt(t.decidedAt) }}</span>
                <span
                  v-if="t.note"
                  class="d-note"
                >批注：{{ t.note }}</span>
                <span
                  v-if="t.reran"
                  class="d-note"
                >↻ 已按批注自动重跑</span>
                <!-- 只有已驳回可重开：已批准的回写已执行，重开再批会双重执行（重复建PO/重复入账） -->
                <button
                  v-if="t.status === 'rejected'"
                  class="t-btn sm"
                  @click="store.resetReview(t.id)"
                >
                  重开
                </button>
              </div>
            </template>

            <div class="card-foot">
              <span>{{ fmtAt(t.createdAt) }}</span>
              <span
                v-if="t.origin === 'ai'"
                class="origin"
              >AI 产出</span>
              <span
                v-else-if="t.origin === 'auto'"
                class="origin"
              >自动留痕</span>
              <span class="expand">{{ openId === t.id ? "收起 ▲" : "详情 ▼" }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 已执行动作台账 -->
    <div class="ledger">
      <div class="lg-head">
        已执行动作台账（证据链 · 最近 {{ Math.min(store.executedActions.value.length, 12) }} 条）
      </div>
      <div
        v-if="store.executedActions.value.length === 0"
        class="col-empty"
      >
        暂无 —— 批准卡片或让代理在边界内自动执行后，这里会记录每一笔。
      </div>
      <div
        v-for="a in store.executedActions.value.slice(0, 12)"
        :key="a.id"
        class="lg-row"
      >
        <span :class="a.by === 'auto' ? 'e-auto' : 'e-human soft'">{{ a.by === "auto" ? "自动" : "人工" }}</span>
        <b>{{ a.title }}</b>
        <span class="lg-detail">{{ a.detail }}</span>
        <span class="lg-at">{{ fmtAt(a.at) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.board { display: flex; flex-direction: column; gap: 14px; }
.board-head { display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
.bh-l h2 { font-size: 18px; font-weight: 800; color: var(--text); letter-spacing: -0.01em; }
.bh-sub { font-size: 11.5px; color: var(--muted); }
.bh-r { margin-left: auto; display: flex; align-items: center; gap: 14px; }
.stat { text-align: center; }
.stat b { display: block; font-size: 17px; color: var(--primary); font-variant-numeric: tabular-nums; }
.stat span { font-size: 10px; color: var(--muted); }
.mod-filter {
  border: 1px solid var(--border-strong); border-radius: 8px; background: var(--panel);
  color: var(--text); font-size: 12px; padding: 5px 8px;
}

.cols { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; align-items: start; }
@media (max-width: 1280px) { .cols { grid-template-columns: repeat(2, 1fr); } }
.col { background: var(--bg-soft); border: 1px solid var(--border-soft); border-radius: 12px; padding: 10px; min-height: 120px; }
.col-head { display: flex; align-items: baseline; gap: 7px; padding: 2px 4px 8px; }
.col-name { font-size: 12.5px; font-weight: 750; color: var(--text); }
.col-n {
  font-size: 10.5px; font-weight: 700; min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 9px; background: var(--card-bg); color: var(--muted);
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--card-border);
}
.col-hint { font-size: 10px; color: var(--dim); margin-left: auto; }
.col-body { display: flex; flex-direction: column; gap: 8px; }
.col-empty { text-align: center; color: var(--dim); font-size: 12px; padding: 14px 0; }

.card {
  background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 11px;
  padding: 10px 12px; cursor: pointer; box-shadow: var(--card-shadow);
  transition: box-shadow 0.15s, border-color 0.15s, transform 0.15s;
}
.card:hover { border-color: var(--border-strong); box-shadow: var(--card-shadow-hover); transform: translateY(-1px); }
.card.hard { border-left: 3px solid var(--vermilion); }
.card.decided { opacity: 0.82; }
.card-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.kind { font-size: 10px; color: var(--primary-deep); font-weight: 700; }
.mod { font-size: 10px; color: var(--dim); margin-left: auto; }
.card-title { font-size: 13px; font-weight: 750; color: var(--text); margin-top: 6px; line-height: 1.4; }
.card-sum { font-size: 11.5px; color: var(--text-2); line-height: 1.55; margin-top: 3px; }

.sect { margin-top: 8px; }
.sect-k { font-size: 10px; font-weight: 800; letter-spacing: 0.09em; color: var(--muted); text-transform: uppercase; }
.sect-v { font-size: 11.5px; color: var(--text-2); line-height: 1.55; margin-top: 2px; }
.facts { margin-top: 8px; border: 1px solid var(--border-soft); border-radius: 8px; overflow: hidden; }
.fact { display: flex; align-items: baseline; gap: 8px; padding: 5px 9px; font-size: 11.5px; border-bottom: 1px solid var(--border-soft); }
.fact:last-child { border-bottom: none; }
.fact.warn { background: rgba(200, 80, 60, 0.06); }
.f-k { color: var(--muted); flex: 0 0 auto; min-width: 74px; }
.f-v { color: var(--text); font-weight: 600; }
.fact.warn .f-v { color: var(--vermilion); }
.f-src {
  margin-left: auto; font-size: 9.5px; color: var(--primary); cursor: help;
  border-bottom: 1px dotted var(--primary);
}

.decide { margin-top: 10px; display: flex; flex-direction: column; gap: 7px; }
.note {
  border: 1px solid var(--border-strong); border-radius: 10px; background: var(--bg-soft);
  padding: 6px 10px; font-size: 12px; color: var(--text);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.note:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.btns { display: flex; gap: 7px; }
.t-btn.rej { color: var(--vermilion); border-color: rgba(200, 80, 60, 0.4); }
.t-btn.rej:disabled { opacity: 0.45; }
.decided-row { margin-top: 9px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11px; color: var(--muted); }
.d-note { color: var(--text-2); }

.card-foot { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 10px; color: var(--dim); }
.origin { padding: 1px 6px; border-radius: 5px; background: var(--bg-soft); }
.expand { margin-left: auto; color: var(--muted); }

.ledger { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 12px 14px; box-shadow: var(--card-shadow); }
.lg-head { font-size: 11px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
.lg-row { display: flex; align-items: baseline; gap: 9px; padding: 6px 0; border-bottom: 1px solid var(--border-soft); font-size: 12px; flex-wrap: wrap; }
.lg-row:last-child { border-bottom: none; }
.lg-row b { color: var(--text); }
.lg-detail { color: var(--text-2); flex: 1 1 240px; min-width: 0; }
.lg-at { color: var(--dim); font-size: 10.5px; font-variant-numeric: tabular-nums; }
</style>
