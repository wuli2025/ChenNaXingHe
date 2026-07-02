<script setup lang="ts">
/**
 * TradeModule —— 北极星外贸 OS 原生桌面壳。
 *
 * 真·3 栏（合并版）：左导航并入 App 侧栏 SideNav（模块菜单直接挂在那里，与本组件
 *      共享 store.view）；本组件只渲染 —
 *      中工作区（当前模块组件 / 审核看板，随选择整屏 crossfade 切换）
 *      右 AI 坞（对话 ⇄ Console 双标签：真 useAgentRunner 流式，onDelta/onTool 可见）
 *
 * 全部原生：直连 Tauri 后端官方 Claude Code，不再走沙箱 iframe + postMessage 回落演示。
 */
import { ref, computed, nextTick, watch } from "vue";
import { useTradeStore } from "./useTradeStore";
import { MODULES } from "./types";
import type { ModId } from "./types";
import { renderMarkdown, mdVersion } from "../../lib/markdown";
import "./trade.css";

// 12 业务模块
import M0Dashboard from "./modules/M0Dashboard.vue";
import M1Sourcing from "./modules/M1Sourcing.vue";
import M2Outreach from "./modules/M2Outreach.vue";
import M3Purchase from "./modules/M3Purchase.vue";
import M4Customs from "./modules/M4Customs.vue";
import M5Logistics from "./modules/M5Logistics.vue";
import M6Warehouse from "./modules/M6Warehouse.vue";
import M7Distribution from "./modules/M7Distribution.vue";
import M8Finance from "./modules/M8Finance.vue";
import M9Compliance from "./modules/M9Compliance.vue";
import M10Workflow from "./modules/M10Workflow.vue";
import M11Knowledge from "./modules/M11Knowledge.vue";
import ReviewBoard from "./review/ReviewBoard.vue";

const store = useTradeStore();

/** 当前视图：某模块 id 或 'review'（审核看板）—— 与并入 SideNav 的模块导航共享。 */
const view = store.view;
const dockTab = ref<"chat" | "console">("chat");
const dockCollapsed = ref(false);

/* 「运行记录」未读活动圆点：任一模块触发 AI 动作写 Console 而用户不在该页时提示（非侵入式打通）。 */
const consoleSeen = ref(0);
const consoleDot = computed(
  () => dockTab.value !== "console" && store.consoleLines.value.length > consoleSeen.value
);
watch(
  [dockTab, () => store.consoleLines.value.length],
  ([tab, n]) => { if (tab === "console") consoleSeen.value = n as number; }
);

const MODULE_COMP: Record<ModId, unknown> = {
  m0: M0Dashboard, m1: M1Sourcing, m2: M2Outreach, m3: M3Purchase,
  m4: M4Customs, m5: M5Logistics, m6: M6Warehouse, m7: M7Distribution,
  m8: M8Finance, m9: M9Compliance, m10: M10Workflow, m11: M11Knowledge,
};

const currentComp = computed(() => (view.value === "review" ? ReviewBoard : MODULE_COMP[view.value]));
const currentMod = computed(() => MODULES.find((m) => m.id === view.value));

/* ── 面包屑 / 标题 ── */
const crumbGroup = computed(() => (view.value === "review" ? "流水线" : currentMod.value?.group || ""));
const crumbName = computed(() => (view.value === "review" ? "人工审核看板" : currentMod.value?.name || ""));

/* ── 右侧 AI 坞：对话 ── */
interface ChatMsg {
  role: "me" | "ai";
  /** 原文（reactive 重渲染，配合 mdVersion 命中缓存/异步高亮） */
  raw: string;
  /** 本轮工具调用轨迹（内联「AI 跑了什么」） */
  tools: { name: string; detail?: string }[];
  at: number;
  streaming?: boolean;
  error?: boolean;
  /** 是否展开工具明细 */
  showTools?: boolean;
}
const chatLog = ref<ChatMsg[]>([]);
const chatText = ref("");
const chatBusy = ref(false);
const logEl = ref<HTMLElement | null>(null);
const consoleEl = ref<HTMLElement | null>(null);
let aborter: AbortController | null = null;

