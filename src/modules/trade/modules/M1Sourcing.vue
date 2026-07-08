<script setup lang="ts">
/**
 * M1 选品采集 —— 自研采集器 · 结构化为 SKU 候选 · 三级降级。
 *
 * 上部：采集条件表单（关键词 / 产区 / 品类 / 数量），「开始采集」调 store.runSourcing。
 * 下部：候选结果表（store.skus），每行「存为线索」（本地）+「入库」（走人工审核闸）。
 * 入库闸：enqueueReview({ mod:'m1', kind:'sku-intake', ... }) → 进中央审核看板。
 */
import { ref, computed } from "vue";
import { useTradeStore } from "../useTradeStore";
import type { SkuCandidate } from "../types";
import TSection from "../components/TSection.vue";
import TPanel from "../components/TPanel.vue";
import TBadge from "../components/TBadge.vue";
import TConf from "../components/TConf.vue";
import TIcon from "../components/TIcon.vue";
import { ICONS } from "../types";

const store = useTradeStore();

/* ── 采集条件（本地表单状态） ── */
const keywords = ref("有机红酒 · 新酒庄");
const region = ref("智利 / 南非 / 阿根廷");
const category = ref("进口葡萄酒");
const limit = ref(8);

/* 结果计数 */
const total = computed(() => store.skus.value.length);
const stockedCount = computed(() => store.skus.value.filter((s) => s.state === "stocked" || s.state === "reviewing").length);
const leadCount = computed(() => store.skus.value.filter((s) => s.state === "lead").length);

async function collect() {
  if (store.busy.value) return;
  await store.runSourcing({
    keywords: keywords.value.trim(),
    region: region.value.trim(),
    category: category.value.trim(),
    limit: Math.max(1, Math.min(50, Number(limit.value) || 8)),
  });
}

/* 存为线索：真正把候选并入 M2 供应商线索池（M1→M2 接通），可在 M2 直接发开发信。 */
function saveAsLead(s: SkuCandidate) {
  if (s.state === "lead") return;
  const lead = store.promoteSkuToLead(s);
  store.log("ok", lead
    ? `已并入 M2 线索池：${s.name}（${s.region}）· 等级 ${lead.grade} → 可在 M2 发破冰开发信`
    : `${s.name} 已在 M2 线索池中`);
}

/* 入库：人工闸。派单进中央审核看板（kind: sku-intake）。
   注意：入闸时只标 reviewing（待核准），核准通过后才由 store.onReviewDecided 置 stocked，
   驳回则退回 candidate —— 避免入闸即置 stocked 后无法回退。 */
function intake(s: SkuCandidate) {
  if (s.state === "stocked" || s.state === "reviewing") return;
  store.enqueueReview({
    mod: "m1",
    kind: "sku-intake",
    title: `${s.name} 入库核准`,
    summary: `选品候选『${s.name}』（${s.region} · ${s.priceBand}）拟建 SKU 入库，需人工核准商品档、价位带与认证真实性。`,
    facts: [
      { k: "产区", v: s.region },
      { k: "价位带", v: s.priceBand },
      { k: "认证", v: s.certs || "—", warn: !s.certs || s.certs === "—" },
      { k: "采集置信", v: `${s.conf}%`, warn: s.conf < 70 },
    ],
    risk: s.conf < 70 ? "high" : "normal",
    refId: s.id,
  });
  s.state = "reviewing";
  store.saveSkus();
}

/* 徽标：状态 → 色调 */
function stateTone(state?: SkuCandidate["state"]) {
  return state === "stocked" ? "green" : state === "reviewing" ? "amber" : state === "lead" ? "gold" : "gray";
}
function stateLabel(state?: SkuCandidate["state"]) {
  return state === "stocked" ? "已入库核准" : state === "reviewing" ? "待入库核准" : state === "lead" ? "已存线索" : "候选";
}
function provLabel(p?: SkuCandidate["provenance"]) {
  return p === "ai" ? "AI 采集" : p === "inferred" ? "推断" : p === "user" ? "人工" : "—";
}
function provTone(p?: SkuCandidate["provenance"]) {
  return p === "ai" ? "blue" : p === "inferred" ? "purple" : "gray";
}
</script>

