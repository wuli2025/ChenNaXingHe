<script setup lang="ts">
/**
 * M3 · 供应商与采购
 *  ① 供应商公海评分卡：每家一卡（准时率/报价/质量 三小条 + 综合分 + 等级 + 标签）。
 *  ② 采购 / 询价区：「群发比价询价」→ 人工闸（rfq-send）。
 *  ③ 回信结构化抽取演示区：反幻觉范式（剥签名 → 抽 {报价,币种,交期,MOQ,有效期} + 字段置信度，
 *     <85% 转人工回写采购单，quote-writeback）。用 TConf 展示示例字段置信度。
 *
 * 零 props；store 单例；只用设计令牌 + trade.css 类。
 */
import { computed, ref } from "vue";
import { useTradeStore } from "../useTradeStore";
import { ICONS } from "../types";
import TSection from "../components/TSection.vue";
import TBadge from "../components/TBadge.vue";
import TConf from "../components/TConf.vue";
import TKpi from "../components/TKpi.vue";
import TPanel from "../components/TPanel.vue";
import TIcon from "../components/TIcon.vue";

const store = useTradeStore();

/* ── 派生汇总 ── */
const suppliers = computed(() => store.suppliers.value);
const rated = computed(() => suppliers.value.filter((s) => s.composite > 0));
const coreCount = computed(() => suppliers.value.filter((s) => s.tag === "核心").length);
const newLinked = computed(() => suppliers.value.filter((s) => s.tag === "新建联").length);
const avgOnTime = computed(() => {
  const arr = rated.value;
  if (!arr.length) return 0;
  return Math.round(arr.reduce((a, s) => a + s.onTime, 0) / arr.length);
});

/* 等级 → TBadge tone */
function gradeTone(g: string): "gold" | "blue" | "gray" {
  return g === "A" ? "gold" : g === "B" ? "blue" : "gray";
}
function tagTone(tag: string): "gold" | "green" {
  return tag === "核心" ? "gold" : "green";
}

/* ── ① 群发比价询价 → 人工闸（rfq-send） ── */
const rfqSent = ref(false);
function sendRfq() {
  const targets = rated.value.map((s) => s.name);
  store.enqueueReview({
    mod: "m3",
    kind: "rfq-send",
    title: "比价询价群发核准",
    summary: `拟向 ${targets.length} 家在评供应商群发 Shiraz 2021 比价询价（统一规格 3,600 瓶 / 20ft），外发前需人工核准（反骚扰闸）。`,
    facts: [
      { k: "群发对象", v: targets.join("、") || "（暂无在评供应商）", warn: !targets.length },
      { k: "询价标的", v: "Shiraz Red Wine 2021 · 750ml" },
      { k: "抽取字段", v: "报价 / 币种 / 交期 / MOQ / 有效期" },
      { k: "低置信策略", v: "字段置信 <85% → 转人工回写采购单" },
    ],
    risk: "normal",
  });
  rfqSent.value = true;
}

/* ── ③ 回信结构化抽取演示（反幻觉范式示例字段 + 置信度） ── */
interface QuoteField {
  k: string;
  v: string;
  conf: number;
}
const extractDemo = ref<QuoteField[]>([
  { k: "报价（单价）", v: "USD 4.20 / 瓶", conf: 91 },
  { k: "币种", v: "USD（FOB San Antonio）", conf: 95 },
  { k: "交期", v: "约 45 天（含订舱）", conf: 72 },
  { k: "MOQ", v: "1 × 20ft（约 12,000 瓶）", conf: 68 },
  { k: "有效期", v: "报价 30 天内有效", conf: 88 },
]);
const lowConfFields = computed(() => extractDemo.value.filter((f) => f.conf < 85));
/** 低置信字段名摘要（去掉括号里的口径，仅取字段名，供页脚说明动态引用）。 */
const lowConfNames = computed(() =>
  lowConfFields.value.map((f) => f.k.replace(/（.*?）/g, "")).join(" / ")
);

/* ── 回信抽取回写 → 人工闸（quote-writeback） ── */
const writebackSent = ref(false);
function sendWriteback() {
  const low = lowConfFields.value.map((f) => `${f.k}(${f.conf}%)`).join("、");
  store.enqueueReview({
    mod: "m3",
    kind: "quote-writeback",
    title: "Viña Aurora 报价回写采购单",
    summary: `已从回信剥签名并抽取结构化报价，${lowConfFields.value.length} 个字段置信 <85%，需人工核对后回写采购单。`,
    refId: "L-2201",
    facts: [
      { k: "供应商", v: "Viña Aurora · 智利 Maule" },
      { k: "抽取报价", v: "USD 4.20/瓶 · 有效 30 天" },
      { k: "低置信字段", v: low || "无", warn: lowConfFields.value.length > 0 },
    ],
    risk: "normal",
  });
  writebackSent.value = true;
}
</script>

