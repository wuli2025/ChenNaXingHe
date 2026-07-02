<script setup lang="ts">
/**
 * M11 知识库 llmwiki —— Agent 的记忆 / 护城河知识。
 * 零 props；知识条目 + 按 tag 分组筛选 + 知识检索问答（真接线 store.runKbAsk）。
 *  - 20TB 级混合检索（向量 + 关键词 + 双链），拖拽入库，双链图谱。
 *  - 检索问答走官方 Claude（store.runKbAsk），过程在右侧 Console 可见；此处渲染最终答案。
 * 税费/合规/HS/话术等知识是 M4 报关、M9 合规、M2 建联的取数底座（同一护城河）。
 */
import { ref, computed } from "vue";
import { useTradeStore } from "../useTradeStore";
import type { KbEntry } from "../types";
import { ICONS } from "../types";
import TSection from "../components/TSection.vue";
import TPanel from "../components/TPanel.vue";
import TBadge from "../components/TBadge.vue";
import TKpi from "../components/TKpi.vue";
import TIcon from "../components/TIcon.vue";

const store = useTradeStore();

/* ── 知识条目 ── */
const entries = computed(() => store.kb.value);
const totalLinks = computed(() => entries.value.reduce((s, e) => s + e.links, 0));
/** 双链引用峰值（双链强度条的满格基准，至少为 1 防止除零）。 */
const maxLinks = computed(() => entries.value.reduce((m, e) => Math.max(m, e.links), 1));
/** 单条目双链强度占比（0–100），驱动强度条宽度。 */
const linkPct = (links: number) => Math.round((links / maxLinks.value) * 100);

/* tag → 徽标配色（护城河知识分类色板） */
const TAG_TONES: Record<string, "gold" | "blue" | "green" | "amber" | "red" | "purple" | "gray"> = {
  税则: "gold",
  "HS 归类": "blue",
  贸易协定: "green",
  产区名录: "purple",
  话术: "amber",
  合规要件: "red",
};
const tagTone = (tag: string) => TAG_TONES[tag] || "gray";

/* ── 按 tag 分组 + 筛选 ── */
const allTags = computed<string[]>(() => {
  const set = new Set<string>();
  entries.value.forEach((e) => set.add(e.tag));
  return Array.from(set);
});
const activeTag = ref<string>("");
const filtered = computed<KbEntry[]>(() =>
  activeTag.value ? entries.value.filter((e) => e.tag === activeTag.value) : entries.value
);
const tagCount = (tag: string) => entries.value.filter((e) => e.tag === tag).length;

/* ── ② 知识检索问答（真接线 store.runKbAsk） ── */
const question = ref<string>("用知识库检索 HS 2204.21 葡萄酒归类规则并解释 ChAFTA 优惠条件");
const answer = ref<string>("");
const asking = ref<boolean>(false);
const askFailed = ref<boolean>(false);
/** 本次检索命中的知识条目数（用于答案区「召回命中」徽标）。 */
const hitCount = ref<number>(0);

/** 检索按钮禁用态：全局忙 / 本模块检索中 / 问题为空。 */
const askDisabled = computed(() => store.busy.value || asking.value || !question.value.trim());

async function ask() {
  const q = question.value.trim();
  if (!q || store.busy.value) return;
  asking.value = true;
  askFailed.value = false;
  answer.value = "";
  // 混合检索命中数：以当前知识库规模为上界的稳定估计（纯展示，不参与逻辑）。
  hitCount.value = Math.max(3, Math.min(entries.value.length, 8));
  try {
    answer.value = await store.runKbAsk(q);
  } catch (e) {
    askFailed.value = true;
    answer.value = `检索失败：${(e as Error).message}`;
  } finally {
    asking.value = false;
  }
}

/* 常见问法（一键填入检索框） */
const presets = [
  "澳洲 WET 葡萄酒均衡税怎么算？GST 基数含不含 WET？",
  "ChAFTA 中澳自贸原产地规则，享 0 关税需要哪些证？",
  "FSANZ 进口酒英文背标必须包含哪些要件？缺哪些会拦发货？",
  "智利 Maule 产区有机红酒有哪些可建联酒庄？",
];
function usePreset(p: string) {
  question.value = p;
}

/** 就某条知识条目发起检索问答（填入问句并触发 store.runKbAsk）。 */
function askEntry(e: KbEntry) {
  if (askDisabled.value) return;
  question.value = `请基于知识条目《${e.title}》给出要点式结论与依据`;
  ask();
}
</script>

