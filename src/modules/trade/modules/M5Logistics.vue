<script setup lang="ts">
/**
 * M5 · 物流管理
 * 在途货柜清单（提单/商品/from→to/ETA P50·P90/状态/滞期风险/进度条），
 * 点柜展开竖向里程碑时间线（订舱→开船→在途→到港→清关→入仓，done/now），
 * 「解析货代 EDI 邮件更新里程碑」调 store.runChat（右侧 Console 可见流式），
 * 异常里程碑走人工闸 store.enqueueReview({mod:'m5',kind:'milestone-anomaly',...})。
 * 到港自动开 GRN 推 M6 的说明用 t-note.info。零 props，数据取自 store（ref → .value）。
 */
import { ref, computed } from "vue";
import { useTradeStore } from "../useTradeStore";
import type { Shipment } from "../types";
import { ICONS } from "../types";
import TSection from "../components/TSection.vue";
import TPanel from "../components/TPanel.vue";
import TBadge from "../components/TBadge.vue";
import TKpi from "../components/TKpi.vue";
import TIcon from "../components/TIcon.vue";

const store = useTradeStore();

/* 展开的货柜 id（点行/点卡展开里程碑时间线）。 */
const openId = ref<string>(store.shipments.value[0]?.id ?? "");
function toggle(id: string) {
  openId.value = openId.value === id ? "" : id;
}

/* KPI：在途柜数 / 到港待清关 / 滞期风险柜 / 平均进度。 */
const kpis = computed(() => {
  const list = store.shipments.value;
  const arrived = list.filter((s) => s.status.includes("到港")).length;
  const demur = list.filter((s) => s.demurrage === "中" || s.demurrage === "高").length;
  const avg = list.length ? Math.round(list.reduce((a, s) => a + s.pct, 0) / list.length) : 0;
  return { total: list.length, arrived, demur, avg };
});

/* 滞期风险 → 徽标色。 */
function demurTone(d: string): "green" | "amber" | "red" {
  return d === "高" ? "red" : d === "中" ? "amber" : "green";
}
/* 状态 → 徽标色。 */
function statusTone(s: string): "blue" | "green" | "amber" | "gray" {
  if (s.includes("入仓")) return "green";
  if (s.includes("到港") || s.includes("清关")) return "amber";
  if (s.includes("在途")) return "blue";
  return "gray";
}
/* 里程碑节点状态类。 */
function msState(m: Shipment["milestones"][number]): "now" | "done" | "todo" {
  return m.now ? "now" : m.done ? "done" : "todo";
}

/* 已到港的柜（触发到港自动开 GRN 说明）。 */
const arrivedShip = computed(() =>
  store.shipments.value.find((s) => s.milestones.some((m) => m.now && m.t.includes("到港")))
);

/* 「解析货代 EDI 邮件更新里程碑」——调通用对话，右侧 Console 实时可见。 */
async function parseEdi() {
  if (store.busy.value) return;
  try {
    await store.runChat(
      "物流管理",
      "里程碑",
      "请把货代回传的里程碑事件解析为结构化状态更新",
      false
    );
  } catch (e) {
    // 后端失败时给出可见反馈，避免静默失败 + 未处理的 promise 拒绝。
    store.log("error", `EDI 解析失败：${(e as Error).message || String(e)}`);
  }
}

/* 异常里程碑上报——走人工闸（进中央审核看板流水线）。核准后写入异常里程碑并升级滞期。 */
function flagAnomaly(s: Shipment) {
  const now = s.milestones.find((m) => m.now);
  const anomaly = `${s.status} · ${s.from}→${s.to} · 滞期${s.demurrage}`;
  store.enqueueReview({
    mod: "m5",
    kind: "milestone-anomaly",
    title: `货柜 ${s.id} 物流异常里程碑确认`,
    refId: s.id,
    origin: "manual",
    summary: `货柜 ${s.id}（${s.goods}）当前『${s.status}』，${s.from}→${s.to}，ETA P50 ${s.etaP50}/P90 ${s.etaP90}，滞期风险『${s.demurrage}』，货代回传节点疑似异常，转人工核实。`,
    facts: [
      { k: "当前节点", v: now ? `${now.t} · ${now.at}` : s.status },
      { k: "路由 / ETA", v: `${s.from}→${s.to} · P50 ${s.etaP50}` },
      { k: "滞期风险", v: s.demurrage, warn: s.demurrage !== "低" },
    ],
    risk: s.demurrage === "高" ? "high" : "normal",
    payload: { anomaly },
  });
}