/* 工具名 → 友好中文（与主对话面板一致） */
const TOOL_LABELS: Record<string, string> = {
  Bash: "运行命令", Read: "读取文件", Write: "写入文件", Edit: "编辑文件",
  MultiEdit: "批量编辑", Glob: "查找文件", Grep: "搜索内容",
  WebSearch: "联网搜索", WebFetch: "抓取网页", Task: "子任务", TodoWrite: "更新清单",
};
function toolLabel(n: string): string {
  return TOOL_LABELS[n] ?? n;
}

/** 统一 markdown 渲染（marked + DOMPurify + shiki/KaTeX 异步增强）。流式中传 enhance=false 省 CPU。 */
function renderMd(text: string, enhance = true): string {
  void mdVersion.value; // 注册响应式依赖：异步增强完成后刷新
  return renderMarkdown(text || "", { enhance });
}

function scrollChat() {
  nextTick(() => { if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight; });
}
watch(() => store.consoleLines.value.length, () => {
  nextTick(() => { if (consoleEl.value) consoleEl.value.scrollTop = consoleEl.value.scrollHeight; });
});

async function sendChat(text?: string) {
  const t = (text ?? chatText.value).trim();
  // 合并 busy：任一处运行（本地对话流 chatBusy 或 store 侧模块动作 store.busy）时都不允许再提交，
  // 避免共享的 running 布尔在首个 run 的 finally 清零后于运行中重新放开按钮造成重复提交。
  if (!t || chatBusy.value || store.busy.value) return;
  chatText.value = "";
  chatLog.value.push({ role: "me", raw: t, tools: [], at: Date.now() });
  scrollChat();
  chatBusy.value = true;
  const mod = currentMod.value;
  const ai = ref<ChatMsg>({ role: "ai", raw: "", tools: [], at: Date.now(), streaming: true });
  chatLog.value.push(ai.value);
  const useKb = /HS|归类|税则|ChAFTA|WET|GST|合规|产区|话术|知识/i.test(t) || ["m4", "m9", "m11"].includes(String(store.activeMod.value));
  aborter = new AbortController();
  try {
    await store.runChat(mod?.name || "工作台", mod?.sub || "", t, useKb, {
      onDelta: (_d, full) => { ai.value.raw = full; scrollChat(); },
      onTool: (tool, detail) => { ai.value.tools.push({ name: tool, detail }); },
      signal: aborter.signal,
    });
    if (!ai.value.raw.trim()) ai.value.raw = "_本轮没有产生文本输出。_";
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "已取消") ai.value.raw = ai.value.raw || "_已停止生成。_";
    else { ai.value.raw = `**后端不可用**：${msg}`; ai.value.error = true; }
  } finally {
    ai.value.streaming = false;
    chatBusy.value = false;
    aborter = null;
    scrollChat();
  }
}

function stopChat() { aborter?.abort(); }
function clearChat() { chatLog.value = []; }
function copyMsg(m: ChatMsg) { navigator.clipboard?.writeText(m.raw).catch(() => {}); }

function fmtTime(at: number): string {
  return new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}
const recentRuns = computed(() => store.runs.value.slice(0, 10));

const isEmptyChat = computed(() => chatLog.value.length === 0);