<template>
  <div class="t-view-anim">
    <!-- 采集条件表单 -->
    <TSection
      title="采集条件"
      sub="关键词 / 产区 / 品类 / 数量 → Agent 联网采集 · 三级降级"
    >
      <template #actions>
        <span class="t-pill">候选 {{ total }}</span>
        <span class="t-pill">已转线索 {{ leadCount }}</span>
        <span class="t-pill">已入闸 {{ stockedCount }}</span>
      </template>
    </TSection>

    <TPanel pad>
      <div class="sf-grid">
        <label class="sf-fld">
          <span class="sf-lbl">关键词</span>
          <input
            v-model="keywords"
            class="sf-in"
            type="text"
            placeholder="如：有机红酒 · 新酒庄"
            :disabled="store.busy.value"
          >
        </label>
        <label class="sf-fld">
          <span class="sf-lbl">产区</span>
          <input
            v-model="region"
            class="sf-in"
            type="text"
            placeholder="如：智利 / 南非"
            :disabled="store.busy.value"
          >
        </label>
        <label class="sf-fld">
          <span class="sf-lbl">品类</span>
          <input
            v-model="category"
            class="sf-in"
            type="text"
            placeholder="如：进口葡萄酒"
            :disabled="store.busy.value"
          >
        </label>
        <label class="sf-fld sf-num">
          <span class="sf-lbl">数量</span>
          <input
            v-model.number="limit"
            class="sf-in"
            type="number"
            min="1"
            max="50"
            :disabled="store.busy.value"
          >
        </label>
      </div>

      <div class="sf-bar">
        <button
          class="t-btn primary"
          :disabled="store.busy.value"
          @click="collect"
        >
          <TIcon
            :path="ICONS.sourcing"
            :size="15"
          />
          {{ store.busy.value ? "采集中…" : "开始采集" }}
        </button>
        <span
          v-if="store.runStatus.value"
          class="sf-status"
          :class="{ busy: store.busy.value }"
        >
          {{ store.runStatus.value }}
        </span>
        <span
          v-else
          class="t-muted sf-hint"
        >采集过程实时显示在右侧 Console；结果结构化为 SKU 候选写入下表。</span>
      </div>
    </TPanel>

    <div class="t-note info">
      <b>三级降级</b>：优先真实联网检索 → 站点解析 → 离线名录兜底。每个候选带来源与字段级置信度，
      <b>低置信（&lt;70%）入库时自动升为高风险闸</b>，请以人工核准为准。
    </div>

    <!-- 候选结果表 -->
    <TSection
      title="候选品结果"
      sub="SkuCandidate · 字段置信度 · 可入库 / 存为线索"
    >
      <template #actions>
        <span
          class="t-muted"
          style="font-size:11.5px"
        >共 {{ total }} 个候选</span>
      </template>
    </TSection>

    <TPanel>
      <table
        v-if="total"
        class="t-table sf-table"
      >
        <thead>
          <tr>
            <th>品名</th>
            <th>产区</th>
            <th>价位带</th>
            <th>认证</th>
            <th style="min-width:160px">
              采集置信度
            </th>
            <th>来源</th>
            <th>状态</th>
            <th style="text-align:right">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(s, i) in store.skus.value"
            :key="s.id || s.name + i"
          >
            <td><b>{{ s.name }}</b></td>
            <td>{{ s.region }}</td>
            <td class="t-mono">
              {{ s.priceBand }}
            </td>
            <td>
              <span v-if="s.certs && s.certs !== '—'">{{ s.certs }}</span>
              <span
                v-else
                class="t-muted sf-nocert"
              >缺认证</span>
            </td>
            <td><TConf :value="s.conf" /></td>
            <td>
              <TBadge :tone="provTone(s.provenance)">
                {{ provLabel(s.provenance) }}
              </TBadge>
            </td>
            <td>
              <TBadge :tone="stateTone(s.state)">
                {{ stateLabel(s.state) }}
              </TBadge>
            </td>
            <td>
              <div class="sf-acts">
                <button
                  class="t-btn sm sf-btn"
                  :disabled="s.state === 'lead' || store.busy.value"
                  :title="s.state === 'lead' ? '已存为建联线索' : '标记为 M2 建联线索'"
                  @click="saveAsLead(s)"
                >
                  {{ s.state === "lead" ? "已存线索" : "存为线索" }}
                </button>
                <button
                  class="t-btn sm gold sf-btn"
                  :disabled="s.state === 'stocked' || s.state === 'reviewing' || store.busy.value"
                  :title="s.state === 'stocked' ? '已核准入库' : s.state === 'reviewing' ? '已派入库核准闸，待审核' : '派一张入库核准任务进审核看板'"
                  @click="intake(s)"
                >
                  {{ s.state === "stocked" ? "已入库" : s.state === "reviewing" ? "已入闸" : "入库" }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- 采集中占位（首次采集、尚无结果） -->
      <div
        v-else-if="store.busy.value"
        class="sf-empty"
      >
        <span class="sf-spinner" />
        <div class="sf-empty-t">
          正在联网采集候选品…
        </div>
        <div class="sf-empty-s">
          Agent 正按三级降级抓取并结构化，实时过程见右侧 Console，完成后候选会写入本表。
        </div>
      </div>

      <!-- 空态 -->
      <div
        v-else
        class="sf-empty"
      >
        <TIcon
          :path="ICONS.sourcing"
          :size="30"
        />
        <div class="sf-empty-t">
          暂无候选品
        </div>
        <div class="sf-empty-s">
          填写上方采集条件并点「开始采集」，Agent 联网抓取后会把结构化候选写到这里。
        </div>
      </div>
    </TPanel>

    <div class="t-note warn">
      <b>入库=人工闸</b>：点「入库」不会直接建档，而是派一张 <b>选品入库核准</b> 任务进
      <b>中央审核看板</b>（待审核列）。运营核准后才落 SKU 主数据，避免脏数据入库。
    </div>
  </div>
</template>

<style scoped>
.sf-grid {
  display: grid;
  grid-template-columns: 1.4fr 1.2fr 1fr 0.6fr;
  gap: 12px;
}
@media (max-width: 860px) {
  .sf-grid { grid-template-columns: 1fr 1fr; }
}
.sf-fld { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.sf-lbl { font-size: 10.5px; font-weight: 700; color: var(--muted); letter-spacing: 0.04em; }
.sf-in {
  width: 100%;
  box-sizing: border-box;
  font-size: 12.5px;
  padding: 8px 11px;
  border-radius: 8px;
  border: 1px solid var(--border-strong);
  background: var(--bg-soft);
  color: var(--text);
  transition: border-color 0.14s;
  font-family: inherit;
}
.sf-in:focus { outline: none; border-color: var(--primary); background: var(--panel); }
.sf-in:disabled { opacity: 0.55; cursor: not-allowed; }

.sf-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  flex-wrap: wrap;
}
.sf-status { font-size: 12px; font-weight: 600; color: var(--ok); }
.sf-status.busy { color: var(--primary); }
.sf-hint { font-size: 11.5px; }

/* 结果表：行 hover 提示当前候选 */
.sf-table tbody tr { transition: background 0.14s; }
.sf-table tbody tr:hover { background: var(--panel-hover); }

.sf-nocert { font-style: italic; }

.sf-acts { display: flex; gap: 6px; justify-content: flex-end; }
/* 两个动作按钮等宽对齐，状态切换时不抖动 */
.sf-btn { min-width: 68px; justify-content: center; }
/* 禁用态不应响应 hover（覆盖共享 .t-btn:hover） */
.sf-btn:disabled:hover { background: var(--panel); border-color: var(--border-strong); }
.sf-btn.gold:disabled:hover { background: rgba(167, 140, 79, 0.14); border-color: rgba(167, 140, 79, 0.4); }

.sf-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  padding: 46px 20px;
  text-align: center;
  color: var(--muted);
}
.sf-empty-t { font-size: 13.5px; font-weight: 700; color: var(--text-2); }
.sf-empty-s { font-size: 11.5px; max-width: 400px; line-height: 1.65; }

/* 采集中转圈 */
.sf-spinner {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2.5px solid var(--border-strong);
  border-top-color: var(--primary);
  animation: sfSpin 0.7s linear infinite;
}
@keyframes sfSpin { to { transform: rotate(360deg); } }
</style>
