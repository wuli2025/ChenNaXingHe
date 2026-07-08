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
  <div
    class="t-kpi"
    :class="`acc-${acc || 'gold'}`"
  >
    <div class="k-top">
      <span class="k-val">{{ shown }}</span>
      <span
        v-if="icon"
        class="k-ico"
      ><TIcon
        :path="icon"
        :size="16"
      /></span>
    </div>
    <div class="k-lbl">
      {{ label }}
    </div>
    <div
      v-if="delta"
      class="k-delta"
      :class="{ up: up, down: up === false }"
    >
      {{ delta }}
    </div>
  </div>
</template>

<style scoped>
.t-kpi {
  background: var(--card-bg, var(--panel));
  border: 1px solid var(--card-border, var(--border-soft));
  border-radius: 16px;
  padding: 14px 16px;
  position: relative;
  overflow: hidden;
  box-shadow: var(--card-shadow, var(--shadow));
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}
.t-kpi:hover {
  box-shadow: var(--card-shadow-hover, var(--shadow-lg));
  transform: translateY(-2px);
}
/* v9 掠光：hover 时一道细流光从左掠到右，像光滑玻璃面转了个角度 */
.t-kpi::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--sheen);
  background-size: 260% 100%;
  background-position: 120% 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s var(--ease, ease);
}
.t-kpi:hover::after {
  opacity: 1;
  background-position: -120% 0;
  transition: opacity 0.2s var(--ease, ease), background-position 0.9s var(--ease, ease);
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
/* v9 墨色渐变数字：上实下淡，像墨在玻璃上晕开。
   透明填充必须和渐变绑在同一 @supports 里，否则老内核下文字会整个隐形 */
@supports (color: color-mix(in srgb, red 50%, transparent)) {
  .k-val {
    background: linear-gradient(180deg, var(--text), color-mix(in srgb, var(--text) 66%, transparent));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
}
.k-ico { color: var(--muted); opacity: 0.7; }
.k-lbl { font-size: 11.5px; color: var(--muted); margin-top: 3px; }
.k-delta { font-size: 11px; margin-top: 5px; color: var(--muted); font-weight: 600; }
.k-delta.up { color: var(--ok); }
.k-delta.down { color: var(--vermilion); }
</style>
