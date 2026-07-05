<script setup lang="ts">
/**
 * M6 · 厂仓 / 补货
 * 四个内部 tab：库存总览 / FEFO 效期 / 落地成本 / 智能补货。
 * 数值全部本地算（库存、临期、落地成本、补货量），AI 仅做解释与异常提示。
 * 「确认补货」是人工闸：调用 store.enqueueReview({mod:'m6', kind:'replenish', ...})，进中央审核看板。
 */
import { ref, computed } from "vue";
import { useTradeStore } from "../useTradeStore";
import { ICONS } from "../types";
import type { StockLot, ReplenishSuggestion } from "../types";
import TSection from "../components/TSection.vue";
import TBadge from "../components/TBadge.vue";
import TKpi from "../components/TKpi.vue";
import TPanel from "../components/TPanel.vue";

const store = useTradeStore();

/* ── 内部视图 tab ── */
type ViewKey = "stock" | "fefo" | "landed" | "replenish";
const view = ref<ViewKey>("stock");
const TABS: { key: ViewKey; label: string }[] = [
  { key: "stock", label: "库存总览" },
  { key: "fefo", label: "FEFO 效期" },
  { key: "landed", label: "落地成本" },
  { key: "replenish", label: "智能补货" },
];

/* ── 临期判定（本地算）：效期早于 2026 或 FEFO=0（优先出库）视为临期风险 ── */
function isExpiring(s: StockLot): boolean {
  return s.expiry < "2026" || s.fefo === 0;
}

/* ── 派生指标（全部本地算） ── */
const totalQty = computed(() => store.stock.value.reduce((a, s) => a + s.qty, 0));
const skuCount = computed(() => store.stock.value.length);
const expiringCount = computed(() => store.stock.value.filter(isExpiring).length);
const inventoryValue = computed(() =>
  store.stock.value.reduce((a, s) => a + s.qty * s.landed, 0)
);
const avgLanded = computed(() =>
  totalQty.value ? inventoryValue.value / totalQty.value : 0
);

/* ── FEFO 排序：fefo=0（优先出库）置顶，其余按 fefo 升序 ── */
const fefoSorted = computed<StockLot[]>(() =>
  [...store.stock.value].sort((a, b) => {
    const ka = a.fefo === 0 ? -1 : a.fefo;
    const kb = b.fefo === 0 ? -1 : b.fefo;
    return ka - kb;
  })
);

/* ── 落地成本：按到岸成本/瓶升序，最贵者标注 ── */
const landedSorted = computed<StockLot[]>(() =>
  [...store.stock.value].sort((a, b) => a.landed - b.landed)
);
const maxLanded = computed(() =>
  store.stock.value.reduce((m, s) => Math.max(m, s.landed), 0)
);

/* ── 补货：哪些已在审核流水线（避免重复入闸的视觉标记） ── */
function pendingReplenish(sku: string): boolean {
  return store.reviewTasks.value.some(
    (t) =>
      t.kind === "replenish" &&
      t.refId === sku &&
      (t.status === "pending" || t.status === "in_review")
  );
}

/* ── 人工闸：确认补货 → 进审核看板 ── */
function confirmReplenish(r: ReplenishSuggestion): void {
  const expiring = store.stock.value.some((s) => s.sku === r.sku && isExpiring(s));
  store.enqueueReview({
    mod: "m6",
    kind: "replenish",
    title: `${r.name} 补货建议确认`,
    refId: r.sku,
    summary: `建议 ${r.by} 补货 ${r.qty.toLocaleString()} 瓶（数值本地算，AI 仅解释触发理由），需人工确认下单。`,
    facts: [
      { k: "SKU", v: r.sku },
      { k: "建议量", v: `${r.qty.toLocaleString()} 瓶` },
      { k: "下单时点", v: r.by },
      { k: "触发理由", v: r.reason, warn: expiring },
    ],
    risk: expiring ? "high" : "normal",
  });
}

