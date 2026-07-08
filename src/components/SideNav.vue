<script setup lang="ts">
/**
 * SideNav —— 左侧竖向导航（仿 polaris-app 侧栏，套本项目模块）。
 * 品牌 + 分区导航（工作台 / 知识）+ 底部（对话抽屉 / 更多设置）。
 * 磨砂玻璃质感：半透明 + 背景模糊 + 顶部高光，透出 shell 的 --ambient 环境光。
 * 可收起（app.sidebarCollapsed）：收起后只剩图标条（宽度由 app.sidebarWidth 给）。
 */
import { computed } from "vue";
import {
  Globe,
  Boxes,
  BookOpen,
  Puzzle,
  MessageSquare,
  Settings2,
  PanelLeftClose,
  PanelLeftOpen,
} from "@lucide/vue";
import { useAppStore, type ModuleTab } from "../stores/app";
import { useTradeStore } from "../modules/trade/useTradeStore";
import { MODULES, ICONS } from "../modules/trade/types";
import { useErpStore } from "../modules/erp/useErpStore";
import { ERP_MODULES, EICONS } from "../modules/erp/types";
import TIcon from "../modules/trade/components/TIcon.vue";

const app = useAppStore();
// 外贸 OS 导航并入侧栏：真·3 栏（左导航 / 中工作区 / 右 AI），去掉原来重复的第二侧栏。
// 与中间工作区共享 trade.view，点这里即切模块。
const trade = useTradeStore();
const tradeGroups = computed(() => {
  const gs: { name: string; items: typeof MODULES }[] = [];
  MODULES.forEach((m) => {
    let g = gs.find((x) => x.name === m.group);
    if (!g) { g = { name: m.group, items: [] }; gs.push(g); }
    g.items.push(m);
  });
  return gs;
});

// 星河无头ERP 导航同样并入侧栏，与 ERP 工作区共享 erp.view。
const erp = useErpStore();
const erpGroups = computed(() => {
  const gs: { name: string; items: typeof ERP_MODULES }[] = [];
  ERP_MODULES.forEach((m) => {
    let g = gs.find((x) => x.name === m.group);
    if (!g) { g = { name: m.group, items: [] }; gs.push(g); }
    g.items.push(m);
  });
  return gs;
});

type NavItem = { key: ModuleTab; label: string; hint: string; icon: typeof Globe };
// 分区导航：工作台（外贸 OS / 星河ERP）/ 知识（知识库·技能中心）。
const groups: { title: string; items: NavItem[] }[] = [
  {
    title: "工作台",
    items: [
      { key: "trade", label: "外贸 OS", hint: "北极星外贸 OS · 全链路工作台", icon: Globe },
      { key: "erp", label: "星河 ERP", hint: "无头ERP · AI 一人公司操作系统", icon: Boxes },
    ],
  },
  {
    title: "知识",
    items: [
      { key: "kb", label: "知识库", hint: "PolarisKB 资料库浏览 / 双链溯源", icon: BookOpen },
      { key: "skill", label: "技能中心", hint: "技能市场 / 我的技能", icon: Puzzle },
    ],
  },
];
</script>

