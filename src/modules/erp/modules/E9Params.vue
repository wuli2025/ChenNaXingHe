<script setup lang="ts">
/**
 * E9 · 参数中心 —— 系统「宪法」：AI 一切行为参数的单点真相，改参数 = 改经营策略。
 *
 * 零 props。数据/动作全部来自 useErpStore（状态皆 ref，须 .value）。
 *  - 普通参数：store.setParam() 返回 "applied"，即时生效并记版本（.e-auto）。
 *  - 红线/自治边界参数（CRITICAL_PARAMS）：setParam() 返回 "review"，
 *    入 param-change 审批闸，批准后才生效（.e-human.soft）。
 *  - 付款 / 报税提交（HUMAN_ONLY_ACTIONS）与参数无关，写死在核心层，永远人工（.e-human）。
 */
import { ref, watch } from "vue";
import { useErpStore } from "../useErpStore";
import type { ErpParams } from "../types";
import TSection from "../../trade/components/TSection.vue";
import TPanel from "../../trade/components/TPanel.vue";

const store = useErpStore();

/* ── 参数元数据：6 组 · 中文名 + 说明 + 单位 + 是否红线 ── */
interface ParamRow { key: keyof ErpParams; label: string; unit: string; desc: string; redline?: boolean }
const GROUPS: { title: string; sub: string; rows: ParamRow[] }[] = [
  {
    title: "经营目标", sub: "定价与驾驶舱达成率的基准",
    rows: [
      { key: "targetMarginPct", label: "目标净利率", unit: "%", desc: "定价引擎按此反推目标价" },
      { key: "minMarginFloorPct", label: "最低毛利率红线", unit: "%", desc: "保本硬底线，任何调价不得击穿", redline: true },
      { key: "monthlyGmvTarget", label: "月度GMV目标", unit: "USD", desc: "驾驶舱达成率的分母" },
    ],
  },
  {
    title: "定价策略", sub: "动态调价的自动带宽与汇率触发",
    rows: [
      { key: "priceAutoBandPct", label: "自动调价带宽", unit: "±%", desc: "带宽内 AI 自动调价，超幅进审批", redline: true },
      { key: "fxRecalcThresholdPct", label: "汇率重算阈值", unit: "%", desc: "汇率波动超阈值触发全线价格重算" },
    ],
  },
  {
    title: "自治边界", sub: "策略引擎 decide() 的分流依据",
    rows: [
      { key: "autoAmountCapUsd", label: "单笔自动执行上限", unit: "USD", desc: "超过此金额的动作一律进审批", redline: true },
      { key: "autoRefundCapUsd", label: "自动退款上限", unit: "USD", desc: "超出进审批，大额退款绝不静默执行", redline: true },
      { key: "dailyActionCap", label: "每日自动动作上限", unit: "次", desc: "单日自动动作限频，宁停勿错", redline: true },
    ],
  },
  {
    title: "财税", sub: "E7 票据 OCR 自动入账的双闸",
    rows: [
      { key: "ocrAutoBookConf", label: "OCR自动入账置信阈值", unit: "%", desc: "低于阈值的票据进人工确认闸", redline: true },
      { key: "ocrAutoBookCapCny", label: "自动入账金额上限", unit: "CNY", desc: "大额票据即使高置信也需人工", redline: true },
    ],
  },
  {
    title: "库存物流", sub: "补货测算与渠道审批阈值",
    rows: [
      { key: "safetyStockDays", label: "安全库存", unit: "天", desc: "可售天数低于安全线触发补货建议" },
      { key: "leadTimeDays", label: "备货周期", unit: "天", desc: "补货测算的生产 + 头程周期" },
      { key: "highValueShipmentUsd", label: "高值件阈值", unit: "USD", desc: "达到阈值的货件渠道选择进审批" },
    ],
  },
  {
    title: "成本模型", sub: "利润测算单点真相 computeProfit 的假设",
    rows: [
      { key: "platformFeePct", label: "平台佣金", unit: "%", desc: "利润测算的平台费用假设" },
      { key: "adCostPct", label: "广告占比假设", unit: "%", desc: "利润测算的广告费假设" },
      { key: "returnRatePct", label: "退货率假设", unit: "%", desc: "利润测算的退货损失假设" },
      { key: "usdCny", label: "记账汇率USD→CNY", unit: "", desc: "USD 票据折 CNY 入账用" },
      { key: "eurUsd", label: "汇率EUR→USD", unit: "", desc: "EUR 金额折算用" },
    ],
  },
];

/** 参数 key → 中文名（改动历史表用）。 */
const LABEL: Record<string, string> = Object.fromEntries(
  GROUPS.flatMap((g) => g.rows.map((r) => [r.key, r.label]))
);

/* ── 本地草稿：编辑不即刻生效，点「保存」逐 key 过 setParam 分流 ── */
const draft = ref<Record<string, number>>({ ...store.params.value });
watch(() => store.params.value, (v) => { draft.value = { ...v }; }, { deep: true });

/* ── 保存：applied=即时生效 / review=入审批闸 / invalid=非法值被核心层拒绝 ── */
const tip = ref<{ key: string; text: string; tone: "ok" | "warn" } | null>(null);
function save(row: ParamRow) {
  const val = Number(draft.value[row.key]);
  // 清空的输入框经 v-model.number 会变 ""，Number("")===0 —— 0/负数会让保本价除零爆 Infinity，
  // 前端先拦一道；store.setParam 内部还有同样的核心层校验兜底。
  if (!Number.isFinite(val) || val <= 0) {
    tip.value = { key: row.key, text: "无效值（须为正数），未保存", tone: "warn" };
    draft.value[row.key] = store.params.value[row.key];
    return;
  }
  const r = store.setParam(row.key, val);
  tip.value = r === "review"
    ? { key: row.key, text: "已入审批闸，批准后生效", tone: "warn" }
    : r === "invalid"
      ? { key: row.key, text: "无效值，已被核心层拒绝", tone: "warn" }
      : { key: row.key, text: "已生效", tone: "ok" };
}

