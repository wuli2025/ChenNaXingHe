<script setup lang="ts">
import { CircleCheck, CircleAlert, Info, X } from "@lucide/vue";
import { useToastQueue, type ToastKind } from "../composables/useToast";

const { items, dismiss } = useToastQueue();

const icons: Record<ToastKind, any> = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
};
</script>

<template>
  <div
    class="toast-host"
    aria-live="polite"
  >
    <TransitionGroup name="toast">
      <div
        v-for="t in items"
        :key="t.id"
        class="toast"
        :class="t.kind"
      >
        <component
          :is="icons[t.kind]"
          :size="15"
          :stroke-width="2"
          class="t-ic"
        />
        <span class="t-text">{{ t.text }}</span>
        <button
          class="t-close"
          @click="dismiss(t.id)"
        >
          <X
            :size="12"
            :stroke-width="2.2"
          />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.toast {
  position: relative;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: min(560px, 80vw);
  padding: 9px 14px;
  border-radius: 14px;
  font-size: 12.5px;
  line-height: 1.5;
  /* 悬浮 chrome:磨砂玻璃 toast */
  background: var(--chrome-bg);
  backdrop-filter: var(--chrome-blur);
  -webkit-backdrop-filter: var(--chrome-blur);
  border: 1px solid var(--chrome-border);
  color: var(--text);
  box-shadow: var(--chrome-shadow);
}
/* 棱边折射环:跟随圆角的 1px 玻璃棱光 */
.toast::before {
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
.toast.success .t-ic {
  color: var(--ok, #3a9d6e);
}
.toast.error {
  border-color: rgba(192, 57, 43, 0.35);
}
.toast.error .t-ic {
  color: var(--vermilion);
}
.toast.info .t-ic {
  color: var(--primary);
}
.t-text {
  word-break: break-word;
}
.t-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--muted);
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
}
.t-close:hover {
  background: var(--bg-soft);
  color: var(--text);
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s var(--ease, ease), transform 0.18s var(--ease, ease);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