<template>
  <div class="t-view-anim">
    <!-- 顶部 KPI -->
    <div class="t-grid t-g4">
      <TKpi :value="String(suppliers.length)" label="公海供应商" :icon="ICONS.purchase" acc="gold" />
      <TKpi :value="String(coreCount)" label="核心供应商" delta="A 级长约" up acc="green" />
      <TKpi :value="String(newLinked)" label="待评估（新建联）" :delta="newLinked ? 'M2 转入待打分' : '无'" acc="amber" />
      <TKpi :value="avgOnTime + '%'" label="在评均准时率" :icon="ICONS.logistics" acc="blue" />
    </div>

    <div class="t-note info">
      <b>采购上游一屏：</b>已合作供应商在此按 <b>准时率 / 报价 / 质量</b> 三维打分得综合分与等级；
      比价询价一键群发（走人工闸），回信按反幻觉范式抽成结构化报价，低置信字段转人工回写采购单。
    </div>

    <!-- ① 供应商公海评分卡 -->
    <TSection title="供应商公海 · 多维评分卡" sub="准时率 / 报价 / 质量 → 综合分 · 等级">
      <template #actions>
        <button
          class="t-btn sm gold"
          :disabled="store.busy.value || rfqSent"
          @click="sendRfq"
          :title="rfqSent ? '已入询价群发核准闸' : '群发比价询价（进人工审核看板）'"
        >
          <TIcon :path="ICONS.purchase" :size="14" />
          {{ rfqSent ? "已入核准闸" : "群发比价询价" }}
        </button>
      </template>
    </TSection>

    <div v-if="suppliers.length" class="t-grid t-g2">
      <TPanel v-for="s in suppliers" :key="s.name" pad class="sup-card">
        <div class="sup-head">
          <div class="sup-id">
            <b class="sup-name">{{ s.name }}</b>
            <span class="sup-meta">{{ s.country }} · {{ s.cat }}</span>
          </div>
          <div class="sup-tags">
            <TBadge v-if="s.tag" :tone="tagTone(s.tag)">{{ s.tag }}</TBadge>
            <TBadge :tone="gradeTone(s.grade)">{{ s.grade === "—" ? "待评级" : s.grade + " 级" }}</TBadge>
          </div>
        </div>

        <!-- 已评分：三条 + 综合分 -->
        <template v-if="s.composite > 0">
          <div class="sup-bars">
            <div class="bar-row">
              <span class="bar-l">准时率</span>
              <span class="t-bar"><span :style="{ width: s.onTime + '%' }" /></span>
              <span class="bar-v t-mono">{{ s.onTime }}</span>
            </div>
            <div class="bar-row">
              <span class="bar-l">报价分</span>
              <span class="t-bar"><span :style="{ width: s.price + '%' }" /></span>
              <span class="bar-v t-mono">{{ s.price }}</span>
            </div>
            <div class="bar-row">
              <span class="bar-l">质量分</span>
              <span class="t-bar"><span :style="{ width: s.quality + '%' }" /></span>
              <span class="bar-v t-mono">{{ s.quality }}</span>
            </div>
          </div>
          <div class="sup-comp">
            <span class="comp-l">综合分</span>
            <span class="comp-v">{{ s.composite }}</span>
          </div>
        </template>

        <!-- 未评分（新建联）空态 -->
        <div v-else class="sup-empty">
          <TIcon :path="ICONS.lead" :size="15" />
          <span>由 M2 建联转入，尚无历史交付数据，首单后自动生成评分。</span>
        </div>
      </TPanel>
    </div>
    <TPanel v-else pad>
      <div class="empty">暂无公海供应商 · 在 M2 供应商建联把有意向线索转为正式供应商后进入此处。</div>
    </TPanel>

    <!-- ② 采购 / 询价区说明 -->
    <TSection title="采购 · 询价比价" sub="统一规格群发 · 结构化归集 · 一票一价横向对比" />
    <div class="t-note warn">
      <b>群发比价询价（人工闸）：</b>对在评的 <b>{{ rated.length }}</b> 家供应商群发同一规格 Shiraz 询价，
      邮件外发前进 <b>人工审核看板</b>（<span class="t-mono">rfq-send</span>）核准，避免误扰与重复触达。
      <span v-if="rfqSent" class="t-warn-txt"> · 本轮已入列，去审核看板处理。</span>
    </div>

    <!-- ③ 回信结构化抽取演示 -->
    <TSection title="回信结构化抽取 · 反幻觉范式" sub="剥签名 → 抽 {报价,币种,交期,MOQ,有效期} + 字段置信度">
      <template #actions>
        <button
          class="t-btn sm primary"
          :disabled="store.busy.value || writebackSent"
          @click="sendWriteback"
          :title="writebackSent ? '已入报价回写闸' : '低置信字段转人工回写采购单'"
        >
          <TIcon :path="ICONS.finance" :size="14" />
          {{ writebackSent ? "已入回写闸" : "转人工回写采购单" }}
        </button>
      </template>
    </TSection>

    <div class="t-note ok">
      <b>抽取范式：</b>先<b>剥离签名 / 免责声明</b>降噪，再从正文抽 <b>报价、币种、交期、MOQ、有效期</b> 五个结构化字段，
      并给出<b>字段级置信度</b>；任一字段 <b>&lt;85%</b> 即高亮，<b>不自动写库</b>，转人工核对后回写采购单
      （<span class="t-mono">quote-writeback</span>）——杜绝把模型臆测当成真实报价。
    </div>

    <TPanel pad>
      <div class="ex-head t-row">
        <span class="t-pill">示例回信 · Viña Aurora（智利）</span>
        <span class="t-muted ex-src">已剥签名 · 正文命中 5 字段</span>
      </div>
      <div class="ex-fields">
        <div v-for="f in extractDemo" :key="f.k" class="ex-row" :class="{ low: f.conf < 85 }">
          <div class="ex-k">
            {{ f.k }}
            <span v-if="f.conf < 85" class="t-warn-txt ex-flag">转人工</span>
          </div>
          <div class="ex-v">{{ f.v }}</div>
          <div class="ex-c"><TConf :value="f.conf" /></div>
        </div>
      </div>
      <div class="ex-foot">
        <span v-if="lowConfFields.length" class="t-muted">
          {{ lowConfFields.length }} 个字段置信 &lt;85%（{{ lowConfNames }}）——按范式拦截，不自动写库，转人工回写采购单。
        </span>
        <span v-else class="t-muted">全部字段置信 ≥85%，可直接回写采购单。</span>
      </div>
    </TPanel>
  </div>
