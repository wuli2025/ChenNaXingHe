<script setup lang="ts">
/**
 * M9 合规中心 —— WET/GST 计算器（单点真相）+ 逐柜合规台账（缺证拦发货硬闸）。
 * 零 props；数据/动作全部取自 useTradeStore；税费统一走 computeWineTax（与 M4 报关、M7 开票同一函数）。
 */
import { ref, computed } from "vue";
import { useTradeStore } from "../useTradeStore";
import { computeWineTax } from "../types";
import type { ComplianceRow } from "../types";
import TSection from "../components/TSection.vue";
import TPanel from "../components/TPanel.vue";
import TBadge from "../components/TBadge.vue";
import TKpi from "../components/TKpi.vue";
import TIcon from "../components/TIcon.vue";
import { ICONS } from "../types";

const store = useTradeStore();

/* ── ① WET/GST 计算器：完税价格可编辑，实时算税 ── */
const taxable = ref<number>(74304);
const tax = computed(() => computeWineTax(Math.max(0, Number(taxable.value) || 0)));
const fmt = (n: number) => n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* 台账 KPI 派生 */
const rows = computed(() => store.compliance.value);
const okCount = computed(() => rows.value.filter((r) => r.ok).length);
const blockCount = computed(() => rows.value.filter((r) => !r.ok).length);
const missCount = computed(() =>
  rows.value.filter((r) => r.fsanz.includes("缺") || r.biosecurity.includes("待") || r.release.includes("拦")).length
);
/** 台账合规率（可放行 / 在册），驱动置信度条。 */
const passRate = computed(() => (rows.value.length ? Math.round((okCount.value / rows.value.length) * 100) : 0));

/* 正在核查的货柜（局部禁用 + 忙态文案） */
const checking = ref<string>("");

/* release 文案含「拦」→ 高亮为拦截红字 */
function isBlocked(r: ComplianceRow): boolean {
  return !r.ok || r.release.includes("拦");
}

/* ── 动作：对缺证柜跑「合规要件核查」（内部进 compliance-release 缺证放行硬闸） ── */
async function checkContainer(r: ComplianceRow) {
  if (store.busy.value || checking.value) return;
  checking.value = r.container;
  try {
    await store.runCompliance(r.container);
  } finally {
    checking.value = "";
  }
}

/* ── 动作：直接派「缺证放行」硬闸进人工审核看板 ── */
function requestRelease(r: ComplianceRow) {
  const gaps: string[] = [];
  if (r.fsanz.includes("缺")) gaps.push(`FSANZ：${r.fsanz}`);
  if (r.biosecurity.includes("待") || r.biosecurity.includes("缺")) gaps.push(`Biosecurity：${r.biosecurity}`);
  if (r.wet.includes("待")) gaps.push("WET/GST 未计算");
  store.enqueueReview({
    mod: "m9",
    kind: "compliance-release",
    title: `货柜 ${r.container} 缺证放行核准`,
    refId: r.container,
    summary: `货柜 ${r.container} 存在合规缺口，缺证拦发货，需人工核准后方可放行：${gaps.join("；") || "见台账明细"}。`,
    facts: [
      { k: "FSANZ 标签", v: r.fsanz, warn: r.fsanz.includes("缺") },
      { k: "Biosecurity", v: r.biosecurity, warn: r.biosecurity.includes("待") || r.biosecurity.includes("缺") },
      { k: "WET/GST", v: `${r.wet} / ${r.gst}`, warn: r.wet.includes("待") },
      { k: "当前放行", v: r.release, warn: true },
    ],
    risk: "hard",
    hardGate: true,
  });
}

/* ── 合规要件卡片：三大澳洲进口酒要件简述 ── */
const gates = [
  {
    key: "WET / GST",
    tone: "gold" as const,
    desc: "葡萄酒均衡税 WET 29% + 进口 GST 10%（GST 计入 WET 后价上）。由 computeWineTax 单点产出，报关/台账/发票逐分位一致。",
  },
  {
    key: "FSANZ 标签",
    tone: "amber" as const,
    desc: "澳新食品标准局：需英文背标、酒精度、标准杯数、原产国、进口商名址、过敏原（含亚硫酸盐）声明。缺英文背标即拦发货。",
  },
  {
    key: "Biosecurity",
    tone: "green" as const,
    desc: "农业部生物安全：木质包装 ISPM-15、集装箱清洁申报、到港检疫。未申报/未通过则不予放行入仓。",
  },
  {
    key: "TGA",
    tone: "purple" as const,
    desc: "治疗用品管理局：普通佐餐葡萄酒不涉 TGA（N/A）；仅含药用/保健声称的酒精饮品才纳入监管。",
  },
];
</script>

