<script setup lang="ts">
/** 区块标题：左标题+副标题，右侧 actions 插槽。 */
defineProps<{ title: string; sub?: string }>();
</script>

<template>
  <div class="t-sec">
    <div class="t-sec-l">
      <h3>{{ title }}</h3>
      <span v-if="sub" class="sub">{{ sub }}</span>
    </div>
    <div class="t-sec-r"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.t-sec {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin: 22px 0 10px;
}
.t-sec-l {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.t-sec h3 {
  font-size: 14.5px;
  font-weight: 750;
  color: var(--text);
}
.t-sec .sub {
  font-size: 11.5px;
  color: var(--muted);
}
.t-sec-r {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