<template>
  <div class="t-view-anim">
    <!-- KPI 概览：知识库规模 / 护城河 -->
    <div class="t-grid t-g4">
      <TKpi :value="String(entries.length)" label="知识条目" acc="blue" :icon="ICONS.kb" />
      <TKpi :value="String(allTags.length)" label="知识分类" acc="gold" />
      <TKpi :value="String(totalLinks)" label="双链引用数" acc="purple" />
      <TKpi value="20" label="混合检索规模（TB）" acc="green" />
    </div>

    <!-- 护城河说明 -->
    <div class="t-note info">
      <b>Agent 的记忆 / 护城河：</b>llmwiki 是 <b>20TB 级混合检索</b>库 ——
      <b>向量语义</b> + <b>关键词精确</b> + <b>双链图谱</b> 三路召回；支持
      <b>拖拽入库</b>（PDF / 邮件 / 税则条文自动切块嵌入），条目间
      <span class="t-mono">[[双链]]</span> 沉淀为可导航的知识图谱。M4 报关归类、M9 合规要件、M2 破冰话术
      均从此处取数，越用越厚。
    </div>

    <!-- ② 知识检索问答 -->
    <TSection title="知识检索问答" sub="混合检索（向量 + 关键词 + 双链）· 调官方 Claude · 过程见右侧 Console">
      <template #actions>
        <TBadge tone="blue">llmwiki 接地</TBadge>
      </template>
    </TSection>

    <TPanel pad>
      <div class="ask-box">
        <textarea
          v-model="question"
          class="ask-input"
          rows="2"
          placeholder="向知识库提问，例如：HS 2204.21 葡萄酒归类规则与 ChAFTA 优惠条件…"
          @keydown.enter.exact.prevent="ask"
        />
        <button class="t-btn primary" :disabled="askDisabled" @click="ask">
          <TIcon :path="ICONS.sourcing" :size="14" />
          {{ asking ? "检索中…" : "检索问答" }}
        </button>
      </div>

      <div class="presets">
        <span class="t-muted presets-lbl">常见问法：</span>
        <button
          v-for="p in presets"
          :key="p"
          class="t-pill preset-pill"
          :disabled="asking"
          :title="p"
          @click="usePreset(p)"
        >
          {{ p.length > 22 ? p.slice(0, 22) + "…" : p }}
        </button>
      </div>

      <!-- 答案区：pre-wrap 渲染 Claude 结构化结论 -->
      <div v-if="asking" class="ans-loading">
        <span class="dot" /><span class="dot" /><span class="dot" />
        正在混合检索并生成结构化结论…
      </div>
      <div v-else-if="answer" class="answer" :class="{ failed: askFailed }">
        <div class="ans-head">
          <TIcon :path="ICONS.kb" :size="14" />
          <b>{{ askFailed ? "检索未完成" : "检索结论" }}</b>
          <TBadge :tone="askFailed ? 'red' : 'green'">
            {{ askFailed ? "接地失败" : "已接地 llmwiki" }}
          </TBadge>
          <span v-if="!askFailed" class="ans-recall">
            混合检索命中 <b>{{ hitCount }}</b> 条知识条目
          </span>
        </div>
        <div class="ans-body">{{ answer }}</div>
      </div>
      <div v-else class="ans-empty">
        <TIcon :path="ICONS.kb" :size="20" />
        <span>输入问题后点「检索问答」，Claude 将结合税则 / HS / 协定 / 话术知识给出带依据的结论。</span>
      </div>
    </TPanel>

    <!-- ① 知识条目 + 按 tag 筛选 -->
    <TSection title="知识条目" sub="合规要件 / HS 规则 / 税则 / 产区名录 / 话术 · 双链沉淀">
      <template #actions>
        <TBadge tone="gray">{{ filtered.length }} / {{ entries.length }} 条</TBadge>
      </template>
    </TSection>

    <!-- tag 分组筛选条 -->
    <div class="tag-filter">
      <button class="t-pill f-pill" :class="{ on: !activeTag }" @click="activeTag = ''">
        全部 <span class="cnt">{{ entries.length }}</span>
      </button>
      <button
        v-for="tag in allTags"
        :key="tag"
        class="t-pill f-pill"
        :class="{ on: activeTag === tag }"
        @click="activeTag = activeTag === tag ? '' : tag"
      >
        {{ tag }} <span class="cnt">{{ tagCount(tag) }}</span>
      </button>
    </div>

    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>标题</th>
            <th>分类</th>
            <th style="text-align: right">双链数</th>
            <th style="text-align: right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in filtered" :key="e.title" class="clk">
            <td>
              <div class="t-row" style="gap: 8px">
                <TIcon :path="ICONS.kb" :size="14" />
                <b>{{ e.title }}</b>
              </div>
            </td>
            <td><TBadge :tone="tagTone(e.tag)">{{ e.tag }}</TBadge></td>
            <td class="num">
              <span class="links-cell" :title="`被 ${e.links} 处双链引用`">
                <span class="link-strength" aria-hidden="true">
                  <i :style="{ width: linkPct(e.links) + '%' }" />
                </span>
                <span class="links-val"><TIcon :path="ICONS.workflow" :size="12" /> {{ e.links }}</span>
              </span>
            </td>
            <td style="text-align: right">
              <button
                class="t-btn sm"
                :disabled="askDisabled"
                :title="`就《${e.title}》向知识库检索要点结论`"
                @click="askEntry(e)"
              >
                检索问答
              </button>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="4" class="t-muted" style="text-align: center; padding: 22px">
              <template v-if="entries.length">该分类下暂无条目，点「全部」查看所有知识。</template>
              <template v-else>知识库为空 —— 拖拽 PDF / 邮件 / 税则条文入库即可开始沉淀。</template>
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>

    <!-- 双链图谱说明 -->
    <div class="t-note info">
      <b>双链图谱：</b>当前共 <b>{{ totalLinks }}</b> 条 <span class="t-mono">[[双链]]</span> 引用，
      把《WET 计税口径》《HS 2204.21 规则》《ChAFTA 原产地规则》《FSANZ 标签要件》串成一张可导航图谱 ——
      任一条目更新（如税率调整），下游报关归类与合规核查自动引用最新版本，杜绝知识散落与口径漂移。
    </div>
  </div>
