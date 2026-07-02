<script setup lang="ts">
/**
 * M7 · 客户与分销 —— B2B 批发 CRM。
 *  ① 分销客户表（层级 / 账期 / YTD / 未回款 / 状态）
 *  ② 销售订单看板（按状态分列：备货 → 待发货 → 已发货）
 *  ③ 报价区：选客户 + SKU + 瓶数 → computeWineTax 拆解可见（WET/GST/含税价）→
 *     「生成含税报价单」调 store.runQuoteOut(customer, sku, taxable)，进 M7 报价外发人工闸。
 *
 * 零 props；数据全部取自 useTradeStore（ref → .value）。含税价与 M4 报关、M9 合规
 * 共用 computeWineTax 单点真相函数，逐分位一致。
 */
import { ref, computed } from "vue";
import { useTradeStore } from "../useTradeStore";
import { computeWineTax, ICONS } from "../types";
import type { SalesOrder } from "../types";
import TSection from "../components/TSection.vue";
import TBadge from "../components/TBadge.vue";
import TKpi from "../components/TKpi.vue";
import TPanel from "../components/TPanel.vue";
import TIcon from "../components/TIcon.vue";

const store = useTradeStore();

/* ── 客户表衍生 ── */
function tierTone(tier: string): "gold" | "blue" | "gray" {
  return tier === "A" ? "gold" : tier === "B" ? "blue" : "gray";
}
function custTone(status: string): "green" | "amber" | "gray" {
  return status === "活跃" ? "green" : status === "对账中" ? "amber" : "gray";
}
const fmtAud = (n: number) => "AUD " + n.toLocaleString("en-AU");

/** KPI 大数字格式化：万位以上折算 $M，供 TKpi 计数动画识别数字。 */
function fmtKpi(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1000) return "$" + Math.round(n / 1000) + "K";
  return "$" + n;
}

const custKpi = computed(() => {
  const cs = store.customers.value;
  const ytd = cs.reduce((s, c) => s + c.ytd, 0);
  const open = cs.reduce((s, c) => s + c.open, 0);
  const active = cs.filter((c) => c.status === "活跃").length;
  return { ytd, open, active, total: cs.length };
});

/* ── 销售订单按状态分列 ── */
const SO_COLS: { key: string; label: string; tone: "blue" | "amber" | "green" }[] = [
  { key: "备货", label: "备货中", tone: "blue" },
  { key: "待发货", label: "待发货", tone: "amber" },
  { key: "已发货", label: "已发货", tone: "green" },
];

/** 单次 computed 把订单按状态归组，避免在模板里反复 new computed()。 */
const soGroups = computed(() => {
  const map: Record<string, { orders: SalesOrder[]; incl: number }> = {};
  for (const col of SO_COLS) map[col.key] = { orders: [], incl: 0 };
  for (const o of store.salesOrders.value) {
    const g = map[o.status];
    if (g) {
      g.orders.push(o);
      g.incl += o.incl;
    }
  }
  return map;
});

/* ── 报价区状态 ── */
// SKU 单价参照 M4 报关行项 unit（如 Shiraz 18.5/瓶）。
const SKU_OPTS: { sku: string; unit: number }[] = [
  { sku: "Shiraz 2021", unit: 18.5 },
  { sku: "Cabernet 2022", unit: 18.65 },
  { sku: "Chardonnay 2023", unit: 17.08 },
  { sku: "Sparkling 2022", unit: 21.4 },
];

// 默认客户 = 客户表首行（种子已按层级排序，A 级在前）。
const qCustomer = ref<string>(store.customers.value[0]?.name ?? "");
const qSku = ref<string>(SKU_OPTS[0].sku);
const qBottles = ref<number>(1200);
const quoteResult = ref<string>("");

const qUnit = computed(() => SKU_OPTS.find((s) => s.sku === qSku.value)?.unit ?? 0);
// 完税价值（taxable）= 不含税单价 × 瓶数。含税价来源即由此透明推导。
const qTaxable = computed(() => Math.round(qUnit.value * Math.max(0, qBottles.value) * 100) / 100);
const qTax = computed(() => computeWineTax(qTaxable.value));
const qInclPerBottle = computed(() =>
  qBottles.value > 0 ? Math.round((qTax.value.inclTotal / qBottles.value) * 100) / 100 : 0
);