/* 快捷问：随当前模块自适应（贴合正在看的业务，减少「不知道能问什么」）。 */
const QUICK_BY_MOD: Record<string, string[]> = {
  m0: ["帮我梳理今天待办", "现在有哪些风险预警？", "这个月经营亮点总结一下"],
  m1: ["按澳洲市场缺口给我 6 个选品方向", "智利有机红酒现在值得做吗？"],
  m2: ["帮 Viña Aurora 写一封破冰开发信", "帮我判断最新这条回信的意向"],
  m3: ["给 Barossa 写一封比价询价信", "这几家供应商我该怎么选？"],
  m4: ["把 0617 报关草稿检查一遍", "Chardonnay 该归到哪个 HS 编码？"],
  m5: ["0617 到港后还差哪几步？", "现在有没有滞港风险？"],
  m6: ["哪些批次临期需要处理？", "Chardonnay 这周要补多少货？"],
  m7: ["给 Dan Murphy's 起草一封报价邮件", "含税价是怎么算出来的？"],
  m8: ["这笔货代账单该匹配哪张凭证？", "帮我把未达账项理一下"],
  m9: ["0625 缺哪些合规要件？", "WET 和 GST 分别怎么算？"],
  m10: ["现在有哪些工作流挂起了？", "报关流程卡在哪一步？"],
  m11: ["讲一下 ChAFTA 的原产地规则", "葡萄酒进口标签有哪些硬要求？"],
  review: ["硬闸任务应该先处理哪个？", "解释一下人工审核闸的意义"],
};
const quickAsks = computed(() => QUICK_BY_MOD[String(view.value)] ?? QUICK_BY_MOD.m0);
</script>