<template>
  <aside
    class="sidenav"
    :class="{ collapsed: app.sidebarCollapsed }"
  >
    <!-- 品牌 + 收起按钮（顶部区做窗口拖拽区） -->
    <div class="brand-row">
      <div
        v-if="!app.sidebarCollapsed"
        class="brand"
      >
        <svg
          class="brand-star"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id="sn-star"
              x1="0"
              y1="0"
              x2="1"
              y2="1"
            >
              <stop
                offset="0"
                stop-color="#2f6f63"
              />
              <stop
                offset="1"
                stop-color="#8fd6c4"
              />
            </linearGradient>
          </defs>
          <path
            fill="url(#sn-star)"
            d="M12 1 C 12.6 7 12.9 8.4 23 12 C 12.9 15.6 12.6 17 12 23 C 11.4 17 11.1 15.6 1 12 C 11.1 8.4 11.4 7 12 1 Z"
          />
        </svg>
        <span class="brand-name"><b>北极星</b>跨境</span>
      </div>
      <button
        class="collapse-btn"
        :class="{ rail: app.sidebarCollapsed }"
        :title="app.sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
        @click="app.toggleSidebar()"
      >
        <component
          :is="app.sidebarCollapsed ? PanelLeftOpen : PanelLeftClose"
          :size="17"
          :stroke-width="1.7"
        />
      </button>
    </div>

    <!-- 分区导航 -->
    <nav class="nav">
      <template
        v-for="g in groups"
        :key="g.title"
      >
        <div
          v-if="!app.sidebarCollapsed"
          class="nav-group"
        >
          {{ g.title }}
        </div>
        <template
          v-for="it in g.items"
          :key="it.key"
        >
          <button
            class="nav-item"
            :class="{ active: app.moduleTab === it.key }"
            :title="it.hint"
            @click="app.setModuleTab(it.key)"
          >
            <span class="ni-ic"><component
              :is="it.icon"
              :size="17"
              :stroke-width="1.7"
            /></span>
            <span
              v-if="!app.sidebarCollapsed"
              class="ni-label"
            >{{ it.label }}</span>
          </button>

          <!-- 外贸 OS 展开：模块导航直接并入侧栏（人工审核看板 + 12 模块分组） -->
          <div
            v-if="it.key === 'trade' && app.moduleTab === 'trade' && !app.sidebarCollapsed"
            class="trade-nav"
          >
            <button
              class="trade-item review"
              :class="{ on: trade.view.value === 'review' }"
              title="人工审核看板"
              @click="trade.go('review')"
            >
              <span class="ti-ic"><TIcon
                :path="ICONS.review"
                :size="15"
              /></span>
              <span class="ti-lbl">人工审核看板</span>
              <span
                v-if="trade.pendingCount.value"
                class="ti-pip warn"
              >{{ trade.pendingCount.value }}</span>
            </button>
            <template
              v-for="tg in tradeGroups"
              :key="tg.name"
            >
              <div class="trade-group">
                {{ tg.name }}
              </div>
              <button
                v-for="m in tg.items"
                :key="m.id"
                class="trade-item"
                :class="{ on: trade.view.value === m.id }"
                :title="`${m.no} ${m.name} — ${m.sub}`"
                @click="trade.go(m.id)"
              >
                <span class="ti-ic"><TIcon
                  :path="m.icon"
                  :size="15"
                /></span>
                <span class="ti-lbl">{{ m.name }}</span>
                <span
                  v-if="m.star"
                  class="ti-star"
                >★</span>
                <span
                  v-if="m.pip"
                  class="ti-pip"
                  :class="{ warn: m.warn }"
                >{{ m.pip }}</span>
              </button>
            </template>
          </div>

          <!-- 星河ERP 展开：审批中心 + 10 模块分组（复用外贸 OS 子导航样式） -->
          <div
            v-if="it.key === 'erp' && app.moduleTab === 'erp' && !app.sidebarCollapsed"
            class="trade-nav"
          >
            <button
              class="trade-item review"
              :class="{ on: erp.view.value === 'review' }"
              title="审批中心：AI 备好功课，你只批/驳/改"
              @click="erp.go('review')"
            >
              <span class="ti-ic"><TIcon
                :path="EICONS.review"
                :size="15"
              /></span>
              <span class="ti-lbl">审批中心</span>
              <span
                v-if="erp.pendingCount.value"
                class="ti-pip warn"
              >{{ erp.pendingCount.value }}</span>
            </button>
            <template
              v-for="eg in erpGroups"
              :key="eg.name"
            >
              <div class="trade-group">
                {{ eg.name }}
              </div>
              <button
                v-for="m in eg.items"
                :key="m.id"
                class="trade-item"
                :class="{ on: erp.view.value === m.id }"
                :title="`${m.no} ${m.name} — ${m.sub}`"
                @click="erp.go(m.id)"
              >
                <span class="ti-ic"><TIcon
                  :path="m.icon"
                  :size="15"
                /></span>
                <span class="ti-lbl">{{ m.name }}</span>
                <span
                  v-if="m.star"
                  class="ti-star"
                >★</span>
              </button>
            </template>
          </div>
        </template>
      </template>
    </nav>

    <div class="spacer" />

    <!-- 底部：对话抽屉开关 + 更多设置 -->
    <div class="foot-nav">
      <button
        v-if="!app.isNativeTab"
        class="nav-item chat"
        :class="{ active: app.chatOpen }"
        title="对话系统：右侧抽屉，可拖宽 / 收起"
        @click="app.toggleChat()"
      >
        <span class="ni-ic"><MessageSquare
          :size="17"
          :stroke-width="1.7"
        /></span>
        <span
          v-if="!app.sidebarCollapsed"
          class="ni-label"
        >对话</span>
      </button>
      <button
        class="nav-item"
        title="设置 / 更多（含环境配置）"
        @click="app.openSettings()"
      >
        <span class="ni-ic"><Settings2
          :size="17"
          :stroke-width="1.7"
        /></span>
        <span
          v-if="!app.sidebarCollapsed"
          class="ni-label"
        >更多</span>
      </button>
      <div
        v-if="!app.sidebarCollapsed"
        class="foot-brand"
      >
        PolarisTrade
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidenav {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 8px 8px 8px;
  /* 磨砂玻璃侧栏：半透明 + 背景模糊，透出 shell 的 --ambient 环境光 */
  background: var(--glass-side, var(--bg-side));
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: var(--glass-hi);
  overflow: hidden;
}
.sidenav.collapsed {
  padding: 8px 4px;
}

