<script setup lang="ts">
/** 通用带边框面板容器（卡片/表格外壳）。 */
defineProps<{ pad?: boolean }>();
</script>

<template>
  <div class="t-panel" :class="{ pad }"><slot /></div>
</template>

<style scoped>
.t-panel {
  background: var(--panel);
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--shadow), var(--glass-hi);
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}
.t-panel:hover {
  box-shadow: var(--shadow-lg), var(--glass-hi);
}
.t-panel.pad { padding: 16px 18px; }
</style>
