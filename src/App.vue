<script setup lang="ts">
import {
  computed,
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
  defineAsyncComponent,
} from "vue";
// ── 常驻 / 首屏关键：静态导入 ──
import SideNav from "./components/SideNav.vue";
import SplashScreen from "./components/SplashScreen.vue";
import Onboarding from "./components/Onboarding.vue";
import EnvDoctor from "./components/EnvDoctor.vue"; // 既是设置项也是启动 env 网关，留静态
import UpdateBanner from "./components/UpdateBanner.vue";
import ToastHost from "./components/ToastHost.vue";
import VoiceOverlay from "./components/VoiceOverlay.vue";
import CommandPalette from "./components/CommandPalette.vue";
import { useHotkeys } from "./composables/useHotkeys";
import { installMarkdownDelegation } from "./lib/markdown";
import { openUrl, onWsStatus, isTauri } from "./tauri";
// ── 重 / 非首屏：懒加载 ──
const SettingsHub = defineAsyncComponent(() => import("./components/SettingsHub.vue"));
const AddProviderModal = defineAsyncComponent(() => import("./components/AddProviderModal.vue"));
const WorkflowPackModal = defineAsyncComponent(() => import("./components/WorkflowPackModal.vue"));
const AutomationModal = defineAsyncComponent(() => import("./components/AutomationModal.vue"));
const UsageBoard = defineAsyncComponent(() => import("./components/UsageBoard.vue"));
// 主区 tab 组件(知识库 / 技能中心)与右侧对话抽屉 —— 首次切到/展开才挂载
const WikiBrowse = defineAsyncComponent(() => import("./components/WikiBrowse.vue"));
const SkillCenter = defineAsyncComponent(() => import("./components/SkillCenter.vue"));
const ChatPanel = defineAsyncComponent(() => import("./components/ChatPanel.vue"));
// 外贸 OS 原生桌面模块（src/modules/trade），直连后端官方 Claude Code。
// 首次切到才挂载（懒加载 12 模块），之后 v-show 保活。
const TradeModule = defineAsyncComponent(() => import("./modules/trade/TradeModule.vue"));
// 星河无头ERP（src/modules/erp）：AI 一人公司操作系统，10 模块 + 审批中心，同为原生模块。
const ErpModule = defineAsyncComponent(() => import("./modules/erp/ErpModule.vue"));

import { checkForUpdate } from "./composables/useUpdater";
import { useAgentRunner } from "./composables/useAgentRunner";
import { useAppStore } from "./stores/app";
import { useProvidersStore } from "./stores/providers";
import { useChatStore } from "./stores/chat";
import { useWorkflowsStore } from "./stores/workflows";
import { useAutomationStore } from "./stores/automation";

const app = useAppStore();
const providers = useProvidersStore();
const chatStore = useChatStore();
const workflows = useWorkflowsStore();
const automation = useAutomationStore();

// 主区 tab 首次切到才挂载，之后 v-show 保活——切回瞬时、不丢页内状态。
const visited = ref<Record<string, boolean>>({ [app.moduleTab]: true });
watch(
  () => app.moduleTab,
  (t) => {
    if (t && !visited.value[t]) visited.value = { ...visited.value, [t]: true };
  }
);

// ─────────── 右侧对话抽屉 ───────────
// 首次展开后用 v-show 保活,避免来回收起/展开重建 ChatPanel、丢输入/滚动位置。
const chatEverOpened = ref(false);
watch(
  () => app.chatOpen,
  (open) => {
    if (open) chatEverOpened.value = true;
  },
  { immediate: true }
);
// 拖左缘改抽屉宽度:拖拽中每帧只更新内存值,松手落盘。
let dockDragging = false;
let dockRight = 0;
function startDockResize(e: MouseEvent) {
  e.preventDefault();
  const dock = (e.currentTarget as HTMLElement).closest(".chat-dock");
  dockRight = dock ? dock.getBoundingClientRect().right : window.innerWidth;
  dockDragging = true;
  document.body.style.userSelect = "none";
  document.body.style.cursor = "col-resize";
  window.addEventListener("mousemove", onDockResize);
  window.addEventListener("mouseup", endDockResize);
}
function onDockResize(e: MouseEvent) {
  if (!dockDragging) return;
  app.setChatDockWidth(dockRight - e.clientX, false);
}
function endDockResize() {
  if (!dockDragging) return;
  dockDragging = false;
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
  app.setChatDockWidth(app.chatDockWidth, true);
  window.removeEventListener("mousemove", onDockResize);
  window.removeEventListener("mouseup", endDockResize);
}

