<script setup lang="ts">
/**
 * E6 · 采购库存
 * 四态库存（本地/海外仓/FBA/在途）+ 智能补货 + PO 三单匹配 + 强制人工付款闸。
 * 有界自治分流：补货测算与 PO 草案由供应链官自动产出；PO 创建进审批闸；
 * 付款是 HUMAN_ONLY_ACTIONS 硬闸 —— 无论参数怎么调都不会自动付款。
 * 零 props，数据全部取自 useErpStore（ref → .value）。
 */
import { ref, computed } from "vue";
import { useErpStore } from "../useErpStore";
import type { StockRow, PurchaseOrder } from "../types";
import TSection from "../../trade/components/TSection.vue";
import TPanel from "../../trade/components/TPanel.vue";
import TBadge from "../../trade/components/TBadge.vue";

const store = useErpStore();

/* 动作结果提示。 */
const hint = ref("");

/* 补货警戒线（天）= 安全库存 + 备货周期，随参数中心联动。 */
const alertDays = computed(() => store.params.value.safetyStockDays + store.params.value.leadTimeDays);

/* 是否需要补货：可售天数撑不过「安全库存 + 备货周期」。 */
function needRestock(s: StockRow): boolean {
  return s.daysLeft < alertDays.value;
}

/* PO 状态 → 徽标文案与色调。 */
const PO_STATUS: Record<PurchaseOrder["status"], { label: string; tone: "gray" | "red" | "green" | "blue" | "amber" }> = {
  draft: { label: "draft 草稿", tone: "gray" },
  pending_pay: { label: "待付款", tone: "red" },
  paid: { label: "已付", tone: "green" },
  producing: { label: "生产中", tone: "blue" },
  inbound: { label: "在途", tone: "amber" },
  received: { label: "已收货", tone: "green" },
};

/* 智能补货测算 → runReplenish：每条建议都进审批中心的 PO 确认闸。 */
async function replenish() {
  if (store.busy.value) return;
  hint.value = "";
  const n = await store.runReplenish();
  hint.value = n > 0
    ? `供应链官产出 ${n} 条补货建议，已全部进入审批中心的 PO 确认闸。`
    : "未产出补货建议（库存健康或测算失败，详见右侧控制台）。";
}

/* 付款确认 —— 强制人工闸：只把 PO 送进审批中心，绝不在此直接改状态。 */
function pay(po: PurchaseOrder) {
  store.gatePoPayment(po.id);
  hint.value = `${po.id} 已入强制人工付款闸，去审批中心确认后才会执行付款。`;
}
</script>

