<script setup lang="ts">
/**
 * M8 · 财务对账 —— 复式账本 / 三方单据匹配 / 申报外接。
 *
 * 零 props。数据全部来自 useTradeStore（单例）。
 *  - 顶部财务 KPI（本月分销额 / 本月采购成本 / 未达账项 / Q3 进口税费）。
 *  - store.recon 三方单据匹配表：置信度条(TConf) + 状态徽标(TBadge)。
 *  - 「未达」行 → await store.runRecon(item)：AI 生成候选并进 recon-match 人工闸。
 *  - 「待确认」行 → 确认回写：store.enqueueReview({mod:'m8',kind:'recon-match',...}) 进人工看板。
 *  - Q3 进口税费用 computeWineTax（与 M4/M9 同一单点真相）汇总。
 *  - 复式账本 / BAS 草稿 / STP 外接 用 t-note 概述。
 */
import { computed } from "vue";
import { useTradeStore } from "../useTradeStore";
import { computeWineTax, ICONS } from "../types";
import type { ReconMatch } from "../types";
import TSection from "../components/TSection.vue";
import TPanel from "../components/TPanel.vue";
import TBadge from "../components/TBadge.vue";
import TConf from "../components/TConf.vue";
import TKpi from "../components/TKpi.vue";
import TIcon from "../components/TIcon.vue";

const store = useTradeStore();

/* ── 派生：状态计数 ── */
const openCount = computed(() => store.recon.value.filter((r) => r.status === "未达").length);
const pendingMatch = computed(() => store.recon.value.filter((r) => r.status === "待确认").length);
const matchedCount = computed(() => store.recon.value.filter((r) => r.status === "已匹配").length);

/* ── Q3 进口税费：对三柜完税价值(CIF)汇总走单点真相 computeWineTax ── */
const q3Tax = computed(() => {
  const taxable = store.declarations.value.reduce((s, d) => s + d.cif, 0);
  return computeWineTax(taxable);
});

/* ── 状态 → 徽标色 ── */
function statusTone(s: string): "green" | "amber" | "red" {
  return s === "已匹配" ? "green" : s === "未达" ? "red" : "amber";
}
function statusLabel(s: string): string {
  return s === "已匹配" ? "已匹配" : s === "未达" ? "未达账项" : "待确认";
}

/* ── 未达 → AI 辅助对账：内部生成候选并进 recon-match 人工闸 ── */
async function aiRecon(r: ReconMatch) {
  if (store.busy.value) return;
  await store.runRecon(r.item);
}

/* ── 待确认 → 确认回写：显式派进人工审核看板（recon-match 闸） ── */
function confirmWriteback(r: ReconMatch) {
  if (store.busy.value) return;
  store.enqueueReview({
    mod: "m8",
    kind: "recon-match",
    title: `${r.item} 匹配确认`,
    refId: r.item,
    summary: `${r.amount} 匹配候选 ${r.match}（AI 置信 ${r.conf}%），确认后回写复式账本、置为已匹配。`,
    facts: [
      { k: "金额", v: r.amount },
      { k: "候选匹配", v: r.match },
      { k: "AI 置信", v: `${r.conf}%`, warn: r.conf < 85 },
    ],
    risk: "normal",
  });
}
</script>