// ─────────── 应用级生命周期 ───────────
let unMdDelegate: (() => void) | null = null;
let unWsStatus: (() => void) | null = null;
let trimTimer: number | undefined;
onMounted(() => {
  chatStore.init();
  // markdown 区域事件委托(代码复制/展开/外链系统浏览器打开)
  unMdDelegate = installMarkdownDelegation(document, (url) => {
    openUrl(url).catch(() => {});
  });
  // Docker/Web 模式断线提示
  if (!isTauri) unWsStatus = onWsStatus((ok) => (wsDown.value = !ok));
  // 外贸 OS iframe ↔ Claude Code 桥
  window.addEventListener("message", onTradeBridge);
  document.addEventListener("visibilitychange", onVisibilityTrim);
  trimTimer = window.setInterval(() => {
    try {
      chatStore.trimMemory?.();
    } catch {
      /* 收回失败不影响运行 */
    }
  }, 5 * 60 * 1000);
});
function onVisibilityTrim() {
  if (document.visibilityState === "hidden") chatStore.trimMemory();
}
onBeforeUnmount(() => {
  unMdDelegate?.();
  unWsStatus?.();
  window.removeEventListener("message", onTradeBridge);
  if (trimTimer !== undefined) clearInterval(trimTimer);
  window.removeEventListener("mousemove", onAuroraPointer);
  document.removeEventListener("visibilitychange", onVisibilityTrim);
  window.removeEventListener("mousemove", onDockResize);
  window.removeEventListener("mouseup", endDockResize);
  if (edgeRaf) cancelAnimationFrame(edgeRaf);
});

// ─────────── 极光主题：彩虹边框高光跟随鼠标 ───────────
let mainEl: HTMLElement | null = null;
let edgeRaf = 0;
let edgePx = 0;
let edgePy = 0;
function flushEdge() {
  edgeRaf = 0;
  mainEl ||= document.querySelector(".content");
  if (!mainEl) return;
  const r = mainEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const deg = (Math.atan2(edgePy - cy, edgePx - cx) * 180) / Math.PI + 90;
  mainEl.style.setProperty("--edge-angle", `${deg.toFixed(1)}deg`);
}
function onAuroraPointer(e: MouseEvent) {
  edgePx = e.clientX;
  edgePy = e.clientY;
  if (!edgeRaf) edgeRaf = requestAnimationFrame(flushEdge);
}
const isAurora = computed(
  () => app.theme === "aurora-light" || app.theme === "aurora-dark"
);
watch(
  isAurora,
  (on) => {
    if (on) {
      window.addEventListener("mousemove", onAuroraPointer, { passive: true });
    } else {
      window.removeEventListener("mousemove", onAuroraPointer);
      if (edgeRaf) {
        cancelAnimationFrame(edgeRaf);
        edgeRaf = 0;
      }
    }
  },
  { immediate: true }
);

// ─────────── 外贸 OS iframe ↔ Claude Code 桥 ───────────
// 外贸 OS 工具跑在沙箱 iframe 里，够不到 Tauri 后端。这里用 postMessage 把它的
// 对话请求路由到 useAgentRunner.run()（= 唯一业务大脑 Claude Code，chat.rs spawn
// claude CLI，stream-json）。仅在 Tauri 桌面端（有真后端）握手成功；浏览器预览下
// 收不到 ready，工具自动回落本地演示引擎。每个 reqId 一次独立 run，流式回传 delta/tool。
const tradeRunner = useAgentRunner();
function onTradeBridge(e: MessageEvent) {
  // 安全:桥能驱动 Claude Code(有文件系统访问)。外贸 OS 工具页(tools/trade-os.html)与本应用
  // 同源(相对路径加载),因此只接受同源消息;任何跨源 frame/脚本一律早退拒绝。
  if (e.origin !== window.location.origin) return;
  const d = e.data;
  if (!d || d.__tradeos !== true) return;
  const win = e.source as Window | null;
  // 回复只投给发消息的窗口、且限定同源 targetOrigin(不再广播 "*"),避免结果外泄。
  const reply = (m: Record<string, unknown>) =>
    win?.postMessage({ __tradeos: true, ...m }, window.location.origin);
  if (d.type === "hello") {
    if (isTauri) reply({ type: "ready" }); // 只有真后端才接管；否则让工具用本地演示
    return;
  }
  if (d.type === "run" && typeof d.prompt === "string") {
    if (!isTauri) {
      reply({ type: "error", reqId: d.reqId, message: "no-backend" });
      return;
    }
    tradeRunner
      .run({
        prompt: d.prompt,
        useKb: !!d.useKb,
        onDelta: (_t, full) => reply({ type: "delta", reqId: d.reqId, full }),
        onTool: (tool, detail) => reply({ type: "tool", reqId: d.reqId, tool, detail }),
      })
      .then((r) => reply({ type: "done", reqId: d.reqId, full: r.raw }))
      .catch((err) =>
        reply({ type: "error", reqId: d.reqId, message: String(err?.message || err) })
      );
  }
}