/** 含税总额构成占比（完税价值 / WET / GST），驱动可视化构成条。 */
const qMix = computed(() => {
  const t = qTax.value;
  const total = t.inclTotal || 1;
  return {
    taxable: (t.taxable / total) * 100,
    wet: (t.wet / total) * 100,
    gst: (t.gst / total) * 100,
    taxPct: total > 0 ? Math.round((t.totalTax / total) * 1000) / 10 : 0,
  };
});

async function generateQuote() {
  if (!qCustomer.value || store.busy.value) return;
  quoteResult.value = "";
  const res = await store.runQuoteOut(qCustomer.value, qSku.value, qTaxable.value);
  if (res) quoteResult.value = res;
}
</script>

<template>
  <div class="t-view-anim">
    <!-- 概览 KPI -->
    <div class="t-grid t-g4">
      <TKpi :value="fmtKpi(custKpi.ytd)" label="YTD 分销额" acc="gold" :icon="ICONS.customer" />
      <TKpi :value="fmtKpi(custKpi.open)" label="未回款合计" acc="amber" :icon="ICONS.finance" />
      <TKpi :value="String(custKpi.active)" label="活跃客户" acc="green" :icon="ICONS.customer" />
      <TKpi :value="String(store.salesOrders.value.length)" label="在手销售订单" acc="blue" :icon="ICONS.purchase" />
    </div>

    <!-- ① 分销客户 -->
    <TSection title="分销客户" sub="B2B 批发 CRM · 层级 / 账期 / 未回款">
      <template #actions>
        <span class="t-pill">{{ custKpi.total }} 家客户</span>
      </template>
    </TSection>
    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>客户</th><th>层级</th><th>账期</th>
            <th class="num">YTD 销售</th><th class="num">未回款</th><th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in store.customers.value" :key="c.name">
            <td><b>{{ c.name }}</b></td>
            <td><TBadge :tone="tierTone(c.tier)">{{ c.tier }} 级</TBadge></td>
            <td class="t-mono">{{ c.terms }}</td>
            <td class="num">{{ fmtAud(c.ytd) }}</td>
            <td class="num" :class="{ 't-warn-txt': c.open > 30000 }">{{ fmtAud(c.open) }}</td>
            <td><TBadge :tone="custTone(c.status)">{{ c.status }}</TBadge></td>
          </tr>
          <tr v-if="!store.customers.value.length">
            <td colspan="6" class="t-muted" style="text-align:center;padding:22px">暂无分销客户</td>
          </tr>
        </tbody>
      </table>
    </TPanel>
    <div class="t-note info">
      <b>账期与回款：</b>未回款 &gt; AUD 30,000 标红提示，联动 M8 财务对账三方匹配；Merivale 处于「对账中」，回款核对完成后转「活跃」。
    </div>

    <!-- ② 销售订单看板（按状态分列） -->
    <TSection title="销售订单" sub="报价 → 订单 → 备货 → 发货 → 回款">
      <template #actions>
        <span class="t-pill">含税额口径 = WET+GST</span>
      </template>
    </TSection>
    <div class="t-grid t-g3">
      <TPanel v-for="col in SO_COLS" :key="col.key" pad>
        <div class="so-head">
          <TBadge :tone="col.tone">{{ col.label }}</TBadge>
          <span class="t-muted">{{ soGroups[col.key].orders.length }} 单 · {{ fmtAud(soGroups[col.key].incl) }}</span>
        </div>
        <div v-if="!soGroups[col.key].orders.length" class="so-empty t-muted">暂无{{ col.label }}订单</div>
        <div v-for="o in soGroups[col.key].orders" :key="o.id" class="so-card">
          <div class="t-row" style="justify-content:space-between">
            <b class="t-mono">{{ o.id }}</b>
            <span class="so-incl">{{ fmtAud(o.incl) }}</span>
          </div>
          <div class="so-cust">{{ o.customer }}</div>
          <div class="so-lines t-muted">{{ o.lines }}</div>
        </div>
      </TPanel>
    </div>

    <!-- ③ 报价区 -->
    <TSection title="生成含税报价单" sub="选客户 + SKU + 瓶数 → WET/GST 拆解 → 外发人工闸">
      <template #actions>
        <span class="t-pill">单点真相 · computeWineTax</span>
      </template>
    </TSection>
    <div class="t-grid t-g2">
      <!-- 报价输入 -->
      <TPanel pad>
        <div class="q-field">
          <label>分销客户</label>
          <select v-model="qCustomer" class="q-sel" :disabled="store.busy.value">
            <option v-if="!store.customers.value.length" value="">暂无分销客户</option>
            <option v-for="c in store.customers.value" :key="c.name" :value="c.name">
              {{ c.name }}（{{ c.tier }} 级 · {{ c.terms }}）
            </option>
          </select>
        </div>
        <div class="q-field">
          <label>SKU</label>
          <select v-model="qSku" class="q-sel" :disabled="store.busy.value">
            <option v-for="s in SKU_OPTS" :key="s.sku" :value="s.sku">
              {{ s.sku }} · 不含税 AUD {{ s.unit.toFixed(2) }}/瓶
            </option>
          </select>
        </div>
        <div class="q-field">
          <label>瓶数</label>
          <input v-model.number="qBottles" type="number" min="0" step="60" class="q-inp" :disabled="store.busy.value" />
        </div>
        <div class="q-note t-note">
          完税价值 taxable = 不含税单价 <b>AUD {{ qUnit.toFixed(2) }}</b> × <b>{{ qBottles }}</b> 瓶
          = <b>AUD {{ qTaxable.toLocaleString("en-AU") }}</b>
        </div>
        <button
          class="t-btn primary"
          style="width:100%;justify-content:center"
          :disabled="store.busy.value || !qCustomer || qBottles <= 0"
          @click="generateQuote"
        >
          <TIcon :path="ICONS.customer" :size="14" />
          {{ store.busy.value ? "生成中…" : "生成含税报价单（进外发人工闸）" }}
        </button>
        <div class="t-note warn" style="margin-bottom:0">
          <b>人工闸：</b>此动作生成报价邮件并派单进<b>「M7 报价单外发核准」</b>人工审核看板，运营预览确认后方可外发（反误发闸）。
        </div>
      </TPanel>

      <!-- 税费拆解（含税价来源可见） -->
      <TPanel pad>
        <div class="q-brk-h">
          <span class="q-brk-t">含税价拆解</span>
          <span class="t-muted">WET 29% + GST 10%（WET 计入 GST 基数）</span>
        </div>
        <!-- 含税构成条：完税价值 / WET / GST 占比可视化 -->
        <div class="q-mix" role="img" aria-label="含税总额构成">
          <span class="q-mix-seg base" :style="{ width: qMix.taxable + '%' }" title="完税价值"></span>
          <span class="q-mix-seg wet" :style="{ width: qMix.wet + '%' }" title="WET 29%"></span>
          <span class="q-mix-seg gst" :style="{ width: qMix.gst + '%' }" title="GST 10%"></span>
        </div>
        <div class="q-mix-legend">
          <span><i class="dot base"></i>完税价值</span>
          <span><i class="dot wet"></i>WET</span>
          <span><i class="dot gst"></i>GST</span>
          <span class="q-mix-taxpct t-muted">税负占含税额 {{ qMix.taxPct }}%</span>
        </div>
        <div class="q-brk">
          <div class="q-brk-row">
            <span>完税价值（taxable）</span>
            <span class="t-mono">AUD {{ qTax.taxable.toLocaleString("en-AU") }}</span>
          </div>
          <div class="q-brk-row op"><span class="op-s">＋</span> <span>WET 29%</span>
            <span class="t-mono">AUD {{ qTax.wet.toLocaleString("en-AU") }}</span>
          </div>
          <div class="q-brk-row sub">
            <span>= GST 基数（taxable + WET）</span>
            <span class="t-mono">AUD {{ qTax.gstBase.toLocaleString("en-AU") }}</span>
          </div>
          <div class="q-brk-row op"><span class="op-s">＋</span> <span>GST 10%（基数 × 10%）</span>
            <span class="t-mono">AUD {{ qTax.gst.toLocaleString("en-AU") }}</span>
          </div>
          <div class="q-brk-row tax">
            <span>税费合计（WET + GST）</span>
            <span class="t-mono t-warn-txt">AUD {{ qTax.totalTax.toLocaleString("en-AU") }}</span>
          </div>
          <div class="q-brk-row total">
            <span><b>含税总额</b></span>
            <span class="t-mono"><b>AUD {{ qTax.inclTotal.toLocaleString("en-AU") }}</b></span>
          </div>
          <div class="q-brk-row perbtl">
            <span>含税单价 / 瓶</span>
            <span class="t-mono">AUD {{ qInclPerBottle.toFixed(2) }}</span>
          </div>
        </div>
        <div class="t-note info" style="margin-bottom:0">
          <b>单点真相：</b>此含税价与 <b>M4 报关税费测算</b>、<b>M9 合规计算器</b>共用同一 <span class="t-mono">computeWineTax()</span> 函数，逐分位一致，杜绝三处算出三个数。
        </div>
      </TPanel>
    </div>

    <!-- 报价邮件结果 -->
    <TPanel v-if="quoteResult" pad>
      <div class="q-brk-h">
        <span class="q-brk-t">报价邮件草稿</span>
        <TBadge tone="amber">已入外发核准闸</TBadge>
      </div>
      <pre class="q-mail">{{ quoteResult }}</pre>
    </TPanel>
  </div>
