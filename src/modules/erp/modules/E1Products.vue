<script setup lang="ts">
/**
 * E1 选品中心 —— 趋势调研 · 候选池状态机 · 利润测算器。
 *
 * 上部：调研表单（关键词/品类/价位带/数量）→ store.runResearch，选品官联网调研并结构化入候选池。
 * 中部：候选池全列表（store.products），状态机 候选→打样→测款→在售/放弃 —— 行内按钮直接推进
 *       （改 p.state 即可，store 深度 watch 自动落盘），转正=入 SKU 主数据，无外部影响不设闸。
 * 下部：利润测算器 —— computeProfit 单点真相（与 E3 定价引擎逐分位一致），选品+改价实时算明细。
 */
import { ref, computed } from "vue";
import { useErpStore } from "../useErpStore";
import { computeProfit, EICONS } from "../types";
import type { Product, ProductState } from "../types";
import TSection from "../../trade/components/TSection.vue";
import TPanel from "../../trade/components/TPanel.vue";
import TBadge from "../../trade/components/TBadge.vue";
import TIcon from "../../trade/components/TIcon.vue";

const store = useErpStore();

/* ── 调研条件（本地表单状态） ── */
const keywords = ref("宠物 智能 用品");
const category = ref("宠物用品");
const priceBand = ref("$10 - $30");
const count = ref(5);

async function research() {
  if (store.busy.value) return;
  await store.runResearch({
    keywords: keywords.value.trim(),
    category: category.value.trim(),
    priceBand: priceBand.value.trim(),
    count: Math.max(1, Math.min(10, Number(count.value) || 5)),
  });
}

/* ── 状态机：徽标色 + 标签 ── */
const STATE_META: Record<ProductState, { label: string; tone: "gray" | "amber" | "blue" | "green" | "red" }> = {
  candidate: { label: "候选", tone: "gray" },
  sampling: { label: "打样", tone: "amber" },
  testing: { label: "测款", tone: "blue" },
  active: { label: "在售", tone: "green" },
  dropped: { label: "放弃", tone: "red" },
};

/* 状态推进：直接改 state（本地状态机，无外部影响；autopersist 自动落盘并留在候选池可追溯）。 */
function setState(p: Product, s: ProductState) {
  p.state = s;
  store.log("ok", `${p.name} 状态 → ${STATE_META[s].label}${s === "active" ? "（已入 SKU 主数据，上架发布请去 E2 过审批闸）" : ""}`);
}

const activeCount = computed(() => store.products.value.filter((p) => p.state === "active").length);
const candCount = computed(() => store.products.value.filter((p) => p.state === "candidate").length);

/* ── 利润测算器：选品 + 可改售价 → computeProfit 实时明细 ── */
const calcId = ref(store.products.value[0]?.id || "");
const calcPrice = ref(store.products.value[0]?.priceUsd || 0);
const calcProd = computed(() => store.products.value.find((p) => p.id === calcId.value) || null);
/* 换品时把售价重置为该品建议售价 */
function onPick() {
  if (calcProd.value) calcPrice.value = calcProd.value.priceUsd;
}
const breakdown = computed(() => {
  const p = calcProd.value;
  if (!p) return null;
  return computeProfit(Number(calcPrice.value) || 0, p.costCny, p.shipUsd, store.params.value);
});
</script>