<template>
  <div class="e6 t-view-anim">
    <!-- 分流说明 -->
    <div class="e-gates">
      <span class="e-auto">AI 自动</span>
      <span>补货测算 · PO 草案由供应链官自动产出</span>
      <span class="e-human soft">需审批</span>
      <span>PO 创建须过审批中心的补货确认闸</span>
      <span class="e-human">强制人工</span>
      <span><b>付款永远人工确认</b> —— 写死在核心层的强制人工清单，无论参数怎么调都不会自动付款</span>
    </div>

    <div
      v-if="hint"
      class="t-note info"
    >
      {{ hint }}
    </div>

    <TSection
      title="四态库存"
      sub="本地 / 海外仓 / FBA / 在途 · 可售天数低于警戒线自动标红"
    >
      <template #actions>
        <span class="t-pill">警戒线 {{ alertDays }} 天（安全 {{ store.params.value.safetyStockDays }} + 周期 {{ store.params.value.leadTimeDays }}）</span>
        <button
          class="t-btn sm gold"
          :disabled="store.busy.value"
          @click="replenish"
        >
          {{ store.busy.value ? "测算中…" : "智能补货测算" }}
        </button>
      </template>
    </TSection>

    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>名称</th>
            <th class="num">
              本地
            </th>
            <th class="num">
              海外仓
            </th>
            <th class="num">
              FBA
            </th>
            <th class="num">
              在途
            </th>
            <th class="num">
              日均销
            </th>
            <th class="num">
              可售天数
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="s in store.stock.value"
            :key="s.sku"
            :class="{ 'row-low': needRestock(s) }"
          >
            <td class="t-mono">
              {{ s.sku }}
            </td>
            <td><b>{{ s.name }}</b></td>
            <td class="num t-mono">
              {{ s.local.toLocaleString() }}
            </td>
            <td class="num t-mono">
              {{ s.overseas.toLocaleString() }}
            </td>
            <td class="num t-mono">
              {{ s.fba.toLocaleString() }}
            </td>
            <td class="num t-mono">
              {{ s.transit.toLocaleString() }}
            </td>
            <td class="num t-mono">
              {{ s.dailySales }}
            </td>
            <td
              class="num"
              :class="{ 't-warn-txt': needRestock(s) }"
            >
              {{ s.daysLeft }} 天
              <TBadge
                v-if="needRestock(s)"
                tone="red"
              >
                需补货
              </TBadge>
            </td>
          </tr>
          <tr v-if="!store.stock.value.length">
            <td
              colspan="8"
              class="t-muted"
              style="text-align: center; padding: 26px"
            >
              暂无库存数据
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>

    <div class="t-note warn">
      <b>补货链路：</b>「智能补货测算」由供应链官按 销速 × (安全库存 + 备货周期) − 现有四态库存 产出建议量，
      <b>每条建议都会进审批中心的 PO 确认闸</b>；核准后自动建 PO（待付款），付款再过一道强制人工闸。
    </div>

    <TSection
      title="采购单 PO"
      sub="三单匹配（PO ↔ 发票 ↔ 到货 GRN）· 待付款单一键送强制人工付款闸"
    >
      <template #actions>
        <span class="t-pill">{{ store.pos.value.length }} 张</span>
      </template>
    </TSection>

    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>PO 号</th>
            <th>供应商</th>
            <th>货物 × 数量</th>
            <th class="num">
              单价 ¥
            </th>
            <th class="num">
              金额 ¥
            </th>
            <th>状态</th>
            <th>三单匹配</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="po in store.pos.value"
            :key="po.id"
          >
            <td><b class="t-mono">{{ po.id }}</b></td>
            <td>{{ po.supplier }}</td>
            <td>{{ po.goods }} × {{ po.qty.toLocaleString() }}</td>
            <td class="num t-mono">
              {{ po.unitCny }}
            </td>
            <td class="num t-mono">
              <b>{{ po.amountCny.toLocaleString() }}</b>
            </td>
            <td>
              <TBadge :tone="PO_STATUS[po.status].tone">
                {{ PO_STATUS[po.status].label }}
              </TBadge>
            </td>
            <td>
              <span
                class="match"
                :class="{ warn: !(po.invoiceOk && po.grnOk) }"
              >
                发票 {{ po.invoiceOk ? "✓" : "✗" }} · 到货 {{ po.grnOk ? "✓" : "✗" }}
              </span>
              <TBadge
                v-if="!(po.invoiceOk && po.grnOk)"
                tone="amber"
              >
                未齐
              </TBadge>
            </td>
            <td style="text-align: right">
              <button
                v-if="po.status === 'pending_pay'"
                class="t-btn sm primary"
                @click="pay(po)"
              >
                付款确认
              </button>
            </td>
          </tr>
          <tr v-if="!store.pos.value.length">
            <td
              colspan="8"
              class="t-muted"
              style="text-align: center; padding: 26px"
            >
              暂无采购单 —— 补货建议经审批核准后自动生成 PO。
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>
  </div>
</template>

<style scoped>
/* 低库存行：左缘红条 + 浅红底 */
.row-low { background: var(--vermilion-soft); box-shadow: inset 2px 0 0 var(--vermilion); }

/* 三单匹配小字：未齐时转警示色 */
.match { font-size: 12px; color: var(--text-2); margin-right: 6px; }
.match.warn { color: #b7791f; font-weight: 600; }
</style>
