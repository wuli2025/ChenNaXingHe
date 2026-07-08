<script setup lang="ts">
/**
 * E2 上架 Listing —— AI 生成 · 规则体检 · 发布/改版审批闸。
 *
 * 上部：KPI（在售 / 待审 / 优化中 / 平均转化率）。
 * 中部：Listing 表（store.listings），行点击展开详情（标题全文 / 五点 / 关键词 / 体检清单 / AI 提案）。
 * 行动作：「AI 生成/优化」→ store.runListingGen(l.id) —— 运营官产出后自动入审批闸
 *        （新品 listing-publish / 在售 listing-update），去审批中心核准后 store 才回写上线。
 * 驳回闭环：审批中心驳回会带批注自动重跑（store.rerunFromReject），本页无需处理。
 */
import { ref, computed } from "vue";
import { useErpStore } from "../useErpStore";
import { EICONS } from "../types";
import type { Listing, ListingStatus } from "../types";
import TSection from "../../trade/components/TSection.vue";
import TPanel from "../../trade/components/TPanel.vue";
import TBadge from "../../trade/components/TBadge.vue";
import TKpi from "../../trade/components/TKpi.vue";
import TIcon from "../../trade/components/TIcon.vue";

const store = useErpStore();

/* ── KPI 派生 ── */
const liveCount = computed(() => store.listings.value.filter((l) => l.status === "live").length);
const pendingCount = computed(() => store.listings.value.filter((l) => l.status === "pending_review").length);
const optimizingCount = computed(() => store.listings.value.filter((l) => l.status === "optimizing").length);
const avgCvr = computed(() => {
  const rated = store.listings.value.filter((l) => l.cvr !== undefined);
  if (!rated.length) return "—";
  const avg = rated.reduce((s, l) => s + (l.cvr || 0), 0) / rated.length;
  return `${avg.toFixed(1)}%`;
});

/* ── 状态徽标 ── */
const STATUS_META: Record<ListingStatus, { label: string; tone: "gray" | "amber" | "green" | "blue" | "red" }> = {
  draft: { label: "草稿", tone: "gray" },
  pending_review: { label: "待审", tone: "amber" },
  live: { label: "在售", tone: "green" },
  optimizing: { label: "优化中", tone: "blue" },
  paused: { label: "暂停", tone: "red" },
};

/* 体检通过数（未全过的行标警） */
function passCount(l: Listing): number {
  return l.checks.filter((c) => c.pass).length;
}

/* ── 行展开详情 ── */
const expanded = ref<string | null>(null);
function toggle(id: string) {
  expanded.value = expanded.value === id ? null : id;
}

/* ── AI 生成/优化：产出后进审批闸（新品=发布闸，在售=改版闸），永不直接上线 ── */
async function gen(l: Listing) {
  if (store.busy.value) return;
  await store.runListingGen(l.id);
}
</script>

