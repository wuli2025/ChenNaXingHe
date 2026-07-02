<script setup lang="ts">
/**
 * SettingsHub —— 「设置 / 更多」overlay。把保留但非主干的能力都收进来：
 * 通用设置(主题/API 联动) · 知识库 · 经验中心 · 技能中心 · 自动化 · 语音/TTS · 环境配置 · 更新。
 */
import { computed, defineAsyncComponent } from "vue";
import { X } from "@lucide/vue";
import { useAppStore } from "../stores/app";

// 精简后的「设置 / 更多」：只保留高频、轻量、稳定的能力，去掉会拖慢/卡顿的重模块
// （知识图谱 / 经验中心 / 技能中心 / 自动化 / 语音 TTS 已移除）。
// 知识库已移出「更多」：它在顶栏有独立整屏 tab，在此 overlay 里再挂一份会重复加载
// 整个 PolarisKB（几十篇 md + 双链溯源），导致点「更多」卡死/崩溃，故此处不再挂载。
const ProviderDock = defineAsyncComponent(() => import("./ProviderDock.vue"));
const Settings = defineAsyncComponent(() => import("./Settings.vue"));
const EnvDoctor = defineAsyncComponent(() => import("./EnvDoctor.vue"));
const UpdatePanel = defineAsyncComponent(() => import("./UpdatePanel.vue"));

const app = useAppStore();

const sections = [
  { key: "provider", label: "API 供应商" },
  { key: "general", label: "通用设置" },
  { key: "env", label: "环境配置" },
  { key: "update", label: "检查更新" },
];

const active = computed(() =>
  sections.some((s) => s.key === app.settingsSection) ? app.settingsSection : "provider"
);
</script>

<template>
  <div class="hub-mask" @click.self="app.closeSettings()">
    <div class="hub">
      <header class="hub-top">
        <span class="hub-title">设置 / 更多</span>
        <button class="hub-x" @click="app.closeSettings()"><X :size="18" /></button>
      </header>
      <div class="hub-body">
        <nav class="hub-nav">
          <button
            v-for="s in sections"
            :key="s.key"
            class="nav-item"
            :class="{ on: active === s.key }"
            @click="app.settingsSection = s.key"
          >
            {{ s.label }}
          </button>
        </nav>
        <div class="hub-pane">
          <div v-if="active === 'provider'" class="provider-pane">
            <ProviderDock />
          </div>
          <Settings v-else-if="active === 'general'" />
          <EnvDoctor v-else-if="active === 'env'" />
          <UpdatePanel v-else-if="active === 'update'" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hub-mask {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
}
.hub {
  width: min(1160px, 96vw);
  height: min(820px, 92vh);
  background: var(--bg-chat);
  border: 1px solid var(--hairline);
  border-radius: 16px;
  box-shadow: var(--shadow-lg, 0 20px 60px rgba(0, 0, 0, 0.35));
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.hub-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--hairline);
  flex: 0 0 auto;
}
.hub-title {
  font-size: 14px;
  color: var(--text);
  font-family: var(--serif, inherit);
  letter-spacing: 1px;
}
.hub-x {
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 7px;
}
.hub-x:hover {
  background: var(--primary-soft, rgba(120, 120, 160, 0.12));
  color: var(--text);
}
.hub-body {
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
}
.hub-nav {
  width: 168px;
  flex: 0 0 auto;
  border-right: 1px solid var(--hairline);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: var(--bg-side);
  overflow-y: auto;
}
.nav-item {
  text-align: left;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  padding: 8px 11px;
  border-radius: 9px;
  cursor: pointer;
}
.nav-item:hover {
  background: var(--primary-soft, rgba(120, 120, 160, 0.1));
  color: var(--text);
}
.nav-item.on {
  background: var(--primary);
  color: #fff;
}
.hub-pane {
  flex: 1 1 auto;
  min-width: 0;
  overflow: auto;
  position: relative;
}
.provider-pane {
  padding: 16px;
  max-width: 460px;
}
</style>