// 全局快捷键
useHotkeys();

const wsDown = ref(false);

// 启动流程：splash → onboarding(仅首次) → env(健康则无感放行) → ready
const ONBOARDED_KEY = "polaris.onboarded.v1";
const phase = ref<"splash" | "onboarding" | "env" | "ready">("splash");

function onSplashDone() {
  const done = localStorage.getItem(ONBOARDED_KEY);
  phase.value = done ? "env" : "onboarding";
}
function onOnboardingDone() {
  phase.value = "env";
}
function onEnvDone() {
  phase.value = "ready";
  checkForUpdate();
}
</script>

<template>
  <div
    class="shell"
    :style="{ gridTemplateColumns: app.sidebarWidth + 'px 1fr' }"
  >
    <!-- 极光琉璃画框主题 -->
    <template v-if="app.theme === 'aurora-light' || app.theme === 'aurora-dark'">
      <div
        class="aurora"
        aria-hidden="true"
      >
        <span class="a1" /><span class="a2" /><span class="a3" /><span class="a4" /><span class="a5" />
      </div>
      <div
        class="grain"
        aria-hidden="true"
      />
    </template>

    <SideNav />

    <main class="content">
      <!-- 主区舞台：外贸 OS / 知识库 / 技能中心，随顶栏 tab 整屏切换 -->
      <div class="stage">
        <div
          v-if="app.moduleTab === 'kb'"
          class="view"
        >
          <WikiBrowse />
        </div>
        <div
          v-else-if="app.moduleTab === 'skill'"
          class="view"
        >
          <SkillCenter />
        </div>
        <!-- 外贸 OS：原生桌面模块（12 模块 + 人工审核看板），首次切到才挂载、之后 v-show 保活 -->
        <div
          v-if="visited['trade']"
          v-show="app.moduleTab === 'trade'"
          class="view"
        >
          <TradeModule />
        </div>
        <!-- 星河无头ERP：AI 一人公司操作系统（10 模块 + 审批中心），同样首挂载后保活 -->
        <div
          v-if="visited['erp']"
          v-show="app.moduleTab === 'erp'"
          class="view"
        >
          <ErpModule />
        </div>
      </div>

      <!-- 右侧对话抽屉：可拖宽、可收起，与主区并列；统管对话 / 策略 / 表格 / 知识库 -->
      <Transition name="dock-slide">
        <aside
          v-show="app.chatOpen && !app.isNativeTab"
          class="chat-dock"
          :style="{ width: app.chatDockWidth + 'px' }"
        >
          <div
            class="dock-resize"
            title="拖拽调节对话栏宽度"
            @mousedown="startDockResize"
          />
          <!-- 首次展开才挂载,之后随抽屉收起仍保活(不丢输入/滚动) -->
          <ChatPanel v-if="chatEverOpened" />
        </aside>
      </Transition>
    </main>

    <!-- 自动更新提示条 -->
    <UpdateBanner />

    <!-- 全局 toast + 语音浮层 + 命令面板 -->
    <ToastHost />
    <VoiceOverlay />
    <CommandPalette />

    <!-- Docker/Web 模式断线提示 -->
    <div
      v-if="wsDown"
      class="ws-down"
    >
      连接已断开,正在自动重连…
    </div>

    <!-- 设置 / 更多 overlay -->
    <SettingsHub v-if="app.settingsOpen" />

    <!-- 共享弹层（供 ChatPanel / 自动化 / 供应商使用） -->
    <AddProviderModal v-if="providers.showAddModal" />
    <WorkflowPackModal v-if="workflows.editorOpen" />
    <AutomationModal v-if="automation.editorOpen" />
    <UsageBoard v-if="providers.showUsageBoard" />

    <!-- 启动流程覆盖层 -->
    <Transition name="splash-fade">
      <SplashScreen
        v-if="phase === 'splash'"
        @done="onSplashDone"
      />
    </Transition>
    <Transition name="onboard-fade">
      <Onboarding
        v-if="phase === 'onboarding'"
        @done="onOnboardingDone"
      />
    </Transition>
    <Transition name="onboard-fade">
      <EnvDoctor
        v-if="phase === 'env'"
        gate
        @done="onEnvDone"
      />
    </Transition>
  </div>