<template>
  <div class="trade" :class="{ 'dock-collapsed': dockCollapsed }">
    <!-- ─────────── 中：工作区 ─────────── -->
    <main class="work">
      <header class="work-head">
        <div class="crumb"><span>{{ crumbGroup }}</span><span class="sep">/</span><b>{{ crumbName }}</b></div>
        <div class="wh-status" :class="{ busy: store.busy.value }">
          <span class="dot" />{{ store.runStatus.value || (store.busy.value ? "Claude 运行中…" : "就绪") }}
        </div>
      </header>
      <div class="work-body">
        <Transition name="tswap" mode="out-in">
          <component :is="currentComp" :key="view" />
        </Transition>
      </div>
    </main>

    <!-- ─────────── 右：AI 坞 ─────────── -->
    <aside v-show="!dockCollapsed" class="dock">
      <div class="dock-head">
        <div class="dt-tabs">
          <button :class="{ on: dockTab === 'chat' }" @click="dockTab = 'chat'">AI 对话</button>
          <button :class="{ on: dockTab === 'console' }" @click="dockTab = 'console'">
            运行记录<span v-if="consoleDot" class="tab-dot" />
          </button>
        </div>
        <button class="dock-x" title="收起" @click="dockCollapsed = true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>

      <!-- 对话 -->
      <template v-if="dockTab === 'chat'">
        <!-- 空态：居中大问候（“最右风格”），快捷问随当前模块自适应 -->
        <div v-if="isEmptyChat" class="chat-hero">
          <div class="hero-mark">★</div>
          <div class="hero-title">你说，北极星帮你跑</div>
          <div class="hero-sub">澳鲸进口全链路助手 · 正在看「{{ crumbName }}」<br />关键动作前都有人工审核闸</div>
          <div class="hero-chips">
            <button v-for="q in quickAsks" :key="q" class="hero-chip" @click="sendChat(q)">{{ q }}</button>
          </div>
        </div>
        <!-- 有对话：气泡流 -->
        <div v-else ref="logEl" class="chat-log">
          <div v-for="(m, i) in chatLog" :key="i" class="msg" :class="m.role">
            <div class="av">{{ m.role === "ai" ? "★" : "你" }}</div>
            <div class="msg-main">
              <!-- 内联工具活动（AI 跑了什么，实时/可折叠） -->
              <div v-if="m.role === 'ai' && m.tools.length" class="tool-strip">
                <button class="tool-toggle" @click="m.showTools = !m.showTools">
                  <span class="ts-dot" :class="{ live: m.streaming }" />
                  {{ m.streaming ? "正在调用" : "调用了" }} {{ m.tools.length }} 个工具
                  <svg class="ts-chev" :class="{ open: m.showTools }" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                <div v-if="m.showTools" class="tool-list">
                  <div v-for="(tl, ti) in m.tools" :key="ti" class="tool-item">
                    <span class="tool-name">{{ toolLabel(tl.name) }}</span>
                    <span v-if="tl.detail" class="tool-detail">{{ tl.detail }}</span>
                  </div>
                </div>
              </div>
              <div class="bubble md" :class="{ err: m.error }">
                <div v-if="m.role === 'ai' && m.streaming && !m.raw" class="t-typing">···</div>
                <template v-else>
                  <div class="md-body" v-html="renderMd(m.raw, !m.streaming)" /><span v-if="m.streaming" class="caret" />
                </template>
              </div>
              <div class="msg-foot">
                <span class="msg-time">{{ fmtTime(m.at) }}</span>
                <button v-if="m.role === 'ai' && !m.streaming && m.raw" class="msg-copy" title="复制" @click="copyMsg(m)">复制</button>
              </div>
            </div>
          </div>
        </div>
        <!-- 上下文条：明示 AI 正贴着哪个模块作答 + 清空 -->
        <div v-if="!isEmptyChat" class="chat-ctx">
          <span class="ctx-chip"><span class="ctx-live" :class="{ on: chatBusy }" />贴合「{{ crumbName }}」作答</span>
          <button class="ctx-clear" @click="clearChat">清空对话</button>
        </div>
        <div class="chat-input" :class="{ busy: chatBusy }">
          <textarea
            v-model="chatText"
            rows="1"
            :placeholder="chatBusy ? '北极星正在思考…' : store.busy.value ? '有模块动作正在运行…' : '问北极星助手…（Enter 发送 · Shift+Enter 换行）'"
            :disabled="chatBusy || store.busy.value"
            @keydown.enter.exact.prevent="sendChat()"
          />
          <button v-if="chatBusy" class="chat-stop" title="停止生成" @click="stopChat()">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          </button>
          <button v-else class="chat-send" :disabled="!chatText.trim() || store.busy.value" title="发送" @click="sendChat()">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></svg>
          </button>
        </div>
      </template>

      <!-- Console -->
      <template v-else>
        <div class="console-head">
          <span>实时日志 · AI 跑了什么</span>
          <button class="lnk" @click="store.clearConsole()">清空</button>
        </div>
        <div ref="consoleEl" class="console-log">
          <div v-if="store.consoleLines.value.length === 0" class="empty">Agent 采集 / 归类 / 评判 / 对账时，Claude 的流式输出与工具调用在此实时显示。</div>
          <div v-for="(l, i) in store.consoleLines.value" :key="i" class="cl" :class="`cl-${l.kind}`">
            <span class="clt">{{ fmtTime(l.at) }}</span><span class="clx">{{ l.text }}</span>
          </div>
        </div>
        <div class="console-head">Agent 记录（{{ store.runs.value.length }}）</div>
        <div class="runs">
          <div v-if="recentRuns.length === 0" class="empty small">暂无 RUN 记录</div>
          <div v-for="r in recentRuns" :key="r.id" class="run">
            <span class="run-kind">{{ r.kind }}</span>
            <div class="run-body">
              <div class="run-sum">{{ r.resultSummary }}</div>
              <div class="run-meta">{{ r.mod.toUpperCase() }} · {{ fmtTime(r.at) }} · {{ r.tools.length }} 工具</div>
            </div>
          </div>
        </div>
      </template>
    </aside>
    <button v-show="dockCollapsed" class="dock-reopen" title="展开 AI 坞" @click="dockCollapsed = false">★</button>
  </div>
</template>

<style scoped>
.trade {
  display: grid;
  grid-template-columns: 1fr 360px;
  height: 100%;
  min-height: 0;
  /* 与外壳同一套环境光：磨砂侧栏/坞浮在其上，透出琉璃感 */
  background: var(--ambient, var(--bg));
  color: var(--text);
}
.trade.dock-collapsed { grid-template-columns: 1fr 0; }

/* ── 中工作区 ── */
.work { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.work-head {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.crumb { font-size: 12.5px; color: var(--muted); display: flex; align-items: center; gap: 8px; }
.crumb .sep { color: var(--dim); }
.crumb b { color: var(--text); font-weight: 700; font-size: 13.5px; }
.wh-status {
  margin-left: auto; display: flex; align-items: center; gap: 7px;
  font-size: 11.5px; color: var(--muted);
  background: var(--glass-bg, var(--panel));
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-soft);
  padding: 5px 11px; border-radius: 999px;
  box-shadow: var(--glass-hi);
}
.wh-status .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dim); }
.wh-status.busy .dot { background: var(--ok); animation: tpulse 1.1s ease-in-out infinite; }
@keyframes tpulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.work-body { flex: 1; min-height: 0; overflow-y: auto; padding: 20px 24px 40px; }