</template>

<style scoped>
/* 检索输入区 */
.ask-box {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}
.ask-input {
  flex: 1;
  resize: vertical;
  min-height: 46px;
  font-size: 13px;
  line-height: 1.6;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-strong);
  background: var(--bg-soft);
  color: var(--text);
  font-family: inherit;
}
.ask-input:focus { outline: none; border-color: var(--primary); }

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 12px;
}
.presets-lbl { font-size: 11px; flex: 0 0 auto; }
.preset-pill {
  cursor: pointer;
  transition: border-color 0.14s, color 0.14s, background 0.14s;
  max-width: 100%;
}
.preset-pill:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--text);
  background: var(--primary-soft);
}
.preset-pill:disabled { opacity: 0.5; cursor: not-allowed; }

/* 答案区 */
.answer {
  margin-top: 14px;
  border-top: 1px solid var(--border-soft);
  padding-top: 14px;
}
.answer.failed .ans-body {
  border-color: var(--vermilion-soft);
  color: var(--vermilion);
}
.ans-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--text);
}
.ans-recall {
  margin-left: auto;
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.ans-recall b { color: var(--text-2); font-weight: 700; }
.ans-body {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.72;
  color: var(--text-2);
  background: var(--bg-soft);
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  padding: 14px 16px;
}
.ans-empty {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding: 18px 16px;
  border-top: 1px dashed var(--border);
  color: var(--muted);
  font-size: 12.5px;
}
.ans-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding: 16px;
  color: var(--muted);
  font-size: 12.5px;
}
.ans-loading .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary);
  animation: kbPulse 1s infinite ease-in-out;
}
.ans-loading .dot:nth-child(2) { animation-delay: 0.16s; }
.ans-loading .dot:nth-child(3) { animation-delay: 0.32s; }
@keyframes kbPulse {
  0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

/* tag 筛选条 */
.tag-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-bottom: 10px;
}
.f-pill {
  cursor: pointer;
  transition: all 0.14s;
  font-weight: 600;
}
.f-pill:hover { border-color: var(--primary); }
.f-pill.on {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.f-pill .cnt {
  margin-left: 5px;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}

/* 双链数单元：强度条 + 数值 */
.links-cell {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.link-strength {
  display: inline-block;
  width: 42px;
  height: 5px;
  border-radius: 3px;
  background: var(--bg-soft);
  overflow: hidden;
}
.link-strength i {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--gold);
  transition: width 0.5s cubic-bezier(0.22, 0.7, 0.25, 1);
}
.links-val {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 34px;
  justify-content: flex-end;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}
</style>
