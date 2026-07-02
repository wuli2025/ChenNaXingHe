<script setup lang="ts">
/** 状态徽标。tone 决定配色。 */
defineProps<{ tone?: "gold" | "blue" | "green" | "amber" | "red" | "purple" | "gray" }>();
</script>

<template>
  <span class="t-badge" :class="`t-${tone || 'gray'}`"><slot /></span>
</template>

<style scoped>
.t-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
  line-height: 1.5;
}
.t-gold { background: rgba(167, 140, 79, 0.15); color: var(--gold); }
.t-blue { background: var(--primary-soft); color: var(--primary-deep); }
.t-green { background: var(--ok-soft); color: var(--ok); }
.t-amber { background: rgba(210, 150, 40, 0.14); color: #b7791f; }
.t-red { background: var(--vermilion-soft); color: var(--vermilion); }
.t-purple { background: rgba(130, 90, 200, 0.13); color: #7c3aed; }
.t-gray { background: var(--bg-soft); color: var(--muted); }
:global(.dark) .t-amber { color: #e0b45a; }
:global(.dark) .t-purple { color: #b094f5; }
</style>