.tswap-enter-active, .tswap-leave-active { transition: opacity 0.2s, transform 0.2s; }
.tswap-enter-from { opacity: 0; transform: translateY(8px); }
.tswap-leave-to { opacity: 0; transform: translateY(-6px); }

/* ── 右 AI 坞 ── */
.dock {
  display: flex; flex-direction: column; min-height: 0;
  border-left: 1px solid var(--hairline);
  background: var(--glass-side, var(--bg-side));
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
}
.dock-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-bottom: 1px solid var(--border);
}
.dt-tabs { display: flex; gap: 4px; }
.dt-tabs button {
  border: none; background: transparent; cursor: pointer;
  font-size: 12px; font-weight: 600; color: var(--muted);
  padding: 5px 10px; border-radius: 7px;
}
.dt-tabs button.on { background: var(--panel); color: var(--text); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06); }
.tab-dot { display: inline-block; width: 6px; height: 6px; margin-left: 5px; vertical-align: middle; border-radius: 50%; background: var(--ok); animation: tpulse 1.1s ease-in-out infinite; }
.dock-x { margin-left: auto; border: none; background: transparent; color: var(--muted); cursor: pointer; padding: 3px; display: flex; border-radius: 6px; }
.dock-x:hover { background: var(--panel-hover); color: var(--text); }
.dock-reopen {
  position: absolute; right: 0; top: 50%;
  border: 1px solid var(--border); border-right: none;
  background: var(--panel); color: var(--gold);
  border-radius: 8px 0 0 8px; padding: 10px 6px; cursor: pointer;
}

/* 空态大问候（“最右风格”） */
.chat-hero {
  flex: 1; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 24px 22px; gap: 8px;
}
.hero-mark {
  width: 46px; height: 46px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; color: #3a2e10;
  background: linear-gradient(140deg, #f0d69a, var(--gold, #a78c4f));
  box-shadow: 0 6px 18px -6px rgba(167, 140, 79, 0.6);
  margin-bottom: 6px;
}
.hero-title { font-size: 18px; font-weight: 750; letter-spacing: 0.5px; color: var(--text); }
.hero-sub { font-size: 11.5px; color: var(--muted); line-height: 1.6; max-width: 240px; }
.hero-chips { display: flex; flex-direction: column; gap: 7px; margin-top: 14px; width: 100%; max-width: 260px; }
.hero-chip {
  border: 1px solid var(--border-soft); background: var(--panel);
  color: var(--text-2); font-size: 12px; text-align: left;
  padding: 9px 12px; border-radius: 10px; cursor: pointer; transition: all 0.14s;
}
.hero-chip:hover { border-color: var(--primary); color: var(--text); background: var(--panel-hover); }

.chat-log { flex: 1; overflow-y: auto; padding: 16px 12px; display: flex; flex-direction: column; gap: 16px; }
.msg { display: flex; gap: 8px; }
.msg.me { flex-direction: row-reverse; }
.av {
  width: 24px; height: 24px; flex-shrink: 0; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700;
  background: var(--panel); color: var(--gold); border: 1px solid var(--border);
}
.msg.me .av { background: var(--primary); color: #fff; border: none; }

/* 消息主体（工具条 + 气泡 + 脚注 竖排，限宽在此） */
.msg-main { display: flex; flex-direction: column; gap: 5px; max-width: 84%; min-width: 0; }
.msg.me .msg-main { align-items: flex-end; }

/* 内联工具活动 */
.tool-strip { align-self: flex-start; max-width: 100%; }
.tool-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--border-soft); background: var(--bg-soft);
  color: var(--muted); font-size: 11px; font-weight: 600;
  padding: 3px 9px; border-radius: 999px; cursor: pointer; transition: all 0.14s;
}
.tool-toggle:hover { color: var(--text-2); border-color: var(--border); }
.ts-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dim); flex: none; }
.ts-dot.live { background: var(--ok); animation: tpulse 1.1s ease-in-out infinite; }
.ts-chev { transition: transform 0.18s; opacity: 0.7; }
.ts-chev.open { transform: rotate(180deg); }
.tool-list {
  margin-top: 6px; display: flex; flex-direction: column; gap: 3px;
  border-left: 2px solid var(--border); padding: 2px 0 2px 10px;
}
.tool-item { display: flex; align-items: baseline; gap: 7px; font-size: 11px; line-height: 1.5; }
.tool-name { color: var(--primary-deep); font-weight: 600; flex: none; }
.tool-detail { color: var(--muted); font-family: var(--mono); font-size: 10.5px; word-break: break-all; }