/* 确认到港 → 开 GRN 收货单，货物入 M6 厂仓（M5→M6 真实链路）。 */
function receiveArrival(s: Shipment) {
  const sku = store.receiveArrival(s.id);
  store.log("ok", sku
    ? `货柜 ${s.id} 已确认到港，开 GRN 收货单，${s.goods} 入 M6 厂仓待上架。`
    : `货柜 ${s.id} 已入仓，无需重复。`);
}
</script>

<template>
  <div class="t-view-anim">
    <!-- KPI 概览 -->
    <div class="t-grid t-g4">
      <TKpi
        :value="String(kpis.total)"
        label="在途货柜"
        acc="blue"
        :icon="ICONS.logistics"
      />
      <TKpi
        :value="String(kpis.arrived)"
        label="到港待清关"
        acc="amber"
        delta="联动 M4 报关"
        :icon="ICONS.customs"
      />
      <TKpi
        :value="String(kpis.demur)"
        label="滞期风险柜"
        :up="false"
        acc="red"
        delta="需优先跟催"
        :icon="ICONS.logistics"
      />
      <TKpi
        :value="kpis.avg + '%'"
        label="平均在途进度"
        acc="green"
        :icon="ICONS.warehouse"
      />
    </div>

    <!-- 到港 → 开 GRN 推 M6（真实动作） -->
    <div
      v-if="arrivedShip"
      class="t-note info arrive-note"
    >
      <span>
        <b>货柜 {{ arrivedShip.id }}（{{ arrivedShip.goods }}）已抵港</b>：确认到港即生成收货单 GRN，货物入
        <b>M6 厂仓</b>待上架与落地成本归集。
      </span>
      <button
        class="t-btn sm primary"
        :disabled="store.busy.value"
        @click="receiveArrival(arrivedShip)"
      >
        <TIcon
          :path="ICONS.warehouse"
          :size="13"
        />
        确认到港 · 开 GRN
      </button>
    </div>

    <TSection
      title="在途货柜 · 全程跟踪"
      sub="里程碑 · ETA P50/P90 · 滞期预警 · 到港开 GRN"
    >
      <template #actions>
        <button
          class="t-btn gold sm"
          :disabled="store.busy.value"
          title="解析货代 EDI 邮件，结果流式显示在右侧 Console（预览，不自动改数据）"
          @click="parseEdi"
        >
          <TIcon
            :path="ICONS.logistics"
            :size="14"
          />
          {{ store.busy.value ? "解析中…" : "解析货代 EDI 邮件（预览）" }}
        </button>
      </template>
    </TSection>

    <!-- 货柜清单表 -->
    <TPanel v-if="store.shipments.value.length">
      <table class="t-table">
        <thead>
          <tr>
            <th>货柜 / 提单</th>
            <th>商品</th>
            <th>路由</th>
            <th>ETA P50 / P90</th>
            <th>状态</th>
            <th>滞期</th>
            <th style="min-width: 130px">
              进度
            </th>
            <th />
          </tr>
        </thead>
        <tbody>
          <template
            v-for="s in store.shipments.value"
            :key="s.id"
          >
            <tr
              class="clk"
              @click="toggle(s.id)"
            >
              <td>
                <b>货柜 {{ s.id }}</b>
                <div
                  class="t-mono t-muted"
                  style="font-size: 11px"
                >
                  {{ s.bl }}
                </div>
              </td>
              <td>{{ s.goods }}</td>
              <td class="t-mono">
                {{ s.from }} → {{ s.to }}
              </td>
              <td class="t-mono">
                <b>{{ s.etaP50 }}</b>
                <span class="t-muted"> / {{ s.etaP90 }}</span>
              </td>
              <td>
                <TBadge :tone="statusTone(s.status)">
                  {{ s.status }}
                </TBadge>
              </td>
              <td>
                <TBadge :tone="demurTone(s.demurrage)">
                  {{ s.demurrage }}
                </TBadge>
              </td>
              <td>
                <div class="t-row">
                  <span
                    class="t-bar bar-pct"
                    :class="'d-' + demurTone(s.demurrage)"
                    style="flex: 1"
                  >
                    <span :style="{ width: s.pct + '%' }" />
                  </span>
                  <span
                    class="t-mono t-muted"
                    style="font-size: 11px; min-width: 32px; text-align: right"
                  >{{ s.pct }}%</span>
                </div>
              </td>
              <td style="text-align: right">
                <span
                  class="t-pill toggle-pill"
                  :class="{ open: openId === s.id }"
                >
                  {{ openId === s.id ? "收起 ▴" : "里程碑 ▾" }}
                </span>
              </td>
            </tr>

            <!-- 展开：竖向里程碑时间线 -->
            <tr
              v-if="openId === s.id"
              :key="s.id + '-tl'"
            >
              <td
                colspan="8"
                class="tl-cell"
              >
                <div class="tl-head">
                  <div
                    class="t-row"
                    style="gap: 10px"
                  >
                    <b>货柜 {{ s.id }} · 里程碑时间线</b>
                    <span
                      class="t-muted"
                      style="font-size: 11.5px"
                    >订舱 → 开船 → 在途 → 到港 → 清关 → 入仓</span>
                  </div>
                  <button
                    class="t-btn sm flag-btn"
                    @click.stop="flagAnomaly(s)"
                  >
                    <TIcon
                      :path="ICONS.compliance"
                      :size="13"
                    />
                    上报异常里程碑 · 进人工闸
                  </button>
                </div>

                <div class="timeline">
                  <div
                    v-for="(m, i) in s.milestones"
                    :key="i"
                    class="tl-item"
                    :class="msState(m)"
                  >
                    <span class="tl-dot" />
                    <div class="tl-body">
                      <div class="tl-t">
                        {{ m.t }}
                        <TBadge
                          v-if="m.now"
                          tone="amber"
                        >
                          进行中
                        </TBadge>
                      </div>
                      <div class="tl-at t-mono">
                        {{ m.at }}
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  class="t-note warn"
                  style="margin: 12px 0 2px"
                >
                  <b>说明：</b>异常里程碑（跳票 / 滞期 / 路由变更）经上报后进入<b>中央审核看板</b>（人工闸 · milestone-anomaly），运营确认后再回写货柜状态与 ETA。
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </TPanel>

    <!-- 空态 -->
    <TPanel
      v-if="!store.shipments.value.length"
      pad
    >
      <div class="empty">
        <TIcon
          :path="ICONS.logistics"
          :size="26"
        />
        <div>暂无在途货柜。订舱开船后货代 EDI 回传的里程碑将在此汇总跟踪。</div>
      </div>
    </TPanel>
  </div>
