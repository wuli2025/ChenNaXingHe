<script setup lang="ts">
/**
 * E3 · 定价引擎
 * 四层价格结构（保本/目标/现价/竞品）+ 跟价策略徽标 + 净利率红线监控。
 * 有界自治分流：±带宽内 AI 自动调价（e-auto）；超幅进审批（e-human.soft）；
 * 低于保本硬底线 = 硬闸，且核心层 applyPriceInternal 会把任何调价（含人工批准的）
 * 钳制到红线价之上 —— AI 无法绕过，这是写死在无头核心的红线。
 * 零 props，数据全部取自 useErpStore（ref → .value）。
 */
import { ref } from "vue";
import { useErpStore } from "../useErpStore";
import type { PriceCard } from "../types";
import TSection from "../../trade/components/TSection.vue";
import TPanel from "../../trade/components/TPanel.vue";
import TBadge from "../../trade/components/TBadge.vue";

const store = useErpStore();

/* 展开行 key（sku@platform 唯一定位一张价格卡）。 */
const openKey = ref("");
function keyOf(c: PriceCard): string {
  return `${c.sku}@${c.platform}`;
}
function toggle(c: PriceCard) {
  const k = keyOf(c);
  openKey.value = openKey.value === k ? "" : k;
  // 换行即重置输入与提示，避免上一行的残留串台
  ctx.value = "例行竞价巡检";
  manualPrice.value = "";
  hint.value = "";
}

/* 行内输入：AI 触发背景 / 手动新价 / 动作结果提示（一次只展开一行，共用即可）。 */
const ctx = ref("例行竞价巡检");
const manualPrice = ref("");
const hint = ref("");

/* 跟价策略 → 徽标文案与色调。 */
const STRATEGY: Record<PriceCard["strategy"], { label: string; tone: "blue" | "amber" | "gray" }> = {
  follow: { label: "follow 跟随", tone: "blue" },
  undercut: { label: "undercut 压价", tone: "amber" },
  hold: { label: "hold 守价", tone: "gray" },
};

/* 净利率是否击穿红线（红线 = 参数中心 minMarginFloorPct）。 */
function belowFloor(c: PriceCard): boolean {
  return c.marginPct < store.params.value.minMarginFloorPct;
}

