<script setup lang="ts">
/**
 * M2 供应商建联 ★ —— 反骚扰核心。
 * ① 开发漏斗看板（5 阶段横向条形，宽度按 n 归一，用 stage.color）
 * ② 线索池表（点行选中）
 * ③ 选中线索详情：画像(带字段级置信度) + 往来线程(邮件气泡) + 多语言开发信草稿(en/es/zh)
 * 真接线 store：runOutreach（内部 enqueue 外发核准闸）/ runReplyClass / enqueueReview(lead-convert)。
 */
import { ref, computed } from "vue";
import { useTradeStore } from "../useTradeStore";
import type { SupplierLead, LeadStatus, ReplyClass } from "../types";
import { ICONS } from "../types";
import TIcon from "../components/TIcon.vue";
import TSection from "../components/TSection.vue";
import TBadge from "../components/TBadge.vue";
import TConf from "../components/TConf.vue";
import TPanel from "../components/TPanel.vue";

const store = useTradeStore();

/* ── 选中线索（默认选第一条有回信的 A 级线索，否则第一条） ── */
const selectedId = ref<string>("");
const selected = computed<SupplierLead | null>(() => {
  const list = store.leads.value;
  if (!list.length) return null;
  const id = selectedId.value || list.find((l) => l.thread.length)?.id || list[0].id;
  return list.find((l) => l.id === id) || null;
});
function selectLead(l: SupplierLead) {
  selectedId.value = l.id;
}

/* ── 漏斗归一 ── */
const funnelMax = computed(() =>
  Math.max(1, ...store.outreachFunnel.value.map((f) => f.n))
);

/* ── 中文映射 ── */
const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "新线索",
  contacted: "已建联",
  replied: "已回复",
  invalid: "无效",
  unsub: "退订",
};
const STATUS_TONE: Record<LeadStatus, "gray" | "blue" | "green" | "red"> = {
  new: "gray",
  contacted: "blue",
  replied: "green",
  invalid: "gray",
  unsub: "red",
};
function replyClassLabel(rc: ReplyClass): string {
  if (!rc) return "—";
  return { interested: "有兴趣", sample: "索样", quoted: "已报价", rejected: "拒绝", irrelevant: "无关" }[rc];
}
function gradeTone(g: SupplierLead["grade"]): "gold" | "blue" | "gray" {
  return g === "A" ? "gold" : g === "B" ? "blue" : "gray";
}
function sourceLabel(s: SupplierLead["source"]): string {
  return s === "sourcing" ? "选品带出" : s === "manual" ? "人工录入" : "名录导入";
}

/* ── 开发信语言 tab ── */
type Lang = "en" | "es" | "zh";
const LANGS: { k: Lang; label: string }[] = [
  { k: "en", label: "English" },
  { k: "es", label: "Español" },
  { k: "zh", label: "中文" },
];
const draftLang = ref<Lang>("en");
const currentDraft = computed(() => selected.value?.drafts?.[draftLang.value] || "");

/* 可转供应商：有兴趣/索样/已报价 */
const canConvert = computed(() => {
  const rc = selected.value?.replyClass;
  return rc === "interested" || rc === "sample" || rc === "quoted";
});
/* 最后一条回信（用于意向判定） */
const lastInbound = computed(() => {
  const t = selected.value?.thread || [];
  for (let i = t.length - 1; i >= 0; i--) if (t[i].dir === "in") return t[i];
  return null;
});

/* ── 动作接线 ── */
async function genOutreach() {
  const l = selected.value;
  if (!l) return;
  await store.runOutreach(l.id, draftLang.value); // 内部已 enqueue 外发核准闸（反骚扰）
}
async function classifyReply() {
  const l = selected.value;
  const msg = lastInbound.value;
  if (!l || !msg) return;
  await store.runReplyClass(l.id, msg.text);
}
function convertToSupplier() {
  const l = selected.value;
  if (!l) return;
  store.enqueueReview({
    mod: "m2",
    kind: "lead-convert",
    title: `${l.company} 转正式供应商`,
    refId: l.id,
    summary: `${l.country} ${l.company} 意向『${replyClassLabel(l.replyClass)}』，建议转入供应商公海（标签“新建联”）进 M3 比价。`,
    facts: [
      { k: "意向", v: replyClassLabel(l.replyClass) },
      { k: "建联优先级", v: `${l.grade} · ${l.score} 分` },
      { k: "产区品类", v: `${l.region} · ${l.category}` },
    ],
    risk: "normal",
  });
}
</script>