/* ── AI 解释（复用对话坞，右侧 Console 可见流式过程） ── */
async function askExplain(): Promise<void> {
  if (store.busy.value) return;
  try {
    await store.runChat(
      "厂仓 / 补货",
      "FEFO 效期 · 落地成本 · 智能补货",
      "根据销量+在库+在途+交期，解释当前的智能补货建议并提示临期/异常。数值我方本地已算，你只做解释与异常提示。",
      true
    );
  } catch (e) {
    store.log("error", `❌ AI 解释失败：${(e as Error).message}`);
  }
}

function landedBadge(v: number): "red" | "amber" | "green" {
  if (v >= maxLanded.value) return "red";
  if (v > avgLanded.value) return "amber";
  return "green";
}
</script>

<template>
  <div class="t-view-anim m6">
    <!-- 顶部 KPI（本地算） -->
    <div class="t-grid t-g4">
      <TKpi :value="String(skuCount)" label="在库批次" :icon="ICONS.warehouse" acc="gold" />
      <TKpi :value="totalQty.toLocaleString()" label="在库总瓶数" acc="blue" />
      <TKpi
        :value="'$' + Math.round(inventoryValue).toLocaleString()"
        label="库存到岸货值"
        :delta="'均 $' + avgLanded.toFixed(2) + '/瓶'"
        acc="green"
      />
      <TKpi
        :value="String(expiringCount)"
        label="临期风险批次"
        :delta="expiringCount ? '需以销定采' : '暂无临期'"
        :up="false"
        acc="red"
      />
    </div>

    <div class="t-note ok">
      <b>数值本地算，AI 只做解释与异常提示。</b>
      库存量、FEFO 排位、落地成本/瓶、补货建议量均由厂仓账本本地计算；
      Claude 仅对补货逻辑做自然语言解释、标注临期与异常，绝不改动数字。点「AI 解释建议」可在右侧 Console 看到流式推理。
    </div>

    <!-- 视图切换 -->
    <div class="m6-tabs">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="t-btn sm"
        :class="{ primary: view === t.key }"
        @click="view = t.key"
      >
        {{ t.label }}
      </button>
      <button class="t-btn sm gold m6-ai" :disabled="store.busy.value" @click="askExplain">
        {{ store.busy.value ? "解释中…" : "AI 解释建议" }}
      </button>
    </div>

    <!-- ① 库存总览 -->
    <template v-if="view === 'stock'">
      <TSection title="库存总览" sub="批次 · 数量 · 效期 · FEFO 排位 · 落地成本/瓶" />
      <TPanel>
        <table class="t-table">
          <thead>
            <tr>
              <th>商品 / SKU</th>
              <th>批次</th>
              <th class="num">在库（瓶）</th>
              <th>效期</th>
              <th>FEFO</th>
              <th class="num">落地成本/瓶</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in store.stock.value" :key="s.sku" class="m6-row" :class="{ 'row-exp': isExpiring(s) }">
              <td>
                <b>{{ s.name }}</b>
                <div class="t-muted t-mono" style="font-size: 11px">{{ s.sku }}</div>
              </td>
              <td class="t-mono">{{ s.batch }}</td>
              <td class="num"><b>{{ s.qty.toLocaleString() }}</b></td>
              <td>
                <span :class="{ 't-warn-txt': isExpiring(s) }">{{ s.expiry }}</span>
                <TBadge v-if="isExpiring(s)" tone="red" style="margin-left: 6px">临期</TBadge>
              </td>
              <td>
                <TBadge v-if="s.fefo === 0" tone="red">优先出库</TBadge>
                <TBadge v-else tone="blue">#{{ s.fefo }}</TBadge>
              </td>
              <td class="num t-mono">${{ s.landed.toFixed(2) }}</td>
            </tr>
            <tr v-if="!store.stock.value.length">
              <td colspan="6" class="t-muted" style="text-align: center; padding: 26px">暂无库存批次</td>
            </tr>
          </tbody>
        </table>
      </TPanel>
    </template>

    <!-- ② FEFO 效期 -->
    <template v-else-if="view === 'fefo'">
      <TSection title="FEFO 效期" sub="先到期先出（First-Expired-First-Out）· 临期批次红色高亮" />
      <TPanel>
        <table class="t-table">
          <thead>
            <tr>
              <th>出库序</th>
              <th>商品 / 批次</th>
              <th>效期</th>
              <th class="num">在库（瓶）</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(s, i) in fefoSorted"
              :key="s.sku"
              class="m6-row"
              :class="{ 'row-exp': isExpiring(s) }"
            >
              <td>
                <span class="fefo-rank" :class="{ hot: isExpiring(s) }">{{ i + 1 }}</span>
              </td>
              <td>
                <b>{{ s.name }}</b>
                <div class="t-muted t-mono" style="font-size: 11px">{{ s.batch }} · {{ s.sku }}</div>
              </td>
              <td>
                <span :class="{ 't-warn-txt': isExpiring(s) }">{{ s.expiry }}</span>
              </td>
              <td class="num">{{ s.qty.toLocaleString() }}</td>
              <td>
                <TBadge v-if="s.fefo === 0" tone="red">优先出库</TBadge>
                <TBadge v-else-if="isExpiring(s)" tone="amber">临期关注</TBadge>
                <TBadge v-else tone="green">正常</TBadge>
              </td>
            </tr>
            <tr v-if="!fefoSorted.length">
              <td colspan="5" class="t-muted" style="text-align: center; padding: 26px">暂无在库批次</td>
            </tr>
          </tbody>
        </table>
      </TPanel>
      <div class="t-note warn" v-if="expiringCount">
        <b>{{ expiringCount }} 个批次触发临期规则</b>：效期早于 2026 或 FEFO 排位为「优先出库」。
        建议优先分销并结合 M7 客户订单以销定采，避免呆滞报废。
      </div>
      <div class="t-note ok" v-else>当前无临期批次，FEFO 序列健康。</div>
    </template>

    <!-- ③ 落地成本 -->
    <template v-else-if="view === 'landed'">
      <TSection title="落地成本" sub="到岸成本/瓶（FOB + 运保 + 税费 + 内陆分摊）· 本地分摊结果" />
      <div class="t-note info">
        全库加权平均到岸成本 <b>${{ avgLanded.toFixed(2) }}/瓶</b>，
        库存到岸货值 <b>${{ Math.round(inventoryValue).toLocaleString() }}</b>。落地成本是 M7 对客定价与毛利核算的基准。
      </div>
      <TPanel>
        <table class="t-table">
          <thead>
            <tr>
              <th>商品 / SKU</th>
              <th class="num">在库（瓶）</th>
              <th class="num">落地成本/瓶</th>
              <th class="num">批次货值</th>
              <th>成本位</th>
              <th>相对均价</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in landedSorted" :key="s.sku" class="m6-row">
              <td>
                <b>{{ s.name }}</b>
                <div class="t-muted t-mono" style="font-size: 11px">{{ s.sku }}</div>
              </td>
              <td class="num">{{ s.qty.toLocaleString() }}</td>
              <td class="num t-mono"><b>${{ s.landed.toFixed(2) }}</b></td>
              <td class="num t-mono">${{ Math.round(s.qty * s.landed).toLocaleString() }}</td>
              <td>
                <div class="landed-bar" :title="'占最高成本位 ' + (maxLanded ? Math.round((s.landed / maxLanded) * 100) : 0) + '%'">
                  <span
                    class="landed-fill"
                    :class="landedBadge(s.landed)"
                    :style="{ width: (maxLanded ? (s.landed / maxLanded) * 100 : 0) + '%' }"
                  />
                </div>
              </td>
              <td>
                <TBadge :tone="landedBadge(s.landed)">
                  {{ s.landed > avgLanded ? "+" : "" }}${{ (s.landed - avgLanded).toFixed(2) }}
                </TBadge>
              </td>
            </tr>
            <tr v-if="!landedSorted.length">
              <td colspan="6" class="t-muted" style="text-align: center; padding: 26px">暂无落地成本数据</td>
            </tr>
          </tbody>
        </table>
      </TPanel>
    </template>

    <!-- ④ 智能补货 -->
    <template v-else>
      <TSection title="智能补货" sub="以销定采 · 数值本地算 · 每条确认进人工审核看板">
        <template #actions>
          <span class="t-pill">{{ store.replenish.value.length }} 条建议</span>
        </template>
      </TSection>
      <div class="t-note info">
        每条「确认补货」都会生成一个 <b>补货审核任务</b>，进入中央审核看板（人工闸 · kind=replenish）。
        运营在看板通过后才视为正式下单意图，避免误采。
      </div>

      <div class="rep-list">
        <TPanel v-for="r in store.replenish.value" :key="r.sku" pad class="rep-card">
          <div class="rep-head">
            <div>
              <b class="rep-name">{{ r.name }}</b>
              <span class="t-muted t-mono" style="font-size: 11px; margin-left: 8px">{{ r.sku }}</span>
            </div>
            <TBadge :tone="r.ordered ? 'green' : pendingReplenish(r.sku) ? 'amber' : 'gold'">
              {{ r.ordered ? "已下单 · 回流 M3" : pendingReplenish(r.sku) ? "审核中" : "待确认" }}
            </TBadge>
          </div>
          <div class="rep-meta">
            <span class="rep-qty">建议 <b>{{ r.qty.toLocaleString() }}</b> 瓶</span>
            <span class="rep-by">时点：{{ r.by }}</span>
          </div>
          <div class="rep-reason">{{ r.reason }}</div>
          <div class="rep-foot">
            <button
              class="t-btn sm primary"
              :disabled="pendingReplenish(r.sku) || r.ordered"
              @click="confirmReplenish(r)"
            >
              {{ r.ordered ? "已核准下单" : pendingReplenish(r.sku) ? "已进审核看板" : "确认补货 → 人工闸" }}
            </button>
          </div>
        </TPanel>

        <TPanel v-if="!store.replenish.value.length" pad>
          <div class="t-muted" style="text-align: center; padding: 22px">当前无补货建议</div>
        </TPanel>
      </div>
    </template>
  </div>