<template>
  <div class="t-view-anim">
    <!-- KPI 概览 -->
    <div class="t-grid t-g4">
      <TKpi
        :value="String(rows.length)"
        label="在册货柜"
        acc="blue"
        :icon="ICONS.customs"
      />
      <TKpi
        :value="String(okCount)"
        label="可放行"
        acc="green"
        :icon="ICONS.compliance"
        :delta="`合规率 ${passRate}%`"
        :up="true"
      />
      <TKpi
        :value="String(blockCount)"
        label="缺证拦发货"
        acc="red"
        :icon="ICONS.compliance"
        :delta="blockCount ? '硬闸拦截' : '无拦截'"
        :up="false"
      />
      <TKpi
        :value="String(missCount)"
        label="待补合规要件"
        acc="amber"
        :delta="missCount ? '需补件' : '要件齐备'"
        :up="false"
      />
    </div>

    <!-- 合规率总览条 -->
    <TPanel
      v-if="rows.length"
      pad
    >
      <div class="rate-row">
        <span class="rate-k">整体放行合规率</span>
        <span class="rate-v">{{ passRate }}%</span>
        <span class="rate-sub t-muted">{{ okCount }} / {{ rows.length }} 柜可放行</span>
      </div>
      <div class="t-bar rate-bar">
        <span
          :class="passRate >= 80 ? 'ok' : passRate >= 50 ? 'warn' : 'bad'"
          :style="{ width: passRate + '%' }"
        />
      </div>
    </TPanel>

    <!-- ① WET / GST 计算器 -->
    <TSection
      title="WET / GST 计算器"
      sub="单点真相 · 与 M4 报关、M7 开票共用同一函数 computeWineTax()"
    />
    <TPanel pad>
      <div class="t-grid t-g2">
        <div class="calc">
          <label class="calc-input">
            <span class="ci-k">完税价格（CIF, AUD）</span>
            <input
              v-model.number="taxable"
              type="number"
              min="0"
              step="100"
              class="ci-v"
            >
          </label>
          <div class="field-row">
            <span class="fk">进口关税（ChAFTA 0%）</span>
            <span class="fv fv-ok">$0.00</span>
          </div>
          <div class="field-row">
            <span class="fk">WET 29%（葡萄酒均衡税）</span>
            <span class="fv fv-amber">${{ fmt(tax.wet) }}</span>
          </div>
          <div class="field-row">
            <span class="fk">GST 基数（CIF + WET）</span>
            <span class="fv t-muted">${{ fmt(tax.gstBase) }}</span>
          </div>
          <div class="field-row">
            <span class="fk">进口 GST 10%（含 WET 价上）</span>
            <span class="fv fv-blue">${{ fmt(tax.gst) }}</span>
          </div>
          <div class="field-row total">
            <span class="fk">进口环节应缴税费合计</span>
            <span class="fv fv-gold">${{ fmt(tax.totalTax) }}</span>
          </div>
          <div class="field-row total">
            <span class="fk">含税总额</span>
            <span class="fv fv-gold">${{ fmt(tax.inclTotal) }}</span>
          </div>
        </div>
        <div
          class="t-col"
          style="gap: 12px"
        >
          <div
            class="t-note gold"
            style="margin: 0"
          >
            <b>单点真相：</b>此处 WET / GST 与 <b>M4 报关</b>税费测算、<b>M7 开票</b>含税价<b>共用同一函数</b>
            <span class="t-mono">computeWineTax(taxable)</span>，逐分位一致，杜绝「三处算出三个数」。
          </div>
          <div
            class="t-note info"
            style="margin: 0"
          >
            <b>计算链：</b>CIF <span class="t-mono">{{ fmt(tax.taxable) }}</span>
            → WET = CIF × 29% = <span class="t-mono">{{ fmt(tax.wet) }}</span>
            → GST 基 = (CIF + WET) × 10% = <span class="t-mono">{{ fmt(tax.gst) }}</span>
            → 税费合计 <span class="t-mono">{{ fmt(tax.totalTax) }}</span>。
          </div>
        </div>
      </div>
    </TPanel>

    <!-- ② 逐柜合规台账 -->
    <TSection
      title="逐柜合规台账 · 缺证拦发货"
      sub="WET / GST / TGA / FSANZ / Biosecurity · 放行硬闸"
    >
      <template #actions>
        <TBadge
          v-if="blockCount"
          tone="red"
        >
          {{ blockCount }} 柜缺证拦发货
        </TBadge>
        <TBadge
          v-else
          tone="green"
        >
          全部可放行
        </TBadge>
      </template>
    </TSection>

    <div
      v-if="blockCount"
      class="t-note danger"
    >
      <b>缺证拦发货硬闸：</b>缺证货柜不可出仓发运。核查缺口后走「核准放行」进人工审核看板，
      经运营核准（<span class="t-mono">compliance-release</span> 硬闸）方可放行。
    </div>

    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>货柜</th>
            <th>WET</th>
            <th>GST</th>
            <th>TGA</th>
            <th>FSANZ 标签</th>
            <th>Biosecurity</th>
            <th>放行状态</th>
            <th style="text-align: right">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in rows"
            :key="r.container"
            :class="{ bad: !r.ok, busy: checking === r.container }"
          >
            <td><b>货柜 {{ r.container }}</b></td>
            <td :class="{ 'miss-cell': r.wet.includes('待') }">
              {{ r.wet }}
            </td>
            <td :class="{ 'miss-cell': r.gst.includes('待') }">
              {{ r.gst }}
            </td>
            <td class="t-muted">
              {{ r.tga }}
            </td>
            <td :class="{ 'miss-cell': r.fsanz.includes('缺') }">
              {{ r.fsanz }}
            </td>
            <td :class="{ 'miss-cell': r.biosecurity.includes('待') || r.biosecurity.includes('缺') }">
              {{ r.biosecurity }}
            </td>
            <td>
              <span
                v-if="isBlocked(r)"
                class="t-warn-txt"
              >{{ r.release }}</span>
              <TBadge
                v-else
                tone="green"
              >
                {{ r.release }}
              </TBadge>
            </td>
            <td class="act-cell">
              <template v-if="!r.ok">
                <button
                  class="t-btn sm"
                  :disabled="store.busy.value || !!checking"
                  @click="checkContainer(r)"
                >
                  <TIcon
                    :path="ICONS.compliance"
                    :size="13"
                  />
                  {{ checking === r.container ? "核查中…" : "合规要件核查" }}
                </button>
                <button
                  class="t-btn sm gold"
                  :disabled="!!checking"
                  @click="requestRelease(r)"
                >
                  核准放行
                </button>
              </template>
              <span
                v-else
                class="t-muted done-dash"
              >—</span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td
              colspan="8"
              class="t-muted"
              style="text-align: center; padding: 22px"
            >
              暂无在册货柜合规记录
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>

    <!-- 合规要件卡 -->
    <TSection
      title="澳洲进口酒 · 合规要件速查"
      sub="TGA / FSANZ / Biosecurity / WET-GST 要点"
    />
    <div class="t-grid t-g2">
      <TPanel
        v-for="g in gates"
        :key="g.key"
        pad
      >
        <div
          class="t-row"
          style="margin-bottom: 8px"
        >
          <TBadge :tone="g.tone">
            {{ g.key }}
          </TBadge>
        </div>
        <p class="gate-desc">
          {{ g.desc }}
        </p>
      </TPanel>
    </div>
  </div>
