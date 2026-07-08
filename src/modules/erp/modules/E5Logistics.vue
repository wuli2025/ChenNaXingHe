<script setup lang="ts">
/**
 * E5 · 物流管理
 * 渠道报价库 + 运单全程跟踪 + 停滞件索赔。
 * 有界自治分流：标准件由物流官自动比价选路出单；
 * 货值≥highValueShipmentUsd 的渠道选择进审批闸；索赔函外发一律进审批闸。
 * 零 props，数据全部取自 useErpStore（ref → .value）。
 */
import { ref } from "vue";
import { useErpStore } from "../useErpStore";
import type { ErpShipment } from "../types";
import TSection from "../../trade/components/TSection.vue";
import TPanel from "../../trade/components/TPanel.vue";
import TBadge from "../../trade/components/TBadge.vue";

const store = useErpStore();

/* 动作结果提示。 */
const hint = ref("");

/* 运单状态 → 徽标色（停滞标红）。 */
function statusTone(s: ErpShipment): "red" | "green" | "blue" | "amber" | "purple" {
  if (s.stalled || s.status === "停滞") return "red";
  if (s.status === "妥投") return "green";
  if (s.status === "派送中") return "amber";
  if (s.status === "索赔中") return "purple";
  return "blue"; // 已出单 / 运输中
}

/* 停滞运单 → 发起索赔：索赔函外发属审批闸动作，AI 只备好函件材料。 */
function claim(sh: ErpShipment) {
  store.enqueueReview({
    mod: "e5",
    kind: "claim-send",
    title: `索赔函外发核准 · ${sh.id}`,
    refId: sh.id,
    origin: "manual",
    summary: `运单停滞 ${sh.days} 天，拟向 ${sh.channel} 发起查询与索赔。`,
    reasoning: "轨迹停滞超过渠道承诺时效上限。",
    consequence: "不索赔则运费与货值损失自担。",
    facts: [
      { k: "运单", v: sh.id },
      { k: "停滞", v: `${sh.days} 天`, warn: true },
      { k: "渠道", v: sh.channel },
    ],
    risk: "high",
    payload: {},
  });
  hint.value = `运单 ${sh.id} 的索赔函外发核准已入审批闸，批准后才对外发出。`;
}
</script>

<template>
  <div class="e5 t-view-anim">
    <!-- 分流说明 -->
    <div class="e-gates">
      <span class="e-auto">AI 自动</span>
      <span>标准件比价选路 · 出单 · 轨迹追踪，自动执行并写选路理由</span>
      <span class="e-human soft">需审批</span>
      <span>货值 ≥ <b>${{ store.params.value.highValueShipmentUsd }}</b> 的渠道选择进审批闸</span>
      <span class="e-human soft">需审批</span>
      <span>索赔函外发前必须人工核准</span>
    </div>

    <div
      v-if="hint"
      class="t-note info"
    >
      {{ hint }}
    </div>

    <TSection
      title="渠道报价库"
      sub="首重 + 续重 + 时效 + 带电资质 · 物流官比价选路的单点数据源"
    >
      <template #actions>
        <span class="t-pill">{{ store.channels.value.length }} 条渠道</span>
      </template>
    </TSection>

    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>渠道名称</th>
            <th>分区</th>
            <th class="num">
              首重 ¥
            </th>
            <th class="num">
              续重 ¥/g
            </th>
            <th>时效（天）</th>
            <th>带电</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in store.channels.value"
            :key="c.id"
          >
            <td><b>{{ c.name }}</b></td>
            <td>{{ c.zone }}</td>
            <td class="num t-mono">
              {{ c.firstWeightCny }}
            </td>
            <td class="num t-mono">
              {{ c.perGramCny }}
            </td>
            <td class="t-mono">
              {{ c.days }}
            </td>
            <td>
              <TBadge
                v-if="c.battery"
                tone="green"
              >
                ✓ 可带电
              </TBadge>
              <span
                v-else
                class="t-muted"
              >—</span>
            </td>
            <td class="t-muted">
              {{ c.note || "—" }}
            </td>
          </tr>
          <tr v-if="!store.channels.value.length">
            <td
              colspan="7"
              class="t-muted"
              style="text-align: center; padding: 26px"
            >
              暂无渠道报价
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>

    <TSection
      title="运单跟踪"
      sub="全程轨迹 · 停滞预警 · 停滞件可一键发起索赔（进审批闸）"
    >
      <template #actions>
        <span class="t-pill">{{ store.shipments.value.length }} 票</span>
        <span
          v-if="store.stalledShipments.value.length"
          class="e-human"
        >
          {{ store.stalledShipments.value.length }} 票停滞
        </span>
      </template>
    </TSection>

    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>运单号</th>
            <th>订单</th>
            <th>货物</th>
            <th>目的地</th>
            <th>渠道</th>
            <th class="num">
              重量 g
            </th>
            <th class="num">
              运费 ¥
            </th>
            <th>状态</th>
            <th class="num">
              在途天数
            </th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="sh in store.shipments.value"
            :key="sh.id"
            :class="{ 'row-stall': sh.stalled || sh.status === '停滞' }"
            :title="sh.routeReason || undefined"
          >
            <td><b class="t-mono">{{ sh.id }}</b></td>
            <td class="t-mono">
              {{ sh.orderId }}
            </td>
            <td>{{ sh.goods }}</td>
            <td class="t-mono">
              {{ sh.to }}
            </td>
            <td>{{ sh.channel }}</td>
            <td class="num t-mono">
              {{ sh.weightG.toLocaleString() }}
            </td>
            <td class="num t-mono">
              {{ sh.costCny.toLocaleString() }}
            </td>
            <td>
              <TBadge :tone="statusTone(sh)">
                {{ sh.status }}
              </TBadge>
            </td>
            <td
              class="num t-mono"
              :class="{ 't-warn-txt': sh.stalled }"
            >
              {{ sh.days }}
            </td>
            <td style="text-align: right">
              <button
                v-if="sh.stalled || sh.status === '停滞'"
                class="t-btn sm"
                @click="claim(sh)"
              >
                发起索赔
              </button>
            </td>
          </tr>
          <tr v-if="!store.shipments.value.length">
            <td
              colspan="10"
              class="t-muted"
              style="text-align: center; padding: 26px"
            >
              暂无运单 —— 在 E4 订单中心对 pending 订单点「AI 选路发货」后自动出单。
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>

    <!-- 选路逻辑说明 -->
    <div class="t-note info">
      <b>选路逻辑：</b>物流官按 <b>成本权重 0.7 + 时效权重 0.3</b> 对渠道库综合打分选路；
      带电货物<b>强制过滤为可带电渠道</b>后再比价。每票运单的「选路理由」随单落库（鼠标悬停行可见），
      自动出单与人工核准出单同走一个执行函数，全部留台账可追溯。
    </div>
  </div>
</template>

<style scoped>
/* 停滞运单行：左缘红条 + 浅红底 */
.row-stall { background: var(--vermilion-soft); box-shadow: inset 2px 0 0 var(--vermilion); }
</style>
