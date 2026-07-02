<script setup lang="ts">
import { computed } from "vue";
/** 迷你趋势线（SVG sparkline）。 */
const props = defineProps<{ series: number[]; tone?: "gold" | "blue" | "green"; height?: number }>();

const path = computed(() => {
  const s = props.series;
  if (!s || s.length < 2) return { line: "", area: "", w: 100, h: props.height || 40 };
  const w = 100, h = props.height || 40, pad = 3;
  const min = Math.min(...s), max = Math.max(...s);
  const span = max - min || 1;
  const pts = s.map((v, i) => {
    const x = (i / (s.length - 1)) * (w - pad * 2) + pad;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y];
  });
  const line = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const area = `${line} L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h} Z`;
  return { line, area, w, h };
});
const color = computed(() => (props.tone === "blue" ? "var(--primary)" : props.tone === "green" ? "var(--ok)" : "var(--gold)"));
</script>

<template>
  <svg class="t-spark" :viewBox="`0 0 ${path.w} ${path.h}`" preserveAspectRatio="none">
    <path :d="path.area" :fill="color" opacity="0.1" />
    <path :d="path.line" :stroke="color" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>

<style scoped>
.t-spark { width: 100%; height: 44px; display: block; }
</style>