.bubble {
  font-size: 12.5px; line-height: 1.64; color: var(--text-2);
  background: var(--panel); border: 1px solid var(--border-soft);
  padding: 9px 12px; border-radius: 12px; border-top-left-radius: 4px;
  word-break: break-word; overflow: hidden;
}
.msg.me .bubble { background: var(--primary-soft); color: var(--primary-deep); border: none; border-radius: 12px; border-top-right-radius: 4px; }
.bubble.err { background: var(--vermilion-soft); border-color: transparent; color: var(--vermilion); }
.md-body { display: inline; }

/* 气泡内 markdown 排版（紧凑版） */
.bubble :deep(p) { margin: 0 0 8px; }
.bubble :deep(p:last-child) { margin-bottom: 0; }
.bubble :deep(b), .bubble :deep(strong) { color: var(--text); font-weight: 700; }
.bubble :deep(ul), .bubble :deep(ol) { margin: 4px 0 8px; padding-left: 18px; }
.bubble :deep(li) { margin: 2px 0; }
.bubble :deep(li)::marker { color: var(--gold); }
.bubble :deep(h1), .bubble :deep(h2), .bubble :deep(h3), .bubble :deep(h4) {
  font-size: 13px; font-weight: 750; color: var(--text); margin: 10px 0 5px; line-height: 1.35;
}
.bubble :deep(h1:first-child), .bubble :deep(h2:first-child), .bubble :deep(h3:first-child) { margin-top: 0; }
.bubble :deep(code) { font-family: var(--mono); font-size: 0.9em; background: var(--bg-soft); padding: 1px 4px; border-radius: 4px; }
.bubble :deep(pre) { margin: 6px 0; border-radius: 8px; }
.bubble :deep(.code-block) { margin: 6px 0; }
.bubble :deep(a) { color: var(--primary); text-decoration: none; border-bottom: 1px solid var(--primary-soft); }
.bubble :deep(a:hover) { border-bottom-color: var(--primary); }
.bubble :deep(blockquote) { margin: 6px 0; padding: 2px 10px; border-left: 3px solid var(--border-strong); color: var(--muted); }
.bubble :deep(table) { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 11.5px; }
.bubble :deep(th), .bubble :deep(td) { border: 1px solid var(--border-soft); padding: 4px 8px; text-align: left; }
.bubble :deep(th) { background: var(--bg-soft); color: var(--text); font-weight: 700; }
.bubble :deep(hr) { border: none; border-top: 1px solid var(--border-soft); margin: 10px 0; }

/* 流式光标 */
.caret {
  display: inline-block; width: 7px; height: 14px; margin-left: 1px;
  vertical-align: text-bottom; background: var(--primary);
  border-radius: 1px; animation: tcaret 0.9s steps(2) infinite;
}
@keyframes tcaret { 50% { opacity: 0; } }

.t-typing { letter-spacing: 3px; color: var(--dim); animation: tblink 1s steps(3) infinite; }
@keyframes tblink { 50% { opacity: 0.35; } }