</template>

<style scoped>
.so-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  margin-bottom: 10px;
}
.so-empty { font-size: 12px; padding: 14px 2px; text-align: center; }
.so-card {
  border: 1px solid var(--border-soft);
  border-radius: 9px;
  padding: 10px 12px;
  margin-bottom: 9px;
  background: var(--bg-soft);
}
.so-card:last-child { margin-bottom: 0; }
.so-card { transition: border-color 0.14s, background 0.14s; }
.so-card:hover { border-color: var(--border-strong); background: var(--panel-hover); }
.so-incl { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--text); font-size: 12.5px; }
.so-cust { font-size: 12.5px; color: var(--text); font-weight: 600; margin-top: 5px; }
.so-lines { font-size: 11.5px; margin-top: 2px; }

.q-field { margin-bottom: 12px; }
.q-field label {
  display: block;
  font-size: 10.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 700;
  margin-bottom: 5px;
}
.q-sel, .q-inp {
  width: 100%;
  font-size: 12.5px;
  padding: 8px 11px;
  border-radius: 8px;
  border: 1px solid var(--border-strong);
  background: var(--panel);
  color: var(--text);
  outline: none;
}
.q-sel, .q-inp { transition: border-color 0.14s; }
.q-sel:hover, .q-inp:hover { border-color: var(--border-strong); }
.q-sel:focus, .q-inp:focus { border-color: var(--primary); }
.q-sel:disabled, .q-inp:disabled { opacity: 0.55; cursor: not-allowed; }
.q-note { margin: 4px 0 14px; }