</template>

<style scoped>
.calc { display: flex; flex-direction: column; gap: 2px; }
.calc-input {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0 12px;
  border-bottom: 1px solid var(--border-soft);
}
.ci-k { font-size: 12px; color: var(--text-2); font-weight: 600; }
.ci-v {
  width: 150px;
  text-align: right;
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-strong);
  background: var(--bg-soft);
  color: var(--text);
}
.ci-v:focus { outline: none; border-color: var(--primary); }
.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 0;
  border-bottom: 1px solid var(--border-soft);
  font-size: 12.5px;
}
.field-row:last-child { border-bottom: none; }
.field-row.total .fk { font-weight: 700; color: var(--text); }
.fk { color: var(--text-2); }
.fv { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--text); }
.fv-ok { color: var(--ok); }
.fv-amber { color: #b7791f; }
.fv-blue { color: var(--primary-deep); }
.fv-gold { color: var(--gold); }
:global(.dark) .fv-amber { color: #e0b45a; }

/* 合规率总览条 */
.rate-row { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.rate-k { font-size: 12px; font-weight: 600; color: var(--text-2); }
.rate-v { font-size: 16px; font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; letter-spacing: -0.3px; }
.rate-sub { font-size: 11px; margin-left: auto; }
.rate-bar { height: 7px; }
.rate-bar > span.ok { background: var(--ok); }
.rate-bar > span.warn { background: #d29628; }
.rate-bar > span.bad { background: var(--vermilion); }

/* 台账表格 */
.t-table tbody tr td { transition: background 0.14s; }
.t-table tbody tr:hover td { background: var(--panel-hover); }
.t-table tbody tr.bad td { background: var(--vermilion-soft); }
.t-table tbody tr.bad:hover td { background: rgba(224, 90, 60, 0.16); }
.t-table tbody tr.busy td { opacity: 0.72; }
.miss-cell { color: var(--vermilion); font-weight: 600; }

.act-cell { text-align: right; white-space: nowrap; }
.act-cell .t-btn + .t-btn { margin-left: 6px; }
.done-dash { font-size: 11px; }

.gate-desc { font-size: 12px; line-height: 1.65; color: var(--text-2); margin: 0; }
</style>
