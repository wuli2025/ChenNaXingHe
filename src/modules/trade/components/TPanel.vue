<script setup lang="ts">
/** 通用带边框面板容器（卡片/表格外壳）。 */
defineProps<{ pad?: boolean }>();
</script>

<template>
  <div
    class="t-panel"
    :class="{ pad }"
  >
    <slot />
  </div>
</template>

<style scoped>
.t-panel {
  /* Liquid Glass 卡片：渐变玻璃底 + 白玻璃描边 + 镜面高光（token 见 style.css v8） */
  position: relative;
  background: var(--card-bg, var(--panel));
  border: 1px solid var(--card-border, var(--border-soft));
  border-radius: 16px;
  overflow: hidden;
  box-shadow: var(--card-shadow, var(--shadow));
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}
/* v9 玻璃棱边折射环：左上棱亮、右下棱次亮的 1px 光边，跟随圆角 */
.t-panel::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: var(--edge-refract);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  pointer-events: none;
  z-index: 3;
}
.t-panel:hover {
  box-shadow: var(--card-shadow-hover, var(--shadow-lg));
}
.t-panel.pad { padding: 16px 18px; }
</style>
