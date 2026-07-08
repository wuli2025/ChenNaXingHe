<script setup lang="ts">
/**
 * E4 · 订单中心
 * 多平台订单归集 + AI 风控标记 + 售后工单流水线。
 * 有界自治分流：归集/风控标记自动；补发/退货成本≤上限自动执行；
 * 退款超 autoRefundCapUsd 进审批闸；风控挂起单由人工过目后放行。
 * 零 props，数据全部取自 useErpStore（ref → .value）。
 */
import { ref, computed } from "vue";
import { useErpStore } from "../useErpStore";
import type { Order, AfterSale, OrderStatus } from "../types";
import TSection from "../../trade/components/TSection.vue";
import TPanel from "../../trade/components/TPanel.vue";
import TBadge from "../../trade/components/TBadge.vue";
import TKpi from "../../trade/components/TKpi.vue";
import { EICONS } from "../types";

const store = useErpStore();

/* 动作结果提示（最近一次操作的反馈）。 */
const hint = ref("");

/* KPI：从订单流实时统计。 */
const kpi = computed(() => {
  const list = store.orders.value;
  const n = (s: OrderStatus) => list.filter((o) => o.status === s).length;
  return { pending: n("pending"), risk: n("risk_hold"), shipped: n("shipped"), refunding: n("refunding") };
});

/* 订单状态 → 徽标文案与色调。 */
const ORDER_STATUS: Record<OrderStatus, { label: string; tone: "amber" | "red" | "blue" | "green" | "gray" }> = {
  pending: { label: "待处理", tone: "amber" },
  risk_hold: { label: "风控挂起", tone: "red" },
  allocated: { label: "已配货", tone: "blue" },
  shipped: { label: "已发货", tone: "green" },
  delivered: { label: "妥投", tone: "green" },
  closed: { label: "关闭", tone: "gray" },
  refunding: { label: "退款中", tone: "red" },
};

/* 售后类型 / 状态映射。 */
const AS_TYPE: Record<AfterSale["type"], string> = { refund: "退款", resend: "补发", return: "退货" };
const AS_STATUS: Record<AfterSale["status"], { label: string; tone: "amber" | "blue" | "green" | "gray" }> = {
  open: { label: "open 待处理", tone: "amber" },
  proposed: { label: "proposed 待审", tone: "blue" },
  done: { label: "done 完成", tone: "green" },
  rejected: { label: "rejected 驳回", tone: "gray" },
};

/* pending 单 → AI 选路发货（策略引擎分流：标准件自动出单 / 高值进渠道闸）。 */
async function route(o: Order) {
  if (store.busy.value) return;
  hint.value = "";
  const r = await store.runRoute(o.id);
  hint.value =
    r === "auto" ? `订单 ${o.id} 已自动选路出单（运单见 E5）`
    : r === "review" ? `订单 ${o.id} 选路提案已入渠道核准闸`
    : `订单 ${o.id} 选路失败，详见右侧控制台`;
}

/* 风控挂起单放行 —— 人工决策走 store（落已执行动作台账，可追溯）。 */
function release(o: Order) {
  if (store.releaseRiskOrder(o.id)) {
    hint.value = `订单 ${o.id} 已放行，可继续 AI 选路发货`;
  }
}

/* 售后走流程 → proposeAfterSale（边界内自动执行 / 超限进审批闸）。 */
function processAs(as: AfterSale) {
  const r = store.proposeAfterSale(as.id);
  hint.value =
    r === "auto" ? `工单 ${as.id} 成本在自动上限内，已自动执行并留痕`
    : r === "review" ? `工单 ${as.id} 已入售后退款审批闸，等你核准`
    : `工单 ${as.id} 已完结，无需再走流程`;
}
</script>