<template>
  <div class="e2 t-view-anim">
    <!-- 分流说明 -->
    <div class="e-gates">
      <b>本页分流</b>
      <span class="e-auto">自动</span> Listing 文案生成、平台规则体检（禁词/类目/图片）由运营官 AI 自动完成；
      <span class="e-human soft">需审批</span> 新品发布（listing-publish）与修改在售（listing-update）都要过审批闸，核准后才回写上线；
      驳回会带批注<b>自动重跑</b>，改进稿再次入闸。
    </div>

    <!-- KPI -->
    <div class="t-grid t-g4">
      <TKpi
        :value="String(liveCount)"
        label="在售 Listing"
        :up="true"
        acc="green"
        :icon="EICONS.listing"
      />
      <TKpi
        :value="String(pendingCount)"
        label="待审发布"
        delta="在审批中心等你核准"
        :acc="pendingCount ? 'amber' : 'green'"
        :icon="EICONS.review"
      />
      <TKpi
        :value="String(optimizingCount)"
        label="优化中"
        delta="A/B 回评驱动"
        acc="blue"
        :icon="EICONS.params"
      />
      <TKpi
        :value="avgCvr"
        label="平均转化率"
        delta="在售/优化中回评均值"
        acc="gold"
        :icon="EICONS.dash"
      />
    </div>

    <!-- Listing 表 -->
    <TSection
      title="Listing 列表"
      sub="点击行展开：标题全文 · 五点 · 关键词 · 体检清单 · AI 优化提案"
    >
      <template #actions>
        <span class="t-pill">共 {{ store.listings.value.length }} 条</span>
      </template>
    </TSection>
    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>产品</th>
            <th>平台</th>
            <th>语言</th>
            <th>状态</th>
            <th class="num">
              CVR
            </th>
            <th class="num">
              CTR
            </th>
            <th>体检</th>
            <th style="text-align:right">
              动作
            </th>
          </tr>
        </thead>
        <tbody>
          <template
            v-for="l in store.listings.value"
            :key="l.id"
          >
            <tr
              class="clk"
              @click="toggle(l.id)"
            >
              <td><b>{{ l.productName }}</b></td>
              <td>{{ l.platform }}</td>
              <td class="t-mono">
                {{ l.lang }}
              </td>
              <td>
                <TBadge :tone="STATUS_META[l.status].tone">
                  {{ STATUS_META[l.status].label }}
                </TBadge>
              </td>
              <td class="num t-mono">
                {{ l.cvr !== undefined ? l.cvr + "%" : "—" }}
              </td>
              <td class="num t-mono">
                {{ l.ctr !== undefined ? l.ctr + "%" : "—" }}
              </td>
              <td>
                <span :class="passCount(l) < l.checks.length ? 't-warn-txt' : 'e2-ok'">
                  {{ passCount(l) }}/{{ l.checks.length }}{{ passCount(l) < l.checks.length ? " 未过" : " 全过" }}
                </span>
              </td>
              <td style="text-align:right">
                <button
                  class="t-btn sm gold"
                  :disabled="store.busy.value"
                  :title="l.status === 'live' || l.status === 'optimizing' ? '重写在售内容，产出进改版核准闸' : '生成新 Listing，产出进发布核准闸'"
                  @click.stop="gen(l)"
                >
                  <TIcon
                    :path="EICONS.listing"
                    :size="13"
                  />
                  {{ l.status === "live" || l.status === "optimizing" ? "AI 优化" : "AI 生成" }}
                </button>
              </td>
            </tr>
            <!-- 展开详情 -->
            <tr
              v-if="expanded === l.id"
              class="e2-detail"
            >
              <td colspan="8">
                <div class="e2-dt">
                  <div class="e2-block">
                    <span class="e2-k">标题</span>
                    <p class="e2-title">
                      {{ l.title }}
                    </p>
                  </div>
                  <div class="e2-block">
                    <span class="e2-k">五点描述</span>
                    <ol class="e2-bullets">
                      <li
                        v-for="(b, i) in l.bullets"
                        :key="i"
                      >
                        {{ b }}
                      </li>
                    </ol>
                  </div>
                  <div class="e2-block">
                    <span class="e2-k">关键词</span>
                    <p class="t-mono e2-kw">
                      {{ l.keywords }}
                    </p>
                  </div>
                  <div class="e2-block">
                    <span class="e2-k">规则体检</span>
                    <ul class="e2-checks">
                      <li
                        v-for="c in l.checks"
                        :key="c.name"
                        :class="{ 't-warn-txt': !c.pass }"
                      >
                        {{ c.pass ? "✓" : "✗" }} {{ c.name }}<template v-if="!c.pass && c.note">
                          —— {{ c.note }}
                        </template>
                      </li>
                    </ul>
                  </div>
                  <div
                    v-if="l.proposal"
                    class="t-note info e2-prop"
                  >
                    <b>AI 优化提案</b>：{{ l.proposal }}
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="store.listings.value.length === 0">
            <td colspan="8">
              <div class="e2-empty t-muted">
                暂无 Listing —— 在 E1 把候选转正后，这里会为其建 Listing 档。
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>

    <!-- 底部说明：发布/改版永不直接上线 -->
    <div class="t-note warn">
      <b>发布/改版永不直接上线</b>：「AI 生成 / AI 优化」只产出内容并派一张
      <b>发布核准（listing-publish）</b>或<b>改版核准（listing-update）</b>卡片进<b>审批中心</b>，
      老板核准后 store 才回写线上状态（置「在售」）；驳回则带批注自动重跑，改进稿再次入闸 —— 全程留台账可追溯。
    </div>
  </div>
</template>

<style scoped>
.e2-ok { color: var(--ok); font-weight: 600; }

/* 展开详情：与行区隔的软底面板 */
.e2-detail td { background: var(--bg-soft); }
.e2-dt { display: flex; flex-direction: column; gap: 10px; padding: 4px 2px; }
.e2-block { display: flex; flex-direction: column; gap: 4px; }
.e2-k { font-size: 10px; font-weight: 800; letter-spacing: 0.05em; color: var(--muted); text-transform: uppercase; }
.e2-title { margin: 0; font-size: 12.5px; font-weight: 600; color: var(--text); line-height: 1.6; }
.e2-bullets { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; }
.e2-bullets li { font-size: 12px; line-height: 1.6; color: var(--text-2); }
.e2-kw { margin: 0; font-size: 11.5px; color: var(--text-2); }
.e2-checks { margin: 0; padding-left: 2px; list-style: none; display: flex; flex-direction: column; gap: 3px; }
.e2-checks li { font-size: 12px; line-height: 1.6; color: var(--ok); }
.e2-checks li.t-warn-txt { color: var(--vermilion); }
.e2-prop { margin: 2px 0 0; }
.e2-empty { text-align: center; padding: 26px 12px; font-size: 12px; }
</style>