</template>

<style scoped>
/* ── 供应商卡 ── */
.sup-card {
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}
.sup-card:hover {
  border-color: var(--gold);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
  transform: translateY(-1px);
}
.sup-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.sup-id { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.sup-name { font-size: 13.5px; font-weight: 750; color: var(--text); }
.sup-meta { font-size: 11px; color: var(--muted); }
.sup-tags { display: flex; gap: 6px; flex-shrink: 0; }

.sup-bars { margin-top: 14px; display: flex; flex-direction: column; gap: 9px; }
.bar-row { display: grid; grid-template-columns: 46px 1fr 30px; align-items: center; gap: 9px; }
.bar-l { font-size: 11px; color: var(--muted); }
.bar-v { font-size: 11.5px; color: var(--text-2); text-align: right; font-weight: 600; }

.sup-comp {
  margin-top: 13px;
  padding-top: 11px;
  border-top: 1px solid var(--border-soft);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.comp-l { font-size: 11.5px; color: var(--muted); }
.comp-v {
  font-size: 20px;
  font-weight: 800;
  color: var(--gold);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.4px;
}

.sup-empty {
  margin-top: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.5;
}
.sup-empty svg { flex-shrink: 0; opacity: 0.75; }

.empty { text-align: center; padding: 26px 12px; color: var(--muted); font-size: 12.5px; }

/* ── 回信抽取 ── */
.ex-head { justify-content: space-between; }
.ex-src { font-size: 11px; }
.ex-fields { margin-top: 12px; display: flex; flex-direction: column; }
.ex-row {
  display: grid;
  grid-template-columns: 132px 1fr 180px;
  align-items: center;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border-soft);
}
.ex-row:last-child { border-bottom: none; }
.ex-row.low { background: rgba(210, 150, 40, 0.06); border-radius: 6px; padding-left: 8px; padding-right: 8px; }
.ex-k { font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.ex-flag { font-size: 10px; }
.ex-v { font-size: 12.5px; color: var(--text); font-weight: 600; }
.ex-c { min-width: 0; }
.ex-foot { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border-soft); font-size: 11.5px; }

@media (max-width: 760px) {
  .ex-row { grid-template-columns: 100px 1fr; }
  .ex-c { grid-column: 1 / -1; }
}
</style>
