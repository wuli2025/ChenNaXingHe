<script setup lang="ts">
/**
 * M4 报关单撰写 ★ —— 核心模块。
 * 顶部 KPI（待报关/报关中/已放行/查验中）→ 7 步报关工作流步骤条（★双人工闸）→
 * 待报关货柜表 → 点柜展开报关单编辑面板（申报要素 / HS 归类行 / 三单一致校验 / WET·GST 税费测算）。
 * 真接线：runHsClassify(AI 归类) / submitCustomsDraft(推进人工确认闸，硬差异自动进硬闸拦截)。
 * 强调「算自己做、报交出去、不直连海关」「三单硬差异 100% 拦截不可导出」。
 */
import { ref, computed } from "vue";
import { useTradeStore } from "../useTradeStore";
import { computeWineTax } from "../types";
import type { CustomsDeclaration, CustomsFlowStep, CheckSeverity } from "../types";
import TSection from "../components/TSection.vue";
import TPanel from "../components/TPanel.vue";
import TKpi from "../components/TKpi.vue";
import TBadge from "../components/TBadge.vue";
import TConf from "../components/TConf.vue";
import TIcon from "../components/TIcon.vue";
import { ICONS } from "../types";

const store = useTradeStore();

/* 展开的货柜 id */
const openId = ref<string | null>(null);
function toggle(id: string) {
  openId.value = openId.value === id ? null : id;
}
const openDec = computed<CustomsDeclaration | null>(
  () => store.declarations.value.find((d) => d.id === openId.value) || null
);

/* KPI 四张 */
const kpi = computed(() => store.customsKpi.value);

/* 校验状态徽标映射 */
const checkTone = (s: CheckSeverity): "green" | "amber" | "red" =>
  s === "pass" ? "green" : s === "soft" ? "amber" : "red";
const checkLabel = (s: CheckSeverity): string =>
  s === "pass" ? "通过" : s === "soft" ? "软差异" : "硬差异";

/* 报关状态徽标映射 */
const statusTone = (s: CustomsDeclaration["status"]): "gold" | "blue" | "green" | "red" =>
  s === "draft" ? "gold" : s === "reviewing" ? "blue" : s === "released" ? "green" : "red";
const statusLabel = (s: CustomsDeclaration["status"]): string =>
  s === "draft" ? "草稿" : s === "reviewing" ? "报关中" : s === "released" ? "已放行" : "查验中";

/* 步骤条状态图标 */
function stepMark(s: CustomsFlowStep): string {
  return s.state === "done" ? "✓" : String(s.n);
}

/* 当前展开柜是否含硬差异（决定是否拦截导出/提交） */
const openHard = computed(() => !!openDec.value?.checks.some((c) => c.severity === "hard"));

