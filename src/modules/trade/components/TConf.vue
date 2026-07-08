<script setup lang="ts">
import { computed } from "vue";
/** 字段级置信度条（0-100）。<60 红、<85 琥珀、≥85 绿。 */
const props = defineProps<{ value: number; label?: string }>();
const tone = computed(() => (props.value < 60 ? "low" : props.value < 85 ? "mid" : "hi"));
</script>

<template>
  <div
    class="t-conf"
    :title="`置信度 ${value}%`"
  >
    <span
      v-if="label"
      class="cf-l"
    >{{ label }}</span>
    <span class="cf-bar"><span
      class="cf-fill"
      :class="tone"
      :style="{ width: Math.max(0, Math.min(100, value)) + '%' }"
    /></span>
    <span
      class="cf-v"
      :class="tone"
    >{{ value }}%</span>
  </div>
</template>

<style scoped>
.t-conf {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
}
.cf-l { color: var(--muted); min-width: 52px; }
.cf-bar {
  flex: 1;
  height: 5px;
  min-width: 40px;
  border-radius: 3px;
  background: var(--bg-soft);
  overflow: hidden;
}
.cf-fill { display: block; height: 100%; border-radius: 3px; transition: width 0.5s cubic-bezier(0.22, 0.7, 0.25, 1); }
.cf-fill.hi { background: var(--ok); }
.cf-fill.mid { background: #d29628; }
.cf-fill.low { background: var(--vermilion); }
.cf-v { font-variant-numeric: tabular-nums; font-weight: 700; }
.cf-v.hi { color: var(--ok); }
.cf-v.mid { color: #b7791f; }
.cf-v.low { color: var(--vermilion); }
</style>