<template>
  <div class="t-view-anim">
    <!-- 顶部财务 KPI -->
    <div class="t-grid t-g4">
      <TKpi value="$1.14M" label="本月分销额" delta="环比 +12%" :up="true" acc="green" :icon="ICONS.customer" />
      <TKpi value="$0.78M" label="本月采购 / 成本" delta="含货代 + 落地成本" acc="blue" :icon="ICONS.purchase" />
      <TKpi
        :value="openCount.toString()"
        label="未达账项"
        :delta="pendingMatch + ' 笔待确认回写'"
        :up="false"
        acc="purple"
        :icon="ICONS.finance"
      />
      <TKpi
        :value="'$' + (q3Tax.totalTax / 1000).toFixed(1) + 'K'"
        label="Q3 进口税费 WET+GST"
        :delta="'完税价 $' + (q3Tax.taxable / 1000).toFixed(0) + 'K · 三柜'"
        acc="amber"
        :icon="ICONS.customs"
      />
    </div>

    <!-- 三方单据匹配 -->
    <TSection title="三方单据匹配" sub="采购 / 物流 / 分销 · 复式账本 · AI 生成候选匹配">
      <template #actions>
        <span class="t-pill">已匹配 {{ matchedCount }}</span>
        <span class="t-pill">待确认 {{ pendingMatch }}</span>
        <span class="t-pill">未达 {{ openCount }}</span>
      </template>
    </TSection>

    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>单据</th>
            <th class="num">金额</th>
            <th>候选匹配</th>
            <th style="width: 200px">置信度</th>
            <th>状态</th>
            <th style="width: 128px; text-align: right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in store.recon.value" :key="r.item" class="recon-row">
            <td><b>{{ r.item }}</b></td>
            <td class="num t-mono">{{ r.amount }}</td>
            <td :class="{ 't-muted': r.conf === 0 }">{{ r.match }}</td>
            <td class="conf-cell">
              <TConf v-if="r.conf > 0" :value="r.conf" />
              <TBadge v-else tone="red">无候选</TBadge>
            </td>
            <td><TBadge :tone="statusTone(r.status)">{{ statusLabel(r.status) }}</TBadge></td>
            <td style="text-align: right">
              <button
                v-if="r.status === '未达'"
                class="t-btn sm gold"
                :disabled="store.busy.value"
                @click="aiRecon(r)"
              >
                <TIcon :path="ICONS.finance" :size="13" /> AI 辅助对账
              </button>
              <button
                v-else-if="r.status === '待确认'"
                class="t-btn sm primary"
                :disabled="store.busy.value"
                @click="confirmWriteback(r)"
              >
                <TIcon :path="ICONS.review" :size="13" /> 确认回写
              </button>
              <span v-else class="t-muted" style="font-size: 11px">已入账</span>
            </td>
          </tr>
          <tr v-if="store.recon.value.length === 0">
            <td colspan="6">
              <div class="t-empty">暂无待对账单据 · 采购 / 物流 / 分销三方凭证到齐后自动汇入。</div>
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>

    <!-- 未达账项业务提示 -->
    <div v-if="openCount > 0" class="t-note warn">
      <b>{{ openCount }} 笔未达账项</b>：候选缺失或金额对不上，点右侧「AI 辅助对账」让 Claude 拉取 PO / 落地成本 / 银行流水生成候选，
      候选生成后自动进「对账匹配确认」<b>人工闸</b>，人工通过才回写账本。
    </div>
    <div v-else-if="pendingMatch > 0" class="t-note info">
      有 <b>{{ pendingMatch }} 笔</b>已有 AI 候选待人工确认。点「确认回写」派进审核看板（recon-match 闸），
      通过后置为「已匹配」并落复式账本。
    </div>

    <!-- 复式账本 / BAS 草稿 -->
    <TSection title="复式账本 / BAS 草稿" sub="系统只做核算与结构化，申报动作外接" />
    <div class="t-grid t-g2">
      <div class="t-note info">
        <b>复式记账（借贷平衡）</b><br />
        每笔匹配确认后按科目自动生成分录：采购入库计<b>存货</b>与<b>应付账款</b>，
        进口税费计 <b>WET/GST 进项</b>，分销回款冲<b>应收账款</b>。当前三方匹配率
        <b>{{ matchedCount }}/{{ store.recon.value.length }}</b>，未达项不入账、挂「待对账」科目。
      </div>
      <div class="t-note ok">
        <b>Q3 BAS 税务草稿</b><br />
        进口 WET（29%）<b class="t-mono">AUD {{ q3Tax.wet.toLocaleString() }}</b> ·
        GST（10%，含 WET 基数）<b class="t-mono">AUD {{ q3Tax.gst.toLocaleString() }}</b> ·
        合计进口税费 <b class="t-mono">AUD {{ q3Tax.totalTax.toLocaleString() }}</b>。
        与 M4 报关、M9 合规同一 <span class="t-mono">computeWineTax()</span> 函数，逐分位一致。
      </div>
    </div>

    <!-- 申报外接 -->
    <div class="t-note info">
      <b>算自己做，报交出去</b>：BAS 季度税草稿、工资 <b>STP</b> 申报走<b>外接</b>——
      系统只负责核算与结构化产出，不自建直连 ATO 通道，草稿导出后由会计 / 记账软件（Xero / MYOB）提交。
    </div>
  </div>
</template>

<style scoped>
.t-empty {
  text-align: center;
  padding: 26px 12px;
  color: var(--muted);
  font-size: 12px;
}
.t-pill + .t-pill {
  margin-left: 2px;
}
/* 单据行悬浮反馈（含操作按钮的可交互行） */
.recon-row {
  transition: background 0.14s;
}
.recon-row:hover {
  background: var(--panel-hover);
}
/* 置信度 / 无候选徽标统一垂直居中，右侧留出与操作列的呼吸间距 */
.conf-cell :deep(.t-conf),
.conf-cell :deep(.t-badge) {
  vertical-align: middle;
}
</style>