</template>

<style scoped>
.shell {
  height: 100vh;
  /* 左侧栏 + 主区：两列网格（仿 polaris-app）。列宽随侧栏收起/展开过渡 */
  display: grid;
  grid-template-columns: 260px 1fr;
  /* 极淡角落环境光：让侧栏/内容磨砂玻璃后面「有光可透」，出琉璃感 */
  background: var(--ambient, var(--bg-side));
  border-radius: 12px;
  overflow: hidden;
  transition: grid-template-columns 180ms ease;
}
.content {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  /* Liquid Glass 主面板：半透明磨砂浮在 --ambient 环境光上，
     四角大圆角 + 白玻璃描边 + 顶部镜面高光，像一整块悬浮玻璃板 */
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  margin: 8px;
  border: 1px solid var(--glass-border, var(--hairline));
  border-radius: 16px;
  box-shadow: var(--shadow-lg), var(--glass-hi);
  /* 主区舞台 + 右侧对话抽屉并列 */
  display: flex;
  min-width: 0;
}
/* v9 玻璃棱边折射环：光从左上打进来，左上棱最亮、右下棱次亮（极光主题
   有自己的彩虹 ::after 边，这里用 ::before 不冲突） */
.content::before {
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
  z-index: 6;
}
/* 主区舞台：外贸 OS / 知识库 / 技能中心铺满剩余空间 */
.stage {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}
.view {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
/* 右侧对话抽屉：与主区并列，宽度可拖拽 */
.chat-dock {
  position: relative;
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  border-left: 1px solid var(--glass-border, var(--hairline));
  /* 抽屉比主区再亮/暗半档的玻璃层，形成材质层级 */
  background: var(--glass-side);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: var(--glass-hi);
}
.chat-dock :deep(.chat) {
  flex: 1 1 auto;
  min-width: 0;
}
/* 抽屉左缘拖拽手柄 */
.dock-resize {
  position: absolute;
  top: 0;
  left: -3px;
  width: 7px;
  height: 100%;
  z-index: 5;
  cursor: col-resize;
}
.dock-resize:hover {
  background: linear-gradient(
    90deg,
    transparent,
    var(--primary-soft, rgba(120, 120, 160, 0.18))
  );
}
/* 抽屉滑入 / 滑出 */
.dock-slide-enter-active,
.dock-slide-leave-active {
  transition: transform 0.24s ease, opacity 0.24s ease;
}
.dock-slide-enter-from,
.dock-slide-leave-to {
  transform: translateX(16px);
  opacity: 0;
}
/* Docker/Web 模式 WS 断线提示条 */
.ws-down {
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9998;
  padding: 4px 16px;
  border-radius: 0 0 9px 9px;
  background: var(--vermilion);
  color: #fff;
  font-size: 12px;
  letter-spacing: 0.5px;
  box-shadow: var(--shadow-lg);
}
</style>

<!-- 非 scoped：Transition 类名需作用在子组件根元素上 -->
<style>
.splash-fade-leave-active {
  transition: opacity 0.8s ease;
}
.splash-fade-leave-to {
  opacity: 0;
}
.onboard-fade-enter-active {
  transition: opacity 0.4s ease;
}
.onboard-fade-leave-active {
  transition: opacity 0.45s ease;
}
.onboard-fade-enter-from,
.onboard-fade-leave-to {
  opacity: 0;
}
</style>