/* 变价日志时间格式化。 */
function fmtAt(at: number): string {
  const d = new Date(at);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/* ① AI 定价分析 → runPriceAdvice（产出→策略引擎分流：带宽内自动 / 超幅进闸）。 */
async function advice(c: PriceCard) {
  if (store.busy.value) return;
  hint.value = "";
  const r = await store.runPriceAdvice(c.sku, c.platform, ctx.value.trim() || "例行竞价巡检");
  hint.value =
    r === "auto" ? "带宽内已自动调价生效（已留台账）"
    : r === "review" ? "超出自治边界，调价提案已入审批闸"
    : "定价分析失败，详见右侧控制台";
}

/* ② 老板手动调价 → proposePriceChange（人工提案走同一分流闸，硬底线同样生效）。 */
function manual(c: PriceCard) {
  const p = Number(manualPrice.value);
  if (!Number.isFinite(p) || p <= 0) {
    hint.value = "请先输入有效的新价（USD）";
    return;
  }
  const r = store.proposePriceChange(c.sku, c.platform, p, "老板手动调价");
  hint.value =
    r === "auto" ? `已生效：${c.name} 现价 $${c.currentUsd}（若触底已被钳制到红线价）`
    : r === "review" ? "超幅或低于硬底线，已入审批闸等你核准"
    : "未找到该价格卡";
  manualPrice.value = "";
}
</script>

<template>
  <div class="e3 t-view-anim">
    <!-- 分流说明：哪些自动 / 哪些进审批 / 哪条是硬底线 -->
    <div class="e-gates">
      <span class="e-auto">AI 自动</span>
      <span>±{{ store.params.value.priceAutoBandPct }}% 带宽内动态调价，自动执行并留痕</span>
      <span class="e-human soft">需审批</span>
      <span>超出带宽的调价提案进审批闸，核准后生效</span>
      <span class="e-human">硬底线</span>
      <span><b>低于保本硬底线</b>（净利率 &lt; {{ store.params.value.minMarginFloorPct }}%）为硬闸，核心层强制钳制，AI 无法绕过</span>
    </div>

    <TSection
      title="价格卡 · 四层价格"
      sub="保本 / 目标 / 现价 / 竞品 · 点行展开变价日志与调价动作"
    >
      <template #actions>
        <span class="t-pill">{{ store.prices.value.length }} 张价格卡</span>
      </template>
    </TSection>

    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>平台</th>
            <th class="num">
              保本价 / 红线价
            </th>
            <th class="num">
              目标价
            </th>
            <th class="num">
              现价
            </th>
            <th class="num">
              竞品价
            </th>
            <th>策略</th>
            <th class="num">
              净利率
            </th>
            <th />
          </tr>
        </thead>
        <tbody>
          <template
            v-for="c in store.prices.value"
            :key="keyOf(c)"
          >
            <tr
              class="clk"
              @click="toggle(c)"
            >
              <td>
                <b>{{ c.name }}</b><div
                  class="t-muted t-mono"
                  style="font-size: 11px"
                >
                  {{ c.sku }}
                </div>
              </td>
              <td>{{ c.platform }}</td>
              <td class="num t-mono">
                ${{ c.breakEvenUsd.toFixed(2) }}
                <div
                  class="floor"
                  :title="`红线价=净利率≥${store.params.value.minMarginFloorPct}%`"
                >
                  红线 ${{ store.floorPrice(c).toFixed(2) }}
                </div>
              </td>
              <td class="num t-mono">
                ${{ c.targetUsd.toFixed(2) }}
              </td>
              <td class="num t-mono">
                <b>${{ c.currentUsd.toFixed(2) }}</b>
              </td>
              <td class="num t-mono">
                ${{ c.rivalUsd.toFixed(2) }}
              </td>
              <td>
                <TBadge :tone="STRATEGY[c.strategy].tone">
                  {{ STRATEGY[c.strategy].label }}
                </TBadge>
              </td>
              <td
                class="num"
                :class="{ 't-warn-txt': belowFloor(c) }"
              >
                {{ c.marginPct.toFixed(1) }}%
                <TBadge
                  v-if="belowFloor(c)"
                  tone="red"
                >
                  破红线
                </TBadge>
              </td>
              <td style="text-align: right">
                <span class="t-pill">{{ openKey === keyOf(c) ? "收起 ▴" : "调价 ▾" }}</span>
              </td>
            </tr>

            <!-- 展开：变价日志 + 双动作（AI 分析 / 手动调价） -->
            <tr
              v-if="openKey === keyOf(c)"
              :key="keyOf(c) + '-x'"
            >
              <td
                colspan="9"
                class="x-cell"
              >
                <div
                  class="t-col"
                  style="gap: 10px"
                >
                  <!-- 最近变价日志 -->
                  <div
                    v-if="c.lastChange"
                    class="t-row"
                    style="flex-wrap: wrap"
                  >
                    <span class="t-pill">最近变价</span>
                    <span class="t-mono">{{ fmtAt(c.lastChange.at) }}</span>
                    <span class="t-mono"><b>${{ c.lastChange.from }} → ${{ c.lastChange.to }}</b></span>
                    <span class="t-muted">{{ c.lastChange.reason }}</span>
                    <TBadge :tone="c.lastChange.by === 'auto' ? 'green' : 'gold'">
                      {{ c.lastChange.by === "auto" ? "auto" : "human" }}
                    </TBadge>
                  </div>
                  <div
                    v-else
                    class="t-muted"
                    style="font-size: 12px"
                  >
                    暂无变价记录 —— 首次调价将在此留痕。
                  </div>

                  <!-- 动作区：AI 定价分析 / 老板手动调价 -->
                  <div
                    class="t-row"
                    style="flex-wrap: wrap"
                    @click.stop
                  >
                    <input
                      v-model="ctx"
                      class="inp"
                      style="width: 190px"
                      placeholder="触发背景（如：竞品降价）"
                    >
                    <button
                      class="t-btn sm gold"
                      :disabled="store.busy.value"
                      @click="advice(c)"
                    >
                      {{ store.busy.value ? "分析中…" : "AI 定价分析" }}
                    </button>
                    <span class="t-muted">｜</span>
                    <input
                      v-model="manualPrice"
                      class="inp"
                      style="width: 110px"
                      type="number"
                      step="0.01"
                      placeholder="新价 $"
                    >
                    <button
                      class="t-btn sm primary"
                      @click="manual(c)"
                    >
                      手动调价
                    </button>
                    <span
                      v-if="hint"
                      class="hint"
                    >{{ hint }}</span>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </TPanel>

    <!-- 保本硬底线说明 -->
    <div class="t-note danger">
      <b>保本硬底线（核心层强制）：</b>任何调价 —— 包括 AI 自动调价与<b>人工批准的调价</b> ——
      在执行时都会被无头核心钳制到红线价之上（红线价 = 净利率 ≥ {{ store.params.value.minMarginFloorPct }}% 的最低售价）。
      这条钳制写死在执行函数里，不是参数开关，AI 与审批流都无法绕过。
    </div>
  </div>
</template>

<style scoped>
/* 红线价小字：贴在保本价下方，常红提示 */
.floor { font-size: 10.5px; color: var(--vermilion); margin-top: 1px; }

/* 展开行外壳 */
.x-cell { background: var(--bg-soft); padding: 12px 16px !important; }

/* 行内输入框（共享 CSS 无 input 类，最小补充） */
.inp {
  height: 27px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font-size: 12px;
  outline: none;
}
.inp:focus { border-color: var(--primary); }

/* 动作结果提示 */
.hint { font-size: 12px; color: var(--text-2); }
</style>