<template>
  <div class="t-view-anim">
    <div class="t-note warn">
      <b>反骚扰核心：</b>三道人工闸（挑选建联对象 → 首封开发信外发核准 → 线索转供应商）+ 30 天同 domain 去重 + 频控 + 退订抑制。逐家个性化开发信，非模板群发。点线索行查看详情。
    </div>

    <!-- ① 开发漏斗看板 -->
    <TSection
      title="供应商开发漏斗 · 本月"
      sub="线索 → 建联 → 回复 → 比价 → 合作"
    />
    <TPanel pad>
      <div class="fn">
        <div
          v-for="(f, i) in store.outreachFunnel.value"
          :key="f.stage"
          class="fn-row"
        >
          <div class="fn-lbl">
            {{ f.stage }}
          </div>
          <div class="fn-track">
            <div
              class="fn-fill"
              :style="{
                width: (f.n / funnelMax) * 100 + '%',
                background: f.color,
                transitionDelay: i * 80 + 'ms',
              }"
            >
              <span class="fn-n">{{ f.n }}</span>
            </div>
          </div>
          <div class="fn-conv">
            {{ f.conv || "—" }}
          </div>
        </div>
      </div>
    </TPanel>

    <!-- ② 线索池表 -->
    <TSection
      title="线索池"
      :sub="`${store.leads.value.length} 条 · 同公司自动去重合并`"
    >
      <template #actions>
        <button
          class="t-btn sm"
          :disabled="!selected || store.busy.value"
          @click="genOutreach"
        >
          <TIcon
            :path="ICONS.lead"
            :size="14"
          /> {{ store.busy.value ? "生成中…" : "生成开发信" }}
        </button>
      </template>
    </TSection>
    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>公司 / 联系人</th>
            <th>国家 · 产区</th>
            <th>主营品类</th>
            <th>建联优先级</th>
            <th>来源</th>
            <th>状态</th>
            <th>意向</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="l in store.leads.value"
            :key="l.id"
            class="clk"
            :class="{ on: selected && selected.id === l.id }"
            @click="selectLead(l)"
          >
            <td>
              <b>{{ l.company }}</b>
              <div
                class="t-muted"
                style="font-size: 11px"
              >
                {{ l.contact }} · {{ l.email }}
              </div>
            </td>
            <td>{{ l.country }} · {{ l.region }}</td>
            <td style="max-width: 200px">
              {{ l.category }}
            </td>
            <td>
              <TBadge :tone="gradeTone(l.grade)">
                {{ l.grade }} · {{ l.score }}
              </TBadge>
            </td>
            <td><span class="t-pill">{{ sourceLabel(l.source) }}</span></td>
            <td>
              <TBadge :tone="STATUS_TONE[l.status]">
                {{ STATUS_LABEL[l.status] }}
              </TBadge>
            </td>
            <td>
              <span
                v-if="l.replyClass"
                class="t-warn-txt"
                style="font-size: 11.5px"
              >{{ replyClassLabel(l.replyClass) }}</span>
              <span
                v-else
                class="t-muted"
                style="font-size: 11.5px"
              >—</span>
            </td>
          </tr>
          <tr v-if="!store.leads.value.length">
            <td
              colspan="7"
              class="t-muted"
              style="text-align: center; padding: 26px"
            >
              暂无线索。可从 M1 选品把智利/南非新酒庄一键存为建联线索。
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>

    <!-- ③ 选中线索详情 -->
    <template v-if="selected">
      <TSection
        :title="selected.company"
        :sub="`${selected.country} · ${selected.region} · ${selected.category}`"
      >
        <template #actions>
          <button
            class="t-btn sm"
            :disabled="!lastInbound || store.busy.value"
            :title="lastInbound ? '对最后一封回信做意向分类' : '尚无回信可判'"
            @click="classifyReply"
          >
            {{ store.busy.value ? "判定中…" : "判回信意向" }}
          </button>
          <button
            class="t-btn sm"
            :class="{ gold: canConvert }"
            :disabled="!canConvert || store.busy.value"
            :title="canConvert ? '入线索转供应商人工闸' : '需先收到合作意向回信'"
            @click="convertToSupplier"
          >
            {{ canConvert ? "转为供应商" : "待回信" }}
          </button>
        </template>
      </TSection>

      <div class="t-grid t-g2 detail">
        <!-- 画像 + 往来线程 -->
        <div
          class="t-col"
          style="gap: 12px"
        >
          <TPanel pad>
            <div class="pf-title">
              线索画像 <span class="t-muted">· 字段级置信度，&lt;85% 转人工核</span>
            </div>
            <div class="pf">
              <div
                v-for="(v, k) in selected.profile"
                :key="k"
                class="pf-row"
                :class="{ low: selected.confs[k] != null && selected.confs[k] < 85 }"
              >
                <span class="pf-k">{{ k }}</span>
                <span class="pf-v">{{ v }}</span>
                <TConf
                  v-if="selected.confs[k] != null"
                  :value="selected.confs[k]"
                />
                <span
                  v-else
                  class="pf-src"
                >已核</span>
              </div>
              <div class="pf-row">
                <span class="pf-k gold-k">建联优先级</span>
                <span class="pf-v">
                  <TBadge :tone="gradeTone(selected.grade)">{{ selected.grade }} · {{ selected.score }} 分</TBadge>
                </span>
              </div>
            </div>
            <div
              class="t-note"
              :class="selected.grade === 'A' ? 'info' : 'warn'"
              style="margin-bottom: 0"
            >
              {{
                selected.grade === "A"
                  ? "A 级 · 建议本周联系。"
                  : selected.grade === "B"
                    ? "B 级 · 可纳入下批建联。"
                    : "C 级 · 关键信息不足或匹配度低，降级处理。"
              }}
            </div>
          </TPanel>

          <TPanel pad>
            <div class="pf-title">
              往来线程 <span class="t-muted">· {{ selected.thread.length }} 封</span>
            </div>
            <div
              v-if="selected.thread.length"
              class="thread"
            >
              <div
                v-for="(m, i) in selected.thread"
                :key="i"
                class="tm"
                :class="m.dir"
              >
                <div class="tm-h">
                  <b>{{ m.who }}</b><span class="t-muted">{{ m.at }}</span>
                </div>
                <div class="tm-b">
                  {{ m.text }}
                </div>
              </div>
            </div>
            <div
              v-else
              class="empty"
            >
              尚无往来。生成开发信并通过外发核准闸后，SMTP 发出，工作流挂起等回信。
            </div>
            <div
              v-if="selected.replyClass"
              class="t-note ok"
              style="margin-bottom: 0"
            >
              回信意向分类：<b>{{ replyClassLabel(selected.replyClass) }}</b>。
              <template v-if="canConvert">
                可一键<b>转为潜在供应商</b>进入 M3 供应商公海（标签“新建联”）走既有询价比价流程。
              </template>
              <template v-else>
                非合作意向，加入抑制名单，不再建联。
              </template>
            </div>
          </TPanel>
        </div>

        <!-- 开发信草稿区 -->
        <TPanel pad>
          <div class="pf-title">
            开发信草稿 <span class="t-muted">· 逐家个性化，非模板群发</span>
          </div>
          <div class="lang-bar">
            <span
              class="t-muted"
              style="font-size: 12px"
            >语言</span>
            <div class="lang-tabs">
              <button
                v-for="ln in LANGS"
                :key="ln.k"
                class="lang-tab"
                :class="{ on: draftLang === ln.k }"
                @click="draftLang = ln.k"
              >
                {{ ln.label }}
              </button>
            </div>
            <button
              class="t-btn sm gold"
              style="margin-left: auto"
              :disabled="store.busy.value"
              @click="genOutreach"
            >
              <TIcon
                :path="ICONS.lead"
                :size="13"
              />
              {{ store.busy.value ? "生成中…" : currentDraft ? "重写此语言" : "生成开发信" }}
            </button>
          </div>

          <div class="mail-meta">
            <span>收件 <b>{{ selected.email }}</b></span>
            <span>会话 <b>conv-{{ selected.id }}</b></span>
            <span>语言 <b>{{ draftLang.toUpperCase() }}</b></span>
          </div>

          <pre
            v-if="currentDraft"
            class="mail-body"
          >{{ currentDraft }}</pre>
          <div
            v-else
            class="empty"
          >
            尚无 {{ draftLang.toUpperCase() }} 草稿。点“生成开发信”由 Claude 起草个性化破冰信（右侧 Console 可看流式过程），<b>生成后自动进外发核准闸</b>。
          </div>

          <div
            class="t-note info"
            style="margin-bottom: 0"
          >
            每封信引用对方真实信息（产区 / 认证 / 品类契合点）。去重（30 天同 domain）+ 频控 + <b>首发人工闸</b>生效——这一步会进人工审核看板。
          </div>
        </TPanel>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ── 漏斗 ── */