/* 含税构成条（完税价值 / WET / GST 占比） */
.q-mix {
  display: flex;
  height: 8px;
  border-radius: 5px;
  overflow: hidden;
  background: var(--bg-soft);
  margin-bottom: 8px;
}
.q-mix-seg { height: 100%; transition: width 0.5s cubic-bezier(0.22, 0.7, 0.25, 1); }
.q-mix-seg.base { background: var(--primary); }
.q-mix-seg.wet { background: var(--gold); }
.q-mix-seg.gst { background: #d29628; }
.q-mix-legend {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 10.5px;
  color: var(--muted);
  margin-bottom: 12px;
}
.q-mix-legend .dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  margin-right: 4px;
  vertical-align: -1px;
}
.q-mix-legend .dot.base { background: var(--primary); }
.q-mix-legend .dot.wet { background: var(--gold); }
.q-mix-legend .dot.gst { background: #d29628; }
.q-mix-taxpct { margin-left: auto; font-variant-numeric: tabular-nums; }

.q-brk-h {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.q-brk-t { font-size: 13.5px; font-weight: 750; color: var(--text); }
.q-brk-h .t-muted { font-size: 11px; }
.q-brk { display: flex; flex-direction: column; }
.q-brk-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  color: var(--text-2);
  padding: 7px 0;
  border-bottom: 1px dashed var(--border-soft);
}
.q-brk-row .op-s { color: var(--muted); margin-right: 3px; }
.q-brk-row.op { color: var(--text-2); }
.q-brk-row.sub { color: var(--muted); font-size: 11.5px; }
.q-brk-row.tax { color: var(--text); }
.q-brk-row.total {
  border-bottom: none;
  border-top: 1px solid var(--border-strong);
  margin-top: 3px;
  padding-top: 10px;
  font-size: 14px;
  color: var(--text);
}
.q-brk-row.perbtl { border-bottom: none; color: var(--muted); font-size: 11.5px; padding-top: 3px; }

/* 禁用态下抑制按钮 hover 变色（trade.css 的 :hover 不区分 disabled） */
.t-btn:disabled:hover { background: var(--primary); border-color: var(--primary); }

.q-mail {
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.65;
  color: var(--text-2);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 12px 0 0;
  max-height: 320px;
  overflow: auto;
}
</style>