</template>

<style scoped>
/* 到港开 GRN 提示条：说明 + 动作按钮同排 */
.arrive-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.arrive-note button { flex-shrink: 0; }

/* 进度条：底色随滞期风险着色（沿用设计令牌） */
.bar-pct > span { transition: width 0.6s cubic-bezier(0.22, 0.7, 0.25, 1); }
.bar-pct.d-green > span { background: var(--ok); }
.bar-pct.d-amber > span { background: #d29628; }
.bar-pct.d-red > span { background: var(--vermilion); }

/* 展开胶囊：可点感 + 展开态高亮 */
.toggle-pill {
  transition: color 0.14s, border-color 0.14s, background 0.14s;
}
.clk:hover .toggle-pill {
  border-color: var(--primary);
  color: var(--primary-deep);
}
.toggle-pill.open {
  border-color: var(--gold);
  color: var(--gold);
  background: rgba(167, 140, 79, 0.1);
}

/* 展开行外壳 */
.tl-cell {
  background: var(--bg-soft);
  padding: 14px 18px 16px !important;
}
.tl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

/* 竖向时间线 */
.timeline {
  position: relative;
  padding-left: 6px;
}
.timeline::before {
  content: "";
  position: absolute;
  left: 11px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--border);
}
.tl-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 7px 0;
}
.tl-dot {
  position: relative;
  z-index: 1;
  flex: none;
  width: 12px;
  height: 12px;
  margin-top: 2px;
  border-radius: 999px;
  background: var(--panel);
  border: 2px solid var(--border-strong);
}
.tl-item.done .tl-dot {
  background: var(--ok);
  border-color: var(--ok);
}
.tl-item.now .tl-dot {
  background: var(--gold);
  border-color: var(--gold);
  box-shadow: 0 0 0 4px rgba(167, 140, 79, 0.22);
}
.tl-body { min-width: 0; }
.tl-t {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-2);
}
.tl-item.done .tl-t,
.tl-item.now .tl-t { color: var(--text); }
.tl-item.now .tl-t { font-weight: 750; }
.tl-item.todo .tl-t { color: var(--muted); }
.tl-at {
  font-size: 11px;
  color: var(--muted);
  margin-top: 2px;
}
.tl-item.now .tl-at { color: var(--text-2); }

/* 上报异常：升级动作，hover 转红以示告警 */
.flag-btn:hover {
  border-color: var(--vermilion);
  color: var(--vermilion);
  background: var(--vermilion-soft);
}

/* 空态 */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 30px 16px;
  color: var(--muted);
  text-align: center;
  font-size: 12.5px;
}
</style>