.fn { display: flex; flex-direction: column; gap: 10px; }
.fn-row { display: grid; grid-template-columns: 92px 1fr 92px; align-items: center; gap: 12px; }
.fn-lbl { font-size: 12px; color: var(--text-2); font-weight: 600; }
.fn-track { height: 26px; border-radius: 7px; background: var(--bg-soft); overflow: hidden; }
.fn-fill {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 10px;
  border-radius: 7px;
  min-width: 34px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  transition: width 0.7s cubic-bezier(0.22, 0.7, 0.25, 1), filter 0.16s;
}
.fn-row:hover .fn-fill { filter: brightness(1.06) saturate(1.05); }
.fn-n { font-size: 12px; font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; }
.fn-conv { font-size: 11px; color: var(--muted); text-align: right; }

/* ── 表格选中 ── */
.t-table tbody tr.on { background: var(--primary-soft); }
.t-table tbody tr.on:hover { background: var(--primary-soft); }

/* ── 详情 ── */
.detail { align-items: start; margin-top: 4px; }
@media (max-width: 900px) { .detail { grid-template-columns: 1fr; } }
.pf-title { font-size: 12.5px; font-weight: 750; color: var(--text); margin-bottom: 12px; }

.pf { display: flex; flex-direction: column; }
.pf-row {
  display: grid;
  grid-template-columns: 96px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-soft);
  font-size: 12.5px;
}
.pf-row:last-child { border-bottom: none; }
.pf-row.low { position: relative; }
.pf-row.low::before {
  content: "";
  position: absolute;
  left: -18px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 2px;
  background: var(--gold);
  opacity: 0.55;
}
.pf-k { color: var(--muted); font-weight: 600; }
.pf-k.gold-k { color: var(--gold); font-weight: 700; }
.pf-v { color: var(--text); word-break: break-word; }
.pf-src { font-size: 10.5px; color: var(--ok); font-weight: 700; white-space: nowrap; }

