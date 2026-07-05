<script setup lang="ts">
/**
 * TopNav —— 新外壳顶部条：品牌 + 「选项」下拉(快捷入口) + 模块 tab 切换 + 供应商 + 设置/更多。
 * 「最上面用来切换」：外贸 OS / 知识库 / 技能中心；其余能力进「选项」下拉或「更多」。
 * 环境配置(env) 只在右侧「更多」里，不再单独露出。
 */
import { Settings2, MessageSquare, BookOpen, Puzzle } from "@lucide/vue";
import { useAppStore, type ModuleTab } from "../stores/app";

const app = useAppStore();

// 顶栏 tab:外贸 OS / 知识库 / 技能中心。
const tabs: { key: ModuleTab; label: string; hint: string }[] = [
  { key: "trade", label: "外贸 OS", hint: "北极星外贸 OS · 全链路工作台" },
  { key: "kb", label: "知识库", hint: "PolarisKB 资料库浏览 / 双链溯源" },
  { key: "skill", label: "技能中心", hint: "技能市场 / 我的技能" },
];

const tabIcon: Partial<Record<ModuleTab, typeof BookOpen>> = {
  kb: BookOpen,
  skill: Puzzle,
};
</script>

<template>
  <header class="topnav">
    <nav class="tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab"
        :class="{ on: app.moduleTab === t.key }"
        :title="t.hint"
        @click="app.setModuleTab(t.key)"
      >
        <component v-if="tabIcon[t.key]" :is="tabIcon[t.key]" :size="15" :stroke-width="1.8" />
        {{ t.label }}
      </button>
    </nav>

    <div class="right">
      <button
        class="chat-toggle"
        :class="{ on: app.chatOpen }"
        title="对话系统：右侧抽屉，可拖宽 / 收起"
        @click="app.toggleChat()"
      >
        <MessageSquare :size="16" :stroke-width="1.8" />
        <span>对话</span>
      </button>
      <button class="more" title="设置 / 更多（含环境配置）" @click="app.openSettings()">
        <Settings2 :size="17" />
        <span>更多</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.topnav {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 48px;
  padding: 0 12px 0 14px;
  /* 磨砂玻璃顶栏：半透明 + 背景模糊，透出下方环境光 → 苹果琉璃质感 */
  background: var(--glass-side, var(--bg-side));
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-bottom: 1px solid var(--hairline);
  box-shadow: var(--glass-hi);
  flex: 0 0 auto;
  position: relative;
  z-index: 2;
  -webkit-app-region: drag;
}
.topnav button,
.topnav :deep(*) {
  -webkit-app-region: no-drag;
}
.brand {
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: var(--serif, inherit);
  white-space: nowrap;
}
.brand-ico {
  color: var(--primary);
}
.brand-name {
  font-size: 15px;
  letter-spacing: 1px;
  color: var(--text);
}
.brand-name b {
  color: var(--primary);
  font-weight: 700;
}
/* 「选项」下拉 */
.opts {
  position: relative;
  flex: 0 0 auto;
}
.opts-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid var(--hairline);
  background: var(--panel, transparent);
  color: var(--muted);
  font-size: 12.5px;
  padding: 5px 9px 5px 11px;
  border-radius: 9px;
  cursor: pointer;
  transition: background 0.14s, color 0.14s, border-color 0.14s;
}
.opts-btn:hover,
.opts-btn.on {
  color: var(--text);
  background: var(--primary-soft, rgba(120, 120, 160, 0.1));
}
.opts-caret {
  transition: transform 0.16s;
}
.opts-caret.flip {
  transform: rotate(180deg);
}
.opts-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}
.opts-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 41;
  min-width: 164px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--glass-bg, var(--bg-chat));
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--hairline);
  border-radius: 13px;
  box-shadow: var(--shadow-lg, 0 12px 36px rgba(0, 0, 0, 0.28)), var(--glass-hi);
}
.opts-item {
  display: flex;
  align-items: center;
  gap: 9px;
  text-align: left;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.opts-item:hover {
  background: var(--primary-soft, rgba(120, 120, 160, 0.1));
}
.oi {
  color: var(--primary);
  flex: 0 0 auto;
}
.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  font-size: 13.5px;
  padding: 6px 14px;
  border-radius: 9px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.14s, color 0.14s, border-color 0.14s;
}
.tab:hover {
  background: var(--primary-soft, rgba(120, 120, 160, 0.1));
  color: var(--text);
}
.tab.on {
  background: linear-gradient(160deg, var(--primary), var(--primary-deep));
  color: #fff;
  border-color: transparent;
  box-shadow: 0 2px 8px -2px rgba(28, 48, 69, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
}
.right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.chat-toggle,
.more {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--hairline);
  background: var(--panel, transparent);
  color: var(--muted);
  font-size: 12.5px;
  padding: 5px 10px;
  border-radius: 9px;
  cursor: pointer;
  transition: background 0.14s, color 0.14s, border-color 0.14s;
}
.chat-toggle:hover,
.more:hover {
  color: var(--text);
  background: var(--primary-soft, rgba(120, 120, 160, 0.1));
}
/* 对话抽屉展开时,按钮高亮成主色,提示当前正开着 */
.chat-toggle.on {
  color: #fff;
  background: linear-gradient(160deg, var(--primary), var(--primary-deep));
  border-color: transparent;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
}
</style>