/* 品牌 + 收起按钮：顶部区可拖动窗口 */
.brand-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px 10px;
  -webkit-app-region: drag;
}
.brand-row button {
  -webkit-app-region: no-drag;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.brand-star {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  filter: drop-shadow(0 1px 2px rgba(47, 111, 99, 0.35));
}
.brand-name {
  font-family: var(--serif, inherit);
  font-size: 15px;
  letter-spacing: 1px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.brand-name b {
  color: var(--primary);
  font-weight: 700;
}
.collapse-btn {
  margin-left: auto;
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  border-radius: 7px;
  background: transparent;
  border: none;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.collapse-btn:hover {
  background: var(--selection-bg);
  color: var(--text);
}
.collapse-btn.rail {
  margin: 0 auto;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-group {
  font-family: var(--serif);
  font-size: 10.5px;
  letter-spacing: 1.8px;
  color: var(--dim);
  padding: 12px 10px 4px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  text-align: left;
  transition: background 0.14s, color 0.14s, border-color 0.14s,
    transform 0.12s var(--ease, ease);
}
.nav-item:active {
  transform: scale(0.975); /* v9 按压反馈：玻璃件被指尖压下去一点 */
}
.nav-item:hover {
  /* 玻璃胶囊 hover：半透白 + 发丝描边，代替实底色块 */
  background: var(--card-bg, var(--selection-bg));
  border-color: var(--card-border, transparent);
  box-shadow: var(--shadow-sm);
  color: var(--text);
}
.nav-item.active {
  background: linear-gradient(160deg, var(--primary), var(--primary-deep));
  color: #fff;
  border-color: rgba(255, 255, 255, 0.22);
  /* 玻璃按钮三件套：顶部镜面高光 + 底部收暗 + 同色柔光晕 */
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.32),
    inset 0 -1px 0 rgba(0, 0, 0, 0.14),
    0 6px 16px -6px rgba(28, 48, 69, 0.55);
}
.nav-item.active .ni-ic {
  color: #fff;
}
.ni-ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  flex: 0 0 auto;
  color: var(--muted);
}
.ni-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidenav.collapsed .nav-item {
  justify-content: center;
  padding: 8px 0;
}

/* ── 外贸 OS 模块子导航（并入侧栏） ── */
.trade-nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 2px 0 4px 6px;
  padding-left: 8px;
  border-left: 1px solid var(--hairline);
}
.trade-group {
  font-family: var(--serif);
  font-size: 9.5px;
  letter-spacing: 1.2px;
  color: var(--dim);
  padding: 8px 8px 3px;
}
.trade-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  text-align: left;
  transition: background 0.14s, color 0.14s;
}
.trade-item:hover {
  background: var(--card-bg, var(--selection-bg));
  border-color: var(--card-border, transparent);
  color: var(--text);
}
.trade-item.on {
  background: linear-gradient(160deg, var(--primary), var(--primary-deep));
  color: #fff;
  border-color: rgba(255, 255, 255, 0.2);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28),
    inset 0 -1px 0 rgba(0, 0, 0, 0.12),
    0 4px 12px -5px rgba(28, 48, 69, 0.55);
}
.trade-item.on .ti-ic {
  color: #fff;
  opacity: 1;
}
.trade-item.review {
  background: rgba(167, 140, 79, 0.1);
  border-color: rgba(167, 140, 79, 0.22);
  margin-bottom: 3px;
}
.trade-item.review.on {
  background: linear-gradient(160deg, var(--primary), var(--primary-deep));
  border-color: transparent;
}
.ti-ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  flex: 0 0 auto;
  color: var(--muted);
  opacity: 0.9;
}
.ti-lbl {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ti-star {
  color: var(--gold, #a78c4f);
  font-size: 10px;
}
.trade-item.on .ti-star {
  color: #ffe8a8;
}
.ti-pip {
  font-size: 9.5px;
  font-weight: 700;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--bg-soft, rgba(0, 0, 0, 0.06));
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ti-pip.warn {
  background: var(--vermilion-soft, rgba(200, 80, 60, 0.14));
  color: var(--vermilion, #c8503c);
}
.trade-item.on .ti-pip {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}

.spacer {
  flex: 1 1 auto;
  min-height: 0;
}

.foot-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 8px;
  /* v9 渐隐发丝线：两端淡出的分割线比通长实线更轻盈 */
  border-top: 1px solid transparent;
  border-image: var(--hairline-grad, linear-gradient(90deg, transparent, var(--hairline), transparent)) 1;
}
.nav-item.chat.active {
  background: linear-gradient(160deg, var(--primary), var(--primary-deep));
  color: #fff;
}
.foot-brand {
  text-align: center;
  font-family: var(--serif);
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--dim);
  padding: 8px 0 2px;
}
</style>