</template>

<style scoped>
.m6 { padding-bottom: 8px; }

.m6-tabs {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 14px 0 4px;
  flex-wrap: wrap;
}
.m6-ai { margin-left: auto; }

/* 数据行 hover（非交互，仅做视觉聚焦） */
.m6-row { transition: background 0.14s; }
.m6-row:hover { background: var(--panel-hover); }

/* 临期行高亮：常态浅、hover 时以内阴影加深左缘，强调临期 */
.row-exp { background: var(--vermilion-soft); box-shadow: inset 2px 0 0 var(--vermilion); }
.row-exp:hover { background: var(--vermilion-soft); box-shadow: inset 3px 0 0 var(--vermilion); }

/* FEFO 序号徽 */
.fefo-rank {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 800;
  background: var(--bg-soft);
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.fefo-rank.hot { background: var(--vermilion); color: #fff; }

/* 落地成本条 */
.landed-bar {
  width: 96px;
  height: 6px;
  border-radius: 4px;
  background: var(--bg-soft);
  overflow: hidden;
}
.landed-fill { display: block; height: 100%; border-radius: 4px; transition: width 0.6s cubic-bezier(0.22, 0.7, 0.25, 1); }
.landed-fill.green { background: var(--ok); }
.landed-fill.amber { background: #d29628; }
.landed-fill.red { background: var(--vermilion); }

/* 补货卡 */
.rep-list { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 820px) { .rep-list { grid-template-columns: 1fr; } }
.rep-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.14s, box-shadow 0.14s;
}
.rep-card:hover { border-color: var(--primary); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05); }
.rep-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.rep-name { font-size: 13.5px; color: var(--text); }
.rep-meta {
  display: flex;
  align-items: baseline;
  gap: 14px;
  font-size: 12px;
  color: var(--text-2);
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-soft);
}
.rep-qty b { color: var(--gold); font-size: 15px; font-variant-numeric: tabular-nums; }
.rep-by { color: var(--muted); }
.rep-reason { font-size: 12px; line-height: 1.6; color: var(--text-2); flex: 1; }
.rep-foot { display: flex; justify-content: flex-end; margin-top: 2px; }
</style>