/* 税费测算（单点真相函数，以 CIF 完税价为基） */
const openTax = computed(() => (openDec.value ? computeWineTax(openDec.value.cif) : null));
function fmt(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ── 动作接线 ── */
async function onHsClassify(id: string) {
  if (store.busy.value) return;
  await store.runHsClassify(id);
}
function onSubmit(id: string) {
  if (store.busy.value) return;
  store.submitCustomsDraft(id);
}
</script>

<template>
  <div class="t-view-anim">
    <!-- 顶部 KPI -->
    <div class="t-grid t-g4">
      <TKpi
        :value="String(kpi.pending)"
        label="待报关货柜"
        acc="amber"
        :icon="ICONS.customs"
      />
      <TKpi
        :value="String(kpi.reviewing)"
        label="报关中"
        acc="blue"
        :icon="ICONS.workflow"
      />
      <TKpi
        :value="String(kpi.released)"
        label="已放行"
        acc="green"
        :icon="ICONS.compliance"
      />
      <TKpi
        :value="String(kpi.inspected)"
        label="查验中"
        acc="red"
        :icon="ICONS.review"
      />
    </div>

    <div class="t-note info">
      <b>算自己做，报交出去：</b>货柜 ETA-5d 自动拼报关草稿（填充率 ≥90%），LLM 归类 + WET/GST 测算 + 三单一致校验，
      人工确认后导出 PDF/EDI 交报关行；<b>系统不直连海关 ICS</b>。
    </div>

    <!-- 报关工作流步骤条 -->
    <TSection
      title="报关工作流"
      sub="ETA-5d 触发 · 双人工闸（确认 / 回执）"
    />
    <TPanel pad>
      <div class="steps">
        <div
          v-for="(s, i) in store.customsFlow.value"
          :key="s.n"
          class="step"
          :class="s.state"
        >
          <div class="s-node">
            <span class="s-num">{{ stepMark(s) }}</span>
            <span
              v-if="i < store.customsFlow.value.length - 1"
              class="s-line"
            />
          </div>
          <div class="s-body">
            <div class="s-title">
              {{ s.title }}
              <span
                v-if="s.gate"
                class="s-gate"
              >★闸</span>
            </div>
            <div class="s-desc">
              {{ s.desc }}
            </div>
          </div>
        </div>
      </div>
    </TPanel>

    <!-- 待报关货柜清单 -->
    <TSection
      title="待报关货柜清单"
      sub="点行展开报关单编辑面板 · 双人工闸"
    >
      <template #actions>
        <span class="t-pill">共 {{ store.declarations.value.length }} 柜</span>
      </template>
    </TSection>

    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>货柜</th>
            <th>PO / 供应商</th>
            <th>商品</th>
            <th>成交方式</th>
            <th class="num">
              完税价格 CIF
            </th>
            <th>HS 完整度</th>
            <th>校验状态</th>
            <th>报关状态</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="d in store.declarations.value"
            :key="d.id"
            class="clk"
            :class="{ 'row-open': openId === d.id }"
            @click="toggle(d.id)"
          >
            <td><b class="t-mono">{{ d.id }}</b></td>
            <td>
              <div class="t-mono">
                {{ d.po }}
              </div>
              <div class="t-muted">
                {{ d.supplier }}
              </div>
            </td>
            <td>{{ d.goods }}</td>
            <td><span class="t-pill">{{ d.terms }}</span></td>
            <td class="num">
              <b>{{ d.currency }} {{ d.cif.toLocaleString() }}</b>
            </td>
            <td>
              <div class="hs-cell">
                <span class="t-bar"><span :style="{ width: d.hsComplete + '%' }" /></span>
                <span class="hs-pct">{{ d.hsComplete }}%</span>
              </div>
            </td>
            <td>
              <TBadge :tone="checkTone(d.checkStatus)">
                {{ checkLabel(d.checkStatus) }}
              </TBadge>
            </td>
            <td>
              <TBadge :tone="statusTone(d.status)">
                {{ statusLabel(d.status) }}
              </TBadge>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- 空态 -->
      <div
        v-if="!store.declarations.value.length"
        class="t-empty"
      >
        暂无待报关货柜。
      </div>
    </TPanel>

    <!-- 展开：报关单编辑面板 -->
    <template v-if="openDec">
      <TSection
        :title="`货柜 ${openDec.id} · ${openDec.goods}`"
        :sub="`${openDec.po} · ${openDec.supplier} · ${openDec.terms} · 完税价 ${openDec.currency} ${openDec.cif.toLocaleString()}`"
      >
        <template #actions>
          <button
            v-if="!openDec.lines[0] || !openDec.lines[0].hs || openDec.hsComplete < 100"
            class="t-btn sm gold"
            :disabled="store.busy.value"
            @click="onHsClassify(openDec.id)"
          >
            <TIcon
              :path="ICONS.customs"
              :size="14"
            /> AI 做 HS 归类
          </button>
          <button
            class="t-btn sm primary"
            :class="{ 'is-hard': openHard }"
            :disabled="store.busy.value"
            @click="onSubmit(openDec.id)"
          >
            <TIcon
              :path="openHard ? ICONS.review : ICONS.compliance"
              :size="14"
            />
            {{ openHard ? "提交并进硬闸拦截" : "提交报关草稿确认" }}
          </button>
        </template>
      </TSection>

      <div
        class="t-note"
        :class="openHard ? 'warn' : 'info'"
      >
        <template v-if="openHard">
          <b>存在三单硬差异（金额 / 数量 / 品名）：100% 拦截，不可导出。</b>
          提交后自动进入<b>硬闸</b>看板拦截，须先修正发票 / 报关一致后再导出。
        </template>
        <template v-else>
          报关要素自动填充率 <b>{{ openDec.fillRate }}%</b>。
          缺项：{{ openDec.coCertNo ? "无" : "原产地证编号" }}。
          「提交报关草稿确认」会进入<b>人工确认闸（★闸1）</b>看板。
        </template>
      </div>

      <div class="detail-grid">
        <!-- 申报要素 -->
        <TPanel pad>
          <div class="p-h">
            申报要素
          </div>
          <div class="fr">
            <span class="fk">报关类型</span><span class="fv">{{ openDec.type === 'import' ? '进口 N10 Import Declaration' : '出口数据表' }}</span>
          </div>
          <div class="fr">
            <span class="fk">成交方式 / 币种</span><span class="fv">{{ openDec.terms }} · {{ openDec.currency }}</span>
          </div>
          <div class="fr">
            <span class="fk">FOB 货值</span><span class="fv t-mono">{{ openDec.fob.toLocaleString() }}</span>
          </div>
          <div class="fr">
            <span class="fk">运费 / 保费</span><span class="fv t-mono">{{ openDec.freight.toLocaleString() }} / {{ openDec.insurance.toLocaleString() }}</span>
          </div>
          <div class="fr">
            <span class="fk">完税价格 CIF</span><span class="fv gold-v t-mono">{{ openDec.cif.toLocaleString() }}</span>
          </div>
          <div class="fr">
            <span class="fk">原产国 / 启运国</span><span class="fv">{{ openDec.origin }} / {{ openDec.dispatch }}</span>
          </div>
          <div class="fr">
            <span class="fk">目的港</span><span class="fv">{{ openDec.destPort }}</span>
          </div>
          <div class="fr">
            <span class="fk">提单号 / 货柜号</span><span class="fv t-mono">{{ openDec.bl }} / {{ openDec.container }}</span>
          </div>
          <div class="fr">
            <span class="fk">件数 / 毛重 / 净重</span><span class="fv">{{ openDec.packages }} ctn / {{ openDec.grossWt }} kg / {{ openDec.netWt }} kg</span>
          </div>
          <div class="fr">
            <span class="fk">协定 / 原产地证号</span>
            <span class="fv">
              {{ openDec.agreement }} ·
              <span
                v-if="openDec.coCertNo"
                class="t-mono"
              >{{ openDec.coCertNo }}</span>
              <span
                v-else
                class="t-warn-txt"
              >待补缺</span>
            </span>
          </div>
        </TPanel>

        <!-- 税费测算 -->
        <TPanel pad>
          <div class="p-h">
            税费测算 · WET/GST
          </div>
          <template v-if="openTax">
            <div class="fr">
              <span class="fk">完税价格（CIF, {{ openDec.currency }}）</span><span class="fv t-mono">{{ fmt(openTax.taxable) }}</span>
            </div>
            <div class="fr">
              <span class="fk">进口关税（{{ openDec.agreement }} 0%）</span><span class="fv t-mono ok-v">{{ fmt(openDec.duty) }}</span>
            </div>
            <div class="fr">
              <span class="fk">WET 29%（葡萄酒均衡税）</span><span class="fv t-mono amber-v">{{ fmt(openTax.wet) }}</span>
            </div>
            <div class="fr">
              <span class="fk">GST 10%（含 WET 价 {{ fmt(openTax.gstBase) }} 上）</span><span class="fv t-mono blue-v">{{ fmt(openTax.gst) }}</span>
            </div>
            <div class="fr total">
              <span class="fk">进口环节应缴税费合计</span><span class="fv gold-v t-mono">{{ fmt(openDec.duty + openTax.totalTax) }}</span>
            </div>
          </template>
          <div
            class="t-note info"
            style="margin-bottom:0"
          >
            <b>单点真相：</b>此处 WET/GST 由 <span class="t-mono">computeWineTax(cif)</span> 产出，
            与合规中心计算器、客户发票口径<b>共用同一函数</b>，逐分位一致。
          </div>
        </TPanel>
      </div>

      <!-- HS 归类行 -->
      <TSection
        title="HS 归类明细"
        sub="10 位编码 · 法定计量单位 · 关税优惠（置信度 <85% 转人工）"
      />
      <TPanel>
        <table class="t-table">
          <thead>
            <tr>
              <th>商品 / SKU</th>
              <th>HS 编码</th>
              <th>HS 置信</th>
              <th>法定单位</th>
              <th>关税优惠</th>
              <th>关税置信</th>
              <th class="num">
                数量 × 单价 = 金额
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(l, i) in openDec.lines"
              :key="i"
            >
              <td>
                <div><b>{{ l.desc }}</b></div>
                <div class="t-muted t-mono">
                  {{ l.sku }}
                </div>
              </td>
              <td>
                <code
                  v-if="l.hs"
                  class="t-mono"
                >{{ l.hs }}</code>
                <span
                  v-else
                  class="t-warn-txt"
                >缺归类 ✕</span>
              </td>
              <td class="conf-col">
                <TConf
                  v-if="l.hs"
                  :value="l.hsConf"
                /><span
                  v-else
                  class="t-muted"
                >—</span>
              </td>
              <td>{{ l.uom }}</td>
              <td>{{ l.dutyRate }}</td>
              <td class="conf-col">
                <TConf
                  v-if="l.dutyConf"
                  :value="l.dutyConf"
                /><span
                  v-else
                  class="t-muted"
                >—</span>
              </td>
              <td class="num t-mono">
                {{ l.qty.toLocaleString() }} × {{ l.unit }} = {{ l.amount.toLocaleString() }}
              </td>
            </tr>
          </tbody>
        </table>
        <div
          v-if="!openDec.lines.length"
          class="t-empty"
        >
          该货柜暂无商品明细行。
        </div>
      </TPanel>
      <div
        v-if="!openDec.lines[0]?.hs"
        class="t-note warn"
      >
        <b>缺 HS 归类：</b>点右上「AI 做 HS 归类」让 Claude 结合 llmwiki 税则给出 10 位编码 + 依据 + 置信度，
        &lt;85% 自动转人工复核。
      </div>

      <!-- 三单一致校验 -->
      <TSection
        title="三单一致校验"
        sub="报关 vs 发票 vs 装箱单 vs 提单 · 硬差异 100% 拦截"
      />
      <TPanel>
        <table class="t-table">
          <thead>
            <tr>
              <th>字段</th>
              <th>严重度</th>
              <th>报关</th>
              <th>发票</th>
              <th>装箱单</th>
              <th>提单</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(c, i) in openDec.checks"
              :key="i"
              :class="{ 'hard-row': c.severity === 'hard' }"
            >
              <td><b>{{ c.field }}</b></td>
              <td>
                <TBadge :tone="checkTone(c.severity)">
                  {{ checkLabel(c.severity) }}
                </TBadge>
              </td>
              <td class="t-mono">
                {{ c.decl }}
              </td>
              <td class="t-mono">
                {{ c.inv }}
              </td>
              <td class="t-mono">
                {{ c.pack }}
              </td>
              <td class="t-mono">
                {{ c.bl }}
              </td>
              <td :class="c.severity === 'hard' ? 't-warn-txt' : c.severity === 'soft' ? 'amber-v' : 't-muted'">
                {{ c.note || (c.severity === 'pass' ? '一致' : '') }}
              </td>
            </tr>
          </tbody>
        </table>
        <div
          v-if="!openDec.checks.length"
          class="t-empty"
        >
          尚未生成三单一致校验结果。
        </div>
      </TPanel>

      <div
        class="t-note"
        :class="openHard ? 'danger' : 'ok'"
      >
        <template v-if="openHard">
          <b>三单硬差异 100% 拦截，不可导出。</b>提交后进入硬闸看板，须先修正发票 / 报关金额一致后再导出交报关行。
        </template>
        <template v-else>
          <b>无硬差异，允许导出。</b>软差异（如毛重 20kg）需人工在确认闸确认一次即可导出。
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 步骤条 */
.steps {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0;
}
@media (max-width: 900px) {
  .steps { grid-template-columns: repeat(4, 1fr); row-gap: 18px; }
}
.step { position: relative; }
.s-node { display: flex; align-items: center; margin-bottom: 8px; }
.s-num {
  width: 24px; height: 24px; flex: none;
  border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 800;
  border: 1.5px solid var(--border-strong);
  background: var(--panel);
  color: var(--muted);
  z-index: 1;
}
.s-line { flex: 1; height: 2px; background: var(--border-soft); }
.step.done .s-num { background: var(--ok); color: #fff; border-color: var(--ok); }
.step.done .s-line { background: var(--ok); }
.step.active .s-num { background: var(--primary); color: #fff; border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.s-title { font-size: 12.5px; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 6px; }
.step.todo .s-title { color: var(--muted); }
.s-desc { font-size: 11px; color: var(--muted); margin-top: 2px; padding-right: 8px; }
.s-gate {
  font-size: 9.5px; font-weight: 800;
  padding: 1px 6px; border-radius: 999px;
  background: rgba(167, 140, 79, 0.16); color: var(--gold);
}

/* 表格内 HS 完整度条 */
.hs-cell { display: flex; align-items: center; gap: 8px; min-width: 130px; }
.hs-cell .t-bar { flex: 1; }
.hs-pct { font-size: 11px; font-weight: 700; color: var(--text-2); font-variant-numeric: tabular-nums; min-width: 30px; text-align: right; }

/* HS / 关税置信度列：定宽，条与百分比对齐 */
.conf-col { min-width: 132px; }

.row-open { background: var(--panel-hover); }
.row-open td { color: var(--text); }

.t-empty { padding: 26px; text-align: center; color: var(--muted); font-size: 12.5px; }

/* 明细双栏 */
.detail-grid {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 12px;
  margin-top: 4px;
}
@media (max-width: 960px) { .detail-grid { grid-template-columns: 1fr; } }
.p-h { font-size: 13px; font-weight: 750; color: var(--text); margin-bottom: 10px; }
.fr {
  display: flex; justify-content: space-between; gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border-soft);
  font-size: 12.5px;
}
.fr:last-of-type { border-bottom: none; }
.fk { color: var(--muted); flex: none; }
.fv { color: var(--text-2); text-align: right; }
.fr.total { border-top: 1px solid var(--border-strong); border-bottom: none; margin-top: 4px; padding-top: 10px; }
.fr.total .fk { color: var(--gold); font-weight: 700; }
.fr.total .fv { font-size: 15px; font-weight: 800; }
.gold-v { color: var(--gold); font-weight: 700; }
.ok-v { color: var(--ok); }
.amber-v { color: #b7791f; }
.blue-v { color: var(--primary-deep); }
:global(.dark) .amber-v { color: #e0b45a; }

/* 硬差异行红底 */
.hard-row { background: var(--vermilion-soft); }
.hard-row td { color: var(--vermilion); }
.hard-row td b { color: var(--vermilion); }

.t-btn.primary.is-hard { background: var(--vermilion); border-color: var(--vermilion); }
.t-btn.primary.is-hard:hover { filter: brightness(0.93); background: var(--vermilion); }
</style>
