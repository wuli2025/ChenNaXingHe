<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import TIcon from "./TIcon.vue";
/** KPI 卡：数值 + 标签 + 变化 + 强调色 + 可选图标；数值入场计数动画。 */
const props = defineProps<{
  value: string;
  label: string;
  delta?: string;
  up?: boolean;
  acc?: "gold" | "blue" | "green" | "amber" | "red" | "purple";
  icon?: string;
}>();

const shown = ref(props.value);
function animateTo() {
  const m = props.value.match(/^(\$?)([\d.]+)(.*)$/);
  if (!m) {
    // 非数值型（无法计数动画）：直接反映最新值，保证 mount 后 props 更新也能刷新。
    shown.value = props.value;
    return;
  }
  const pre = m[1], target = parseFloat(m[2]), suf = m[3];
  if (isNaN(target)) {
    shown.value = props.value;
    return;
  }
  const dur = 620, start = performance.now();
  const isInt = target % 1 === 0;
  function tick(now: number) {
    const p = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    const val = target * e;
    shown.value = pre + (isInt ? Math.round(val).toString() : val.toFixed(2)) + suf;
    if (p < 1) requestAnimationFrame(tick);
    else shown.value = props.value;
  }
  requestAnimationFrame(tick);
}
onMounted(animateTo);
// props.value 在 mount 后变化时（如 KPI 数据刷新）重新计数动画到新值，否则卡片永远停在首帧。
watch(() => props.value, animateTo);
</script>

<template>
  <div class="t-kpi" :class="`acc-${acc || 'gold'}`">
    <div class="k-top">
      <span class="k-val">{{ shown }}</span>
      <span v-if="icon" class="k-ico"><TIcon :path="icon" :size="16" /></span>
    </div>
    <div class="k-lbl">{{ label }}</div>
    <div v-if="delta" class="k-delta" :class="{ up: up, down: up === false }">{{ delta }}</div>
  </div>
</template>

<style scoped>
.t-kpi {
  background: var(--panel);
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  padding: 14px 16px;
  position: relative;
  overflow: hidden;
  box-shadow: var(--shadow), var(--glass-hi);
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}
.t-kpi:hover {
  box-shadow: var(--shadow-lg), var(--glass-hi);
  transform: translateY(-2px);
}
.t-kpi::before {
  content: "";
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--gold);
}
.acc-gold::before { background: var(--gold); }
.acc-blue::before { background: var(--primary); }
.acc-green::before { background: var(--ok); }
.acc-amber::before { background: #d29628; }
.acc-red::before { background: var(--vermilion); }
.acc-purple::before { background: #7c3aed; }
.k-top { display: flex; align-items: center; justify-content: space-between; }
.k-val {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.5px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.k-ico { color: var(--muted); opacity: 0.7; }
.k-lbl { font-size: 11.5px; color: var(--muted); margin-top: 3px; }
.k-delta { font-size: 11px; margin-top: 5px; color: var(--muted); font-weight: 600; }
.k-delta.up { color: var(--ok); }
.k-delta.down { color: var(--vermilion); }
</style>