<template>
  <div class="e4 t-view-anim">
    <!-- 分流说明 -->
    <div class="e-gates">
      <span class="e-auto">AI 自动</span>
      <span>多平台订单归集 · 风控标记 · 补发/退货成本≤自动上限直接执行</span>
      <span class="e-human soft">需审批</span>
      <span>退款超 <b>${{ store.params.value.autoRefundCapUsd }}</b> 进售后审批闸</span>
      <span class="e-human">人工过目</span>
      <span>风控挂起单必须人工放行后才回到履约流</span>
    </div>

    <!-- KPI 概览 -->
    <div class="t-grid t-g4">
      <TKpi
        :value="String(kpi.pending)"
        label="待处理"
        acc="amber"
        :icon="EICONS.orders"
      />
      <TKpi
        :value="String(kpi.risk)"
        label="风控挂起"
        :up="kpi.risk === 0"
        acc="red"
        delta="需人工过目"
        :icon="EICONS.human"
      />
      <TKpi
        :value="String(kpi.shipped)"
        label="已发货"
        acc="green"
        :icon="EICONS.logistics"
      />
      <TKpi
        :value="String(kpi.refunding)"
        label="退款中"
        :up="kpi.refunding === 0"
        acc="red"
        :icon="EICONS.finance"
      />
    </div>

    <div
      v-if="hint"
      class="t-note info"
    >
      {{ hint }}
    </div>

    <TSection
      title="订单流水"
      sub="多平台归集 · AI 风控标记行高亮 · pending 可一键 AI 选路"
    >
      <template #actions>
        <span class="t-pill">{{ store.orders.value.length }} 单</span>
      </template>
    </TSection>

    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>订单号</th>
            <th>平台</th>
            <th>商品 × 数量</th>
            <th class="num">
              金额 $
            </th>
            <th>国家</th>
            <th>状态</th>
            <th>下单</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="o in store.orders.value"
            :key="o.id"
            :class="{ 'row-risk': !!o.riskFlag }"
            :title="o.riskFlag || undefined"
          >
            <td>
              <b class="t-mono">{{ o.id }}</b>
              <div
                v-if="o.riskFlag"
                class="risk-txt"
              >
                {{ o.riskFlag }}
              </div>
            </td>
            <td>{{ o.platform }}</td>
            <td>{{ o.goods }} × {{ o.qty }}</td>
            <td class="num t-mono">
              ${{ o.amountUsd.toFixed(2) }}
            </td>
            <td class="t-mono">
              {{ o.country }}
            </td>
            <td>
              <TBadge :tone="ORDER_STATUS[o.status].tone">
                {{ ORDER_STATUS[o.status].label }}
              </TBadge>
            </td>
            <td class="t-mono t-muted">
              {{ o.placedAt }}
            </td>
            <td style="text-align: right">
              <button
                v-if="o.status === 'pending'"
                class="t-btn sm gold"
                :disabled="store.busy.value"
                @click="route(o)"
              >
                {{ store.busy.value ? "选路中…" : "AI 选路发货" }}
              </button>
              <button
                v-else-if="o.status === 'risk_hold'"
                class="t-btn sm primary"
                @click="release(o)"
              >
                放行
              </button>
            </td>
          </tr>
          <tr v-if="!store.orders.value.length">
            <td
              colspan="8"
              class="t-muted"
              style="text-align: center; padding: 26px"
            >
              暂无订单
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>

    <TSection
      title="售后工单"
      sub="退款 / 补发 / 退货 · AI 先出方案，边界内自动执行，超限进审批闸"
    >
      <template #actions>
        <span class="t-pill">{{ store.afterSales.value.length }} 单</span>
      </template>
    </TSection>

    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>工单</th>
            <th>订单</th>
            <th>类型</th>
            <th>原因</th>
            <th class="num">
              金额 $
            </th>
            <th>状态</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="as in store.afterSales.value"
            :key="as.id"
          >
            <td><b class="t-mono">{{ as.id }}</b></td>
            <td class="t-mono">
              {{ as.orderId }}
            </td>
            <td>{{ AS_TYPE[as.type] }}</td>
            <td>
              {{ as.reason }}
              <div
                v-if="as.proposal"
                class="t-muted"
                style="font-size: 11px; margin-top: 2px"
              >
                AI 方案：{{ as.proposal }}
              </div>
            </td>
            <td
              class="num t-mono"
              :class="{ 't-warn-txt': as.amountUsd > store.params.value.autoRefundCapUsd }"
            >
              ${{ as.amountUsd.toFixed(2) }}
            </td>
            <td>
              <TBadge :tone="AS_STATUS[as.status].tone">
                {{ AS_STATUS[as.status].label }}
              </TBadge>
            </td>
            <td style="text-align: right">
              <button
                v-if="as.status === 'open' || as.status === 'proposed'"
                class="t-btn sm primary"
                @click="processAs(as)"
              >
                走流程
              </button>
            </td>
          </tr>
          <tr v-if="!store.afterSales.value.length">
            <td
              colspan="7"
              class="t-muted"
              style="text-align: center; padding: 26px"
            >
              暂无售后工单
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>
  </div>
</template>

<style scoped>
/* 风控标记行：左缘红条 + 浅红底，一眼锁定 */
.row-risk { background: var(--vermilion-soft); box-shadow: inset 2px 0 0 var(--vermilion); }
.risk-txt { font-size: 11px; color: var(--vermilion); margin-top: 2px; max-width: 260px; }
</style>