/* ── 时间格式（改动历史） ── */
function fmtTime(at: number): string {
  const d = new Date(at);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/* ── 危险操作：恢复出厂并清空全部数据 ── */
function doReset() {
  if (confirm("确认恢复出厂设置并重置全部数据？所有票据、凭证、审批记录都会清空，此操作不可撤销。")) {
    store.resetAll();
  }
}
</script>

<template>
  <div class="e9-params t-view-anim">
    <!-- 分流说明：参数改动本身也过闸 -->
    <div class="e-gates">
      <span class="e-auto">自动</span>
      <span>普通参数改动<b>即时生效</b>并记版本历史</span>
      <span class="e-human soft">需审批</span>
      <span>红线 / 自治边界参数（保本红线、自动上限、OCR 双闸、调价带宽、限频）改动进 <b>param-change</b> 审批闸</span>
      <span class="e-human">强制人工</span>
      <span><b>付款 / 报税提交</b>写死在核心层，与参数无关，永远人工</span>
    </div>

    <!-- 参数编辑：6 组 -->
    <template
      v-for="g in GROUPS"
      :key="g.title"
    >
      <TSection
        :title="g.title"
        :sub="g.sub"
      />
      <TPanel pad>
        <div
          v-for="row in g.rows"
          :key="row.key"
          class="p-row"
        >
          <div class="p-info">
            <span class="p-label">
              {{ row.label }}
              <span
                v-if="row.redline"
                class="e-human soft"
              >改动需确认</span>
            </span>
            <span class="p-desc t-muted">{{ row.desc }}</span>
          </div>
          <div class="p-edit">
            <input
              v-model.number="draft[row.key]"
              type="number"
              step="any"
              class="p-input"
            >
            <span class="p-unit t-muted">{{ row.unit || "—" }}</span>
            <button
              class="t-btn sm primary"
              :disabled="Number(draft[row.key]) === store.params.value[row.key]"
              @click="save(row)"
            >
              保存
            </button>
            <span
              v-if="tip && tip.key === row.key"
              class="p-tip"
              :class="tip.tone"
            >{{ tip.text }}</span>
          </div>
        </div>
      </TPanel>
    </template>

    <!-- 改动历史：每一次生效都有版本可追 -->
    <TSection
      title="改动历史"
      sub="参数版本台账 · 谁改的 · 从多少到多少"
    >
      <template #actions>
        <span class="t-pill">共 {{ store.paramLog.value.length }} 次</span>
      </template>
    </TSection>
    <TPanel>
      <table class="t-table">
        <thead>
          <tr><th>时间</th><th>参数</th><th>变化</th><th>by</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr
            v-for="(c, i) in store.paramLog.value"
            :key="c.at + '-' + i"
          >
            <td class="t-mono">
              {{ fmtTime(c.at) }}
            </td>
            <td><b>{{ LABEL[c.key] || c.key }}</b> <span class="t-mono t-muted">{{ c.key }}</span></td>
            <td class="t-mono">
              {{ c.from }} → {{ c.to }}
            </td>
            <td>
              <span
                v-if="c.by === 'human'"
                class="e-human soft"
              >人工</span>
              <span
                v-else
                class="e-auto"
              >AI</span>
            </td>
            <td class="t-muted">
              {{ c.note || "—" }}
            </td>
          </tr>
          <tr v-if="!store.paramLog.value.length">
            <td
              colspan="5"
              class="t-muted empty-cell"
            >
              暂无改动 —— 保存任一参数后自动记录版本。
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>

    <!-- 危险区 -->
    <TSection
      title="危险区"
      sub="恢复出厂：清空 localStorage 全部业务数据并重新播种"
    />
    <div class="t-note danger reset-note">
      <span>
        <b>恢复出厂并重置全部数据：</b>票据、凭证、订单、审批记录、参数版本全部清空，回到种子数据。
      </span>
      <button
        class="t-btn sm reset-btn"
        @click="doReset"
      >
        恢复出厂并重置全部数据
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 参数行：左信息 + 右编辑 */
.p-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border-soft);
}
.p-row:last-child { border-bottom: none; }
.p-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.p-label { font-size: 12.5px; font-weight: 700; color: var(--text); display: inline-flex; align-items: center; gap: 8px; }
.p-desc { font-size: 11px; }
.p-edit { display: flex; align-items: center; gap: 8px; }
.p-input {
  width: 104px;
  text-align: right;
  font-size: 12.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  padding: 5px 9px;
  border-radius: 8px;
  border: 1px solid var(--border-strong);
  background: var(--bg-soft);
  color: var(--text);
}
.p-input:focus { outline: none; border-color: var(--primary); }
.p-unit { font-size: 11px; min-width: 34px; }
.p-tip { font-size: 11px; font-weight: 700; white-space: nowrap; }
.p-tip.ok { color: var(--ok); }
.p-tip.warn { color: #b7791f; }
/* 危险区 */
.reset-note { display: flex; align-items: center; gap: 14px; justify-content: space-between; flex-wrap: wrap; }
.reset-btn {
  color: var(--vermilion, #c8503c);
  border-color: rgba(200, 80, 60, 0.45);
  background: rgba(200, 80, 60, 0.08);
  font-weight: 800;
}
.reset-btn:hover { background: rgba(200, 80, 60, 0.16); }
.empty-cell { text-align: center; padding: 22px; }
</style>