/* ── 线程气泡 ── */
.thread { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
.tm {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 9px 12px;
  max-width: 92%;
  background: var(--panel);
  transition: box-shadow 0.16s;
}
.tm:hover { box-shadow: 0 1px 6px rgba(0, 0, 0, 0.07); }
.tm.out { align-self: flex-end; background: var(--primary-soft); border-color: transparent; }
.tm.in { align-self: flex-start; background: var(--bg-soft); }
.tm-h { display: flex; justify-content: space-between; gap: 12px; font-size: 11px; margin-bottom: 5px; }
.tm-h b { color: var(--text); font-weight: 700; }
.tm-b { font-size: 12px; line-height: 1.55; color: var(--text-2); white-space: pre-wrap; word-break: break-word; }

.empty {
  font-size: 12px;
  color: var(--muted);
  padding: 18px 14px;
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
  text-align: center;
  margin-bottom: 12px;
}

/* ── 开发信 ── */
.lang-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.lang-tabs { display: inline-flex; gap: 4px; padding: 3px; border-radius: 9px; background: var(--bg-soft); }
.lang-tab {
  font-size: 11.5px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition: all 0.14s;
}
.lang-tab:hover { color: var(--text); }
.lang-tab.on { background: var(--panel); color: var(--text); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }

.mail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 11px;
  color: var(--muted);
  padding-bottom: 10px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-soft);
}
.mail-meta b { color: var(--text-2); }
.mail-body {
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.65;
  color: var(--text-2);
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--bg-soft);
  border-radius: 10px;
  padding: 14px;
  margin: 0 0 12px;
  max-height: 420px;
  overflow: auto;
}
</style>
