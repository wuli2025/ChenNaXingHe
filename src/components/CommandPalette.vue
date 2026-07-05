<script setup lang="ts">
// Ctrl+K 命令面板:搜对话(全项目) + 快速切视图,键盘上下/Enter 直达。
import { ref, computed, watch, nextTick } from "vue";
import {
  BookOpen,
  Settings as SettingsIcon,
  Stethoscope,
  KeyRound,
  Puzzle,
  MessageSquare,
} from "@lucide/vue";
import SearchGlass from "./icons/SearchGlass.vue";
import { useAppStore } from "../stores/app";
import { paletteOpen } from "../composables/useHotkeys";

const app = useAppStore();
const query = ref("");
const active = ref(0);
const inputEl = ref<HTMLInputElement | null>(null);

watch(paletteOpen, (open) => {
  if (open) {
    query.value = "";
    active.value = 0;
    nextTick(() => inputEl.value?.focus());
  }
});

interface Action { id: string; label: string; icon: any; run: () => void }
const ACTIONS: Action[] = [
  { id: "m-chat", label: "打开对话", icon: MessageSquare, run: () => app.openChat() },
  { id: "m-kb", label: "知识库", icon: BookOpen, run: () => app.setModuleTab("kb") },
  { id: "m-skill", label: "技能中心", icon: Puzzle, run: () => app.setModuleTab("skill") },
  { id: "s-provider", label: "API 供应商", icon: KeyRound, run: () => app.openSettings("provider") },
  { id: "s-env", label: "环境配置", icon: Stethoscope, run: () => app.openSettings("env") },
  { id: "s-general", label: "设置", icon: SettingsIcon, run: () => app.openSettings("general") },
];

interface Item {
  kind: "conv" | "view";
  id: string;
  label: string;
  sub?: string;
  icon: any;
  run: () => void;
}

const items = computed<Item[]>(() => {
  const q = query.value.trim().toLowerCase();
  // 仅功能 / 模块跳转（对话已移除，不再搜索会话）
  return ACTIONS.filter((v) => !q || v.label.toLowerCase().includes(q)).map(
    (v): Item => ({
      kind: "view",
      id: v.id,
      label: v.label,
      icon: v.icon,
      run: v.run,
    })
  );
});

watch(items, () => {
  if (active.value >= items.value.length) active.value = 0;
});

function close() {
  paletteOpen.value = false;
}
function pick(it: Item) {
  it.run();
  close();
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    active.value = Math.min(active.value + 1, items.value.length - 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    active.value = Math.max(active.value - 1, 0);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const it = items.value[active.value];
    if (it) pick(it);
  }
}
</script>

<template>
  <div v-if="paletteOpen" class="cp-overlay" @click.self="close">
    <div class="cp" role="dialog" aria-label="命令面板">
      <div class="cp-search">
        <SearchGlass :size="15" :stroke-width="1.8" />
        <input
          ref="inputEl"
          v-model="query"
          placeholder="搜对话,或输入功能名跳转…"
          @keydown="onKeydown"
        />
        <kbd>Esc</kbd>
      </div>
      <div class="cp-list">
        <button
          v-for="(it, i) in items"
          :key="it.kind + it.id"
          class="cp-item"
          :class="{ active: i === active }"
          @mouseenter="active = i"
          @click="pick(it)"
        >
          <component :is="it.icon" :size="14" :stroke-width="1.7" class="cp-ic" />
          <span class="cp-label">{{ it.label }}</span>
          <span v-if="it.sub" class="cp-sub">{{ it.sub }}</span>
          <span class="cp-kind">{{ it.kind === "conv" ? "对话" : "功能" }}</span>
        </button>
        <div v-if="!items.length" class="cp-empty">没有匹配项</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cp-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: var(--overlay, rgba(20, 20, 24, 0.35));
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 14vh;
}
.cp {
  width: min(560px, 90vw);
  max-height: 56vh;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: cp-pop 140ms ease;
}
@keyframes cp-pop {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
}
.cp-search {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--border-soft);
  color: var(--muted);
}
.cp-search input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: var(--text);
}
.cp-search kbd {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--dim);
  border: 1px solid var(--border-soft);
  border-radius: 4px;
  padding: 1px 5px;
}
.cp-list {
  overflow-y: auto;
  padding: 6px;
}
.cp-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 11px;
  border: none;
  background: transparent;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
}
.cp-item.active {
  background: var(--primary-soft);
  color: var(--text);
}
.cp-ic {
  color: var(--primary);
  flex-shrink: 0;
}
.cp-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp-sub {
  font-size: 11px;
  color: var(--dim);
  flex-shrink: 0;
}
.cp-kind {
  font-size: 10px;
  color: var(--dim);
  border: 1px solid var(--border-soft);
  border-radius: 4px;
  padding: 1px 5px;
  flex-shrink: 0;
}
.cp-empty {
  padding: 22px;
  text-align: center;
  color: var(--muted);
  font-size: 12.5px;
}
</style>