/* 脚注：时间 + 复制 */
.msg-foot { display: flex; align-items: center; gap: 8px; padding: 0 2px; }
.msg.me .msg-foot { flex-direction: row-reverse; }
.msg-time { font-size: 10px; color: var(--dim); font-variant-numeric: tabular-nums; }
.msg-copy { border: none; background: transparent; color: var(--dim); font-size: 10px; cursor: pointer; padding: 0; }
.msg-copy:hover { color: var(--primary); }

/* 上下文条 */
.chat-ctx {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 14px 0;
}
.ctx-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--muted); }
.ctx-live { width: 6px; height: 6px; border-radius: 50%; background: var(--dim); flex: none; }
.ctx-live.on { background: var(--ok); animation: tpulse 1.1s ease-in-out infinite; }
.ctx-clear { border: none; background: transparent; color: var(--dim); font-size: 10.5px; cursor: pointer; padding: 0; }
.ctx-clear:hover { color: var(--vermilion); }

.chat-input {
  display: flex; gap: 8px; align-items: flex-end;
  margin: 8px 12px 12px; padding: 8px 8px 8px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 14px; background: var(--panel);
  box-shadow: var(--glass-hi);
  transition: border-color 0.15s;
}
.chat-input:focus-within { border-color: var(--primary); }
.chat-input.busy { border-color: var(--border-soft); }
.chat-input textarea {
  flex: 1; resize: none; border: none; background: transparent;
  padding: 4px 0; font-size: 13px; color: var(--text);
  font-family: var(--sans); max-height: 140px; line-height: 1.55;
}
.chat-input textarea:focus { outline: none; }
.chat-input textarea:disabled { color: var(--muted); }
.chat-send, .chat-stop {
  flex: 0 0 auto; width: 32px; height: 32px; border: none; cursor: pointer;
  border-radius: 10px; display: inline-flex; align-items: center; justify-content: center;
  transition: opacity 0.15s, transform 0.1s, filter 0.15s;
}
.chat-send { background: linear-gradient(160deg, var(--primary), var(--primary-deep)); color: #fff; }
.chat-send:hover:not(:disabled) { transform: translateY(-1px); }
.chat-send:disabled { opacity: 0.4; cursor: default; }
.chat-stop { background: var(--vermilion-soft); color: var(--vermilion); }
.chat-stop:hover { filter: brightness(0.95); }

.console-head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--muted); padding: 10px 14px 6px;
}
.lnk { border: none; background: transparent; color: var(--muted); font-size: 10.5px; cursor: pointer; text-transform: none; }
.lnk:hover { color: var(--primary); }
.console-log {
  flex: 1; min-height: 120px; overflow-y: auto; margin: 0 12px;
  background: var(--panel); border: 1px solid var(--border-soft); border-radius: 9px;
  padding: 8px; font-family: var(--mono); font-size: 10.5px; line-height: 1.55;
}
.empty { color: var(--dim); font-family: var(--sans); font-size: 11.5px; padding: 6px; line-height: 1.6; }
.empty.small { padding: 4px 0; }
.cl { display: flex; gap: 6px; padding: 1px 0; }
.clt { color: var(--dim); flex-shrink: 0; }
.clx { color: var(--text-2); word-break: break-word; white-space: pre-wrap; }
.cl-tool .clx { color: var(--primary); }
.cl-ok .clx { color: var(--ok); }
.cl-error .clx { color: var(--vermilion); }
.cl-info .clx { color: var(--gold); }
.runs { max-height: 210px; overflow-y: auto; padding: 0 12px 14px; display: flex; flex-direction: column; gap: 6px; }
.run { display: flex; gap: 8px; background: var(--panel); border: 1px solid var(--border-soft); border-radius: 8px; padding: 7px 9px; }
.run-kind { font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 5px; height: fit-content; background: var(--primary-soft); color: var(--primary-deep); text-transform: uppercase; }
.run-sum { font-size: 11.5px; font-weight: 600; color: var(--text); }
.run-meta { font-size: 9.5px; color: var(--dim); font-family: var(--mono); margin-top: 1px; }

@media (max-width: 1100px) {
  .trade { grid-template-columns: 1fr 0; }
}
</style>