<template>
  <div class="e1 t-view-anim">
    <!-- 分流说明 -->
    <div class="e-gates">
      <b>本页分流</b>
      <span class="e-auto">自动</span> 调研、利润测算由选品官 AI 直接产出候选池；
      <span class="e-auto">自动</span> 候选转正=改状态即入 SKU 主数据（无外部影响，不设闸）；
      <span class="e-human soft">需审批</span> 上架发布在 E2 有审批闸，转正后去 E2 生成 Listing。
    </div>

    <!-- 调研表单 -->
    <TSection
      title="选品调研"
      sub="关键词 / 品类 / 价位带 / 数量 → 选品官联网调研，结构化写入候选池"
    >
      <template #actions>
        <span class="t-pill">候选 {{ candCount }}</span>
        <span class="t-pill">在售 {{ activeCount }}</span>
      </template>
    </TSection>
    <TPanel pad>
      <div class="e1-grid">
        <label class="e1-fld">
          <span class="e1-lbl">关键词</span>
          <input
            v-model="keywords"
            class="e1-in"
            type="text"
            placeholder="如：宠物 智能 用品"
            :disabled="store.busy.value"
          >
        </label>
        <label class="e1-fld">
          <span class="e1-lbl">品类</span>
          <input
            v-model="category"
            class="e1-in"
            type="text"
            placeholder="如：宠物用品"
            :disabled="store.busy.value"
          >
        </label>
        <label class="e1-fld">
          <span class="e1-lbl">价位带</span>
          <input
            v-model="priceBand"
            class="e1-in"
            type="text"
            placeholder="如：$10 - $30"
            :disabled="store.busy.value"
          >
        </label>
        <label class="e1-fld e1-num">
          <span class="e1-lbl">数量</span>
          <input
            v-model.number="count"
            class="e1-in"
            type="number"
            min="1"
            max="10"
            :disabled="store.busy.value"
          >
        </label>
      </div>
      <div class="e1-bar t-row">
        <button
          class="t-btn primary"
          :disabled="store.busy.value"
          @click="research"
        >
          <TIcon
            :path="EICONS.product"
            :size="15"
          />
          {{ store.busy.value ? "调研中…" : "让选品官调研" }}
        </button>
        <span
          v-if="store.runStatus.value"
          class="e1-status"
        >{{ store.runStatus.value }}</span>
        <span
          v-else
          class="t-muted e1-hint"
        >调研过程实时显示在右侧 Console；候选带利润测算（computeProfit）与评分理由。</span>
      </div>
    </TPanel>

    <!-- 候选池全列表 -->
    <TSection
      title="候选池 / SKU 主数据"
      sub="候选 → 打样 → 测款 → 在售 状态机 · 净利率低于红线标红"
    />
    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>品类</th>
            <th>状态</th>
            <th class="num">
              采购价¥
            </th>
            <th class="num">
              运费$
            </th>
            <th class="num">
              售价$
            </th>
            <th class="num">
              竞品$
            </th>
            <th class="num">
              月销
            </th>
            <th class="num">
              净利率%
            </th>
            <th class="num">
              评分
            </th>
            <th>理由</th>
            <th style="text-align:right">
              状态推进
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in store.products.value"
            :key="p.id"
          >
            <td>
              <b>{{ p.name }}</b>
              <div class="t-muted e1-en">
                {{ p.nameEn }}
              </div>
            </td>
            <td>{{ p.category }}</td>
            <td>
              <TBadge :tone="STATE_META[p.state].tone">
                {{ STATE_META[p.state].label }}
              </TBadge>
            </td>
            <td class="num t-mono">
              {{ p.costCny }}
            </td>
            <td class="num t-mono">
              {{ p.shipUsd }}
            </td>
            <td class="num t-mono">
              {{ p.priceUsd }}
            </td>
            <td class="num t-mono">
              {{ p.rivalUsd }}
            </td>
            <td class="num t-mono">
              {{ p.monthlySales }}
            </td>
            <td
              class="num t-mono"
              :class="{ 't-warn-txt': p.marginPct < store.params.value.minMarginFloorPct }"
            >
              {{ p.marginPct }}
            </td>
            <td class="num t-mono">
              {{ p.score }}
            </td>
            <td>
              <span
                class="e1-reason"
                :title="p.reason"
              >{{ p.reason }}</span>
            </td>
            <td>
              <div class="e1-acts">
                <button
                  v-if="p.state === 'candidate'"
                  class="t-btn sm"
                  @click="setState(p, 'sampling')"
                >
                  打样
                </button>
                <button
                  v-if="p.state === 'sampling'"
                  class="t-btn sm"
                  @click="setState(p, 'testing')"
                >
                  测款
                </button>
                <button
                  v-if="p.state === 'testing'"
                  class="t-btn sm gold"
                  @click="setState(p, 'active')"
                >
                  转正
                </button>
                <button
                  v-if="p.state !== 'dropped'"
                  class="t-btn sm"
                  @click="setState(p, 'dropped')"
                >
                  放弃
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="store.products.value.length === 0">
            <td colspan="12">
              <div class="e1-empty t-muted">
                候选池为空 —— 填写上方调研条件让选品官跑一轮。
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>
    <div class="t-note info">
      <b>净利率红线 {{ store.params.value.minMarginFloorPct }}%</b>（参数中心 minMarginFloorPct）：低于红线的品标红，
      建议放弃或压采购价；该红线同时是 E3 定价引擎的保本硬底线，AI 无法绕过。
    </div>

    <!-- 利润测算器 -->
    <TSection
      title="利润测算器"
      sub="computeProfit 单点真相 —— 与 E3 定价、审批卡片逐分位一致"
    />
    <TPanel pad>
      <div class="e1-bar t-row">
        <label class="e1-fld">
          <span class="e1-lbl">选择产品</span>
          <select
            v-model="calcId"
            class="e1-in"
            @change="onPick"
          >
            <option
              v-for="p in store.products.value"
              :key="p.id"
              :value="p.id"
            >{{ p.name }}（¥{{ p.costCny }} + 运 ${{ p.shipUsd }}）</option>
          </select>
        </label>
        <label class="e1-fld e1-num">
          <span class="e1-lbl">试算售价 $</span>
          <input
            v-model.number="calcPrice"
            class="e1-in"
            type="number"
            min="0"
            step="0.5"
          >
        </label>
      </div>
      <table
        v-if="breakdown"
        class="t-table e1-calc"
      >
        <tbody>
          <tr>
            <td>收入</td><td class="num t-mono">
              ${{ breakdown.revenueUsd }}
            </td>
          </tr>
          <tr>
            <td>货成本（¥{{ calcProd?.costCny }} ÷ 汇率 {{ store.params.value.usdCny }}）</td><td class="num t-mono">
              -${{ breakdown.costUsd }}
            </td>
          </tr>
          <tr>
            <td>头尾程运费</td><td class="num t-mono">
              -${{ breakdown.shipUsd }}
            </td>
          </tr>
          <tr>
            <td>平台佣金（{{ store.params.value.platformFeePct }}%）</td><td class="num t-mono">
              -${{ breakdown.platformFeeUsd }}
            </td>
          </tr>
          <tr>
            <td>广告（{{ store.params.value.adCostPct }}%）</td><td class="num t-mono">
              -${{ breakdown.adUsd }}
            </td>
          </tr>
          <tr>
            <td>退货损耗（{{ store.params.value.returnRatePct }}%）</td><td class="num t-mono">
              -${{ breakdown.returnLossUsd }}
            </td>
          </tr>
          <tr>
            <td><b>净利 / 净利率</b></td>
            <td
              class="num t-mono"
              :class="breakdown.marginPct < store.params.value.minMarginFloorPct ? 't-warn-txt' : 'e1-ok'"
            >
              <b>${{ breakdown.profitUsd }} · {{ breakdown.marginPct }}%</b>
            </td>
          </tr>
        </tbody>
      </table>
      <div
        v-else
        class="t-muted e1-hint"
      >
        候选池为空，先跑一轮调研。
      </div>
    </TPanel>
  </div>
</template>

<style scoped>
/* 调研表单版式（版式靠共享类，这里只放字段外观） */
.e1-grid { display: grid; grid-template-columns: 1.4fr 1fr 1fr 0.5fr; gap: 12px; }
@media (max-width: 860px) { .e1-grid { grid-template-columns: 1fr 1fr; } }
.e1-fld { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.e1-lbl { font-size: 10.5px; font-weight: 700; color: var(--muted); letter-spacing: 0.04em; }
.e1-in {
  font-size: 12.5px; padding: 8px 11px; border-radius: 8px;
  border: 1px solid var(--border-strong); background: var(--bg-soft); color: var(--text);
  font-family: inherit; box-sizing: border-box; width: 100%;
}
.e1-in:focus { outline: none; border-color: var(--primary); background: var(--panel); }
.e1-in:disabled { opacity: 0.55; cursor: not-allowed; }
.e1-bar { margin-top: 12px; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
.e1-status { font-size: 12px; font-weight: 600; color: var(--ok); }
.e1-hint { font-size: 11.5px; }

/* 候选池表 */
.e1-en { font-size: 10.5px; }
.e1-reason { display: inline-block; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; cursor: help; }
.e1-acts { display: flex; gap: 6px; justify-content: flex-end; }
.e1-empty { text-align: center; padding: 26px 12px; font-size: 12px; }

/* 测算明细 */
.e1-calc { margin-top: 12px; max-width: 560px; }
.e1-ok { color: var(--ok); }
</style>
