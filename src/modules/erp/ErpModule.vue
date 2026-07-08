<script setup lang="ts">
/**
 * ErpModule —— 星河无头ERP 原生桌面壳（AI 一人公司操作系统）。
 *
 * 布局与外贸 OS 同构（用户零学习成本）：
 *  - 左导航并入 App 侧栏 SideNav（与本组件共享 store.view）
 *  - 中工作区：当前模块组件 / 审批中心，整屏 crossfade 切换
 *  - 右 AI 坞：对话 ⇄ 运行记录，直连官方 Claude Code（流式 onDelta/onTool）
 *
 * 无头理念：中间是「观察窗」，右边是「操作者（AI）」，唯一必须人做的事在审批中心。
 */
import { ref, computed, nextTick, watch } from "vue";
import { useErpStore } from "./useErpStore";
import { ERP_MODULES } from "./types";
import type { ErpModId } from "./types";
import { renderMarkdown, mdVersion } from "../../lib/markdown";
import "../trade/trade.css";
import "./erp.css";

import E0Dashboard from "./modules/E0Dashboard.vue";
import E1Products from "./modules/E1Products.vue";
import E2Listing from "./modules/E2Listing.vue";
import E3Pricing from "./modules/E3Pricing.vue";
import E4Orders from "./modules/E4Orders.vue";
import E5Logistics from "./modules/E5Logistics.vue";
import E6Purchase from "./modules/E6Purchase.vue";
import E7Finance from "./modules/E7Finance.vue";
import E8Tax from "./modules/E8Tax.vue";
import E9Params from "./modules/E9Params.vue";
import ApprovalBoard from "./review/ApprovalBoard.vue";

const store = useErpStore();
const view = store.view;
const dockTab = ref<"chat" | "console">("chat");
const dockCollapsed = ref(false);

const consoleSeen = ref(0);
const consoleDot = computed(
  () => dockTab.value !== "console" && store.consoleLines.value.length > consoleSeen.value
);
watch(
  [dockTab, () => store.consoleLines.value.length],
  ([tab, n]) => { if (tab === "console") consoleSeen.value = n as number; }
);

const MODULE_COMP: Record<ErpModId, unknown> = {
  e0: E0Dashboard, e1: E1Products, e2: E2Listing, e3: E3Pricing, e4: E4Orders,
  e5: E5Logistics, e6: E6Purchase, e7: E7Finance, e8: E8Tax, e9: E9Params,
};

const currentComp = computed(() => (view.value === "review" ? ApprovalBoard : MODULE_COMP[view.value]));
const currentMod = computed(() => ERP_MODULES.find((m) => m.id === view.value));
const crumbGroup = computed(() => (view.value === "review" ? "人机协作" : currentMod.value?.group || ""));
const crumbName = computed(() => (view.value === "review" ? "审批中心" : currentMod.value?.name || ""));

/* ── 右侧 AI 坞：对话 ── */
interface ChatMsg {
  role: "me" | "ai";
  raw: string;
  tools: { name: string; detail?: string }[];
  at: number;
  streaming?: boolean;
  error?: boolean;
  showTools?: boolean;
}
const chatLog = ref<ChatMsg[]>([]);
const chatText = ref("");
const chatBusy = ref(false);
const logEl = ref<HTMLElement | null>(null);
const consoleEl = ref<HTMLElement | null>(null);
let aborter: AbortController | null = null;

const TOOL_LABELS: Record<string, string> = {
  Bash: "运行命令", Read: "读取文件", Write: "写入文件", Edit: "编辑文件",
  MultiEdit: "批量编辑", Glob: "查找文件", Grep: "搜索内容",
  WebSearch: "联网搜索", WebFetch: "抓取网页", Task: "子任务", TodoWrite: "更新清单",
};
function toolLabel(n: string): string {
  return TOOL_LABELS[n] ?? n;
}
function renderMd(text: string, enhance = true): string {
  void mdVersion.value;
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
  if (!t || chatBusy.value || store.busy.value) return;
  chatText.value = "";
  chatLog.value.push({ role: "me", raw: t, tools: [], at: Date.now() });
  scrollChat();
  chatBusy.value = true;
  const mod = currentMod.value;
  const ai = ref<ChatMsg>({ role: "ai", raw: "", tools: [], at: Date.now(), streaming: true });
  chatLog.value.push(ai.value);
  const useKb = /退税|VAT|申报|HS|归类|合规|税/i.test(t) || ["e7", "e8"].includes(String(store.activeMod.value));
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

/* 快捷问：随当前模块自适应。 */
const QUICK_BY_MOD: Record<string, string[]> = {
  e0: ["生成今天的经营晨报", "现在最要紧的三件事是什么？", "这个月能达成 GMV 目标吗？"],
  e1: ["找 5 个宠物类目低竞争候选品", "P-004 除毛手套值得转正吗？"],
  e2: ["优化德国站饮水机 Listing", "帮 Temu 那条胸背带写发布文案"],
  e3: ["竞品降价了，饮水机要不要跟？", "收纳凳现价离保本线还有多少空间？"],
  e4: ["TM-4471 这单风控标记怎么处理？", "帮我起草 AS-31 的退款处理方案"],
  e5: ["SH-690 停滞 41 天了怎么办？", "德国 200g 普货现在走哪条线最划算？"],
  e6: ["跑一次全 SKU 补货测算", "PO-2406 什么时候该催产？"],
  e7: ["把云途这张账单识别入账", "R-24 Temu 货款为什么未达？"],
  e8: ["跑一遍 6 月增值税申报前检查", "德国 VAT 这期要缴多少？依据是什么？"],
  e9: ["自动调价带宽 8% 合理吗？", "解释一下每个自治边界参数的作用"],
  review: ["先处理哪张卡片？", "为什么付款必须人工确认？"],
};
const quickAsks = computed(() => QUICK_BY_MOD[String(view.value)] ?? QUICK_BY_MOD.e0);
</script>

<template>
  <div
    class="erp"
    :class="{ 'dock-collapsed': dockCollapsed }"
  >
    <!-- ─────────── 中：工作区 ─────────── -->
    <main class="work">
      <header class="work-head">
        <div class="crumb">
          <span>{{ crumbGroup }}</span><span class="sep">/</span><b>{{ crumbName }}</b>
        </div>
        <div
          class="wh-status"
          :class="{ busy: store.busy.value }"
        >
          <span class="dot" />{{ store.runStatus.value || (store.busy.value ? "AI 代理运行中…" : "就绪") }}
        </div>
      </header>
      <div class="work-body">
        <Transition
          name="eswap"
          mode="out-in"
        >
          <component
            :is="currentComp"
            :key="view"
          />
        </Transition>
      </div>
    </main>

    <!-- ─────────── 右：AI 坞 ─────────── -->
    <aside
      v-show="!dockCollapsed"
      class="dock"
    >
      <div class="dock-head">
        <div class="dt-tabs">
          <button
            :class="{ on: dockTab === 'chat' }"
            @click="dockTab = 'chat'"
          >
            AI 对话
          </button>
          <button
            :class="{ on: dockTab === 'console' }"
            @click="dockTab = 'console'"
          >
            运行记录<span
              v-if="consoleDot"
              class="tab-dot"
            />
          </button>
        </div>
        <button
          class="dock-x"
          title="收起"
          @click="dockCollapsed = true"
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          ><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>

      <template v-if="dockTab === 'chat'">
        <div
          v-if="isEmptyChat"
          class="chat-hero"
        >
          <div class="hero-mark">
            ✦
          </div>
          <div class="hero-title">
            你说，星河替你经营
          </div>
          <div class="hero-sub">
            无头ERP · 8 个 AI 代理在后台跑<br>付款 / 报税 / 发布等关键动作永远等你点头
          </div>
          <div class="hero-chips">
            <button
              v-for="q in quickAsks"
              :key="q"
              class="hero-chip"
              @click="sendChat(q)"
            >
              {{ q }}
            </button>
          </div>
        </div>
        <div
          v-else
          ref="logEl"
          class="chat-log"
        >
          <div
            v-for="(m, i) in chatLog"
            :key="i"
            class="msg"
            :class="m.role"
          >
            <div class="av">
              {{ m.role === "ai" ? "✦" : "你" }}
            </div>
            <div class="msg-main">
              <div
                v-if="m.role === 'ai' && m.tools.length"
                class="tool-strip"
              >
                <button
                  class="tool-toggle"
                  @click="m.showTools = !m.showTools"
                >
                  <span
                    class="ts-dot"
                    :class="{ live: m.streaming }"
                  />
                  {{ m.streaming ? "正在调用" : "调用了" }} {{ m.tools.length }} 个工具
                  <svg
                    class="ts-chev"
                    :class="{ open: m.showTools }"
                    viewBox="0 0 24 24"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  ><path d="M6 9l6 6 6-6" /></svg>
                </button>
                <div
                  v-if="m.showTools"
                  class="tool-list"
                >
                  <div
                    v-for="(tl, ti) in m.tools"
                    :key="ti"
                    class="tool-item"
                  >
                    <span class="tool-name">{{ toolLabel(tl.name) }}</span>
                    <span
                      v-if="tl.detail"
                      class="tool-detail"
                    >{{ tl.detail }}</span>
                  </div>
                </div>
              </div>
              <div
                class="bubble md"
                :class="{ err: m.error }"
              >
                <div
                  v-if="m.role === 'ai' && m.streaming && !m.raw"
                  class="t-typing"
                >
                  ···
                </div>
                <template v-else>
                  <div
                    class="md-body"
                    v-html="renderMd(m.raw, !m.streaming)"
                  /><span
                    v-if="m.streaming"
                    class="caret"
                  />
                </template>
              </div>
              <div class="msg-foot">
                <span class="msg-time">{{ fmtTime(m.at) }}</span>
                <button
                  v-if="m.role === 'ai' && !m.streaming && m.raw"
                  class="msg-copy"
                  title="复制"
                  @click="copyMsg(m)"
                >
                  复制
                </button>
              </div>
            </div>
          </div>
        </div>
        <div
          v-if="!isEmptyChat"
          class="chat-ctx"
        >
          <span class="ctx-chip"><span
            class="ctx-live"
            :class="{ on: chatBusy }"
          />贴合「{{ crumbName }}」作答</span>
          <button
            class="ctx-clear"
            @click="clearChat"
          >
            清空对话
          </button>
        </div>
        <div
          class="chat-input"
          :class="{ busy: chatBusy }"
        >
          <textarea
            v-model="chatText"
            rows="1"
            :placeholder="chatBusy ? '星河正在思考…' : store.busy.value ? '有代理动作正在运行…' : '吩咐星河…（Enter 发送 · Shift+Enter 换行）'"
            :disabled="chatBusy || store.busy.value"
            @keydown.enter.exact.prevent="sendChat()"
          />
          <button
            v-if="chatBusy"
            class="chat-stop"
            title="停止生成"
            @click="stopChat()"
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="currentColor"
            ><rect
              x="6"
              y="6"
              width="12"
              height="12"
              rx="2"
            /></svg>
          </button>
          <button
            v-else
            class="chat-send"
            :disabled="!chatText.trim() || store.busy.value"
            title="发送"
            @click="sendChat()"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            ><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></svg>
          </button>
        </div>
      </template>

      <template v-else>
        <div class="console-head">
          <span>实时日志 · AI 跑了什么</span>
          <button
            class="lnk"
            @click="store.clearConsole()"
          >
            清空
          </button>
        </div>
        <div
          ref="consoleEl"
          class="console-log"
        >
          <div
            v-if="store.consoleLines.value.length === 0"
            class="empty"
          >
            代理做选品 / 调价 / OCR / 对账时，Claude 的流式输出与工具调用在此实时显示。
          </div>
          <div
            v-for="(l, i) in store.consoleLines.value"
            :key="i"
            class="cl"
            :class="`cl-${l.kind}`"
          >
            <span class="clt">{{ fmtTime(l.at) }}</span><span class="clx">{{ l.text }}</span>
          </div>
        </div>
        <div class="console-head">
          Agent 记录（{{ store.runs.value.length }}）
        </div>
        <div class="runs">
          <div
            v-if="recentRuns.length === 0"
            class="empty small"
          >
            暂无 RUN 记录
          </div>
          <div
            v-for="r in recentRuns"
            :key="r.id"
            class="run"
          >
            <span class="run-kind">{{ r.kind }}</span>
            <div class="run-body">
              <div class="run-sum">
                {{ r.resultSummary }}
              </div>
              <div class="run-meta">
                {{ r.mod.toUpperCase() }} · {{ fmtTime(r.at) }} · {{ r.tools.length }} 工具
              </div>
            </div>
          </div>
        </div>
      </template>
    </aside>
    <button
      v-show="dockCollapsed"
      class="dock-reopen"
      title="展开 AI 坞"
      @click="dockCollapsed = false"
    >
      ✦
    </button>
  </div>
</template>

<style scoped>
.erp {
  display: grid;
  grid-template-columns: 1fr 360px;
  height: 100%;
  min-height: 0;
  background: var(--ambient, var(--bg));
  color: var(--text);
}
.erp.dock-collapsed { grid-template-columns: 1fr 0; }

.work { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.work-head {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.crumb { font-size: 12.5px; color: var(--muted); display: flex; align-items: center; gap: 8px; }
.crumb .sep { color: var(--dim); }
.crumb b { color: var(--text); font-weight: 700; font-size: 13.5px; letter-spacing: -0.01em; }
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
.wh-status.busy .dot { background: var(--ok); animation: epulse 1.1s ease-in-out infinite; }
@keyframes epulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.work-body { flex: 1; min-height: 0; overflow-y: auto; padding: 20px 24px 40px; }

.eswap-enter-active, .eswap-leave-active { transition: opacity 0.2s, transform 0.2s; }
.eswap-enter-from { opacity: 0; transform: translateY(8px); }
.eswap-leave-to { opacity: 0; transform: translateY(-6px); }

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
/* 选中 tab：玻璃小卡（描边走 inset 阴影，不改盒模型） */
.dt-tabs button.on { background: var(--card-bg); color: var(--text); box-shadow: inset 0 0 0 1px var(--card-border), 0 1px 3px rgba(0, 0, 0, 0.06); }
.tab-dot { display: inline-block; width: 6px; height: 6px; margin-left: 5px; vertical-align: middle; border-radius: 50%; background: var(--ok); animation: epulse 1.1s ease-in-out infinite; }
.dock-x { margin-left: auto; border: none; background: transparent; color: var(--muted); cursor: pointer; padding: 3px; display: flex; border-radius: 6px; }
.dock-x:hover { background: var(--panel-hover); color: var(--text); }
/* 贴边浮钮：真磨砂 chrome（悬浮件） */
.dock-reopen {
  position: absolute; right: 0; top: 50%;
  border: 1px solid var(--chrome-border); border-right: none;
  background: var(--chrome-bg); color: var(--gold);
  backdrop-filter: var(--chrome-blur);
  -webkit-backdrop-filter: var(--chrome-blur);
  box-shadow: var(--chrome-shadow);
  border-radius: 8px 0 0 8px; padding: 10px 6px; cursor: pointer;
}

.chat-hero {
  flex: 1; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 24px 22px; gap: 8px;
}
.hero-mark {
  width: 46px; height: 46px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; color: #10352a;
  background: linear-gradient(140deg, #9be3c9, var(--primary, #2f6f63));
  box-shadow: 0 6px 18px -6px rgba(47, 111, 99, 0.6);
  margin-bottom: 6px;
}
.hero-title { font-size: 18px; font-weight: 750; letter-spacing: 0.5px; color: var(--text); }
.hero-sub { font-size: 11.5px; color: var(--muted); line-height: 1.6; max-width: 250px; }
.hero-chips { display: flex; flex-direction: column; gap: 7px; margin-top: 14px; width: 100%; max-width: 260px; }
.hero-chip {
  border: 1px solid var(--card-border); background: var(--card-bg);
  color: var(--text-2); font-size: 12px; text-align: left;
  padding: 9px 12px; border-radius: 10px; cursor: pointer; transition: all 0.14s;
  box-shadow: var(--card-shadow);
}
.hero-chip:hover { border-color: var(--primary); color: var(--text); transform: translateY(-1px); box-shadow: var(--card-shadow-hover); }

.chat-log { flex: 1; overflow-y: auto; padding: 16px 12px; display: flex; flex-direction: column; gap: 16px; }
.msg { display: flex; gap: 8px; }
.msg.me { flex-direction: row-reverse; }
.av {
  width: 24px; height: 24px; flex-shrink: 0; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700;
  background: var(--card-bg); color: var(--primary); border: 1px solid var(--card-border);
}
.msg.me .av { background: var(--primary); color: #fff; border: none; }
.msg-main { display: flex; flex-direction: column; gap: 5px; max-width: 84%; min-width: 0; }
.msg.me .msg-main { align-items: flex-end; }

.tool-strip { align-self: flex-start; max-width: 100%; }
.tool-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--border-soft); background: var(--bg-soft);
  color: var(--muted); font-size: 11px; font-weight: 600;
  padding: 3px 9px; border-radius: 999px; cursor: pointer; transition: all 0.14s;
}
.tool-toggle:hover { color: var(--text-2); border-color: var(--border); }
.ts-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dim); flex: none; }
.ts-dot.live { background: var(--ok); animation: epulse 1.1s ease-in-out infinite; }
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
  background: var(--card-bg); border: 1px solid var(--card-border);
  padding: 9px 12px; border-radius: 12px; border-top-left-radius: 4px;
  word-break: break-word; overflow: hidden;
  box-shadow: var(--card-shadow);
}
.msg.me .bubble { background: var(--primary-soft); color: var(--primary-deep); border: none; border-radius: 12px; border-top-right-radius: 4px; }
.bubble.err { background: var(--vermilion-soft); border-color: transparent; color: var(--vermilion); }
.md-body { display: inline; }
.bubble :deep(p) { margin: 0 0 8px; }
.bubble :deep(p:last-child) { margin-bottom: 0; }
.bubble :deep(b), .bubble :deep(strong) { color: var(--text); font-weight: 700; }
.bubble :deep(ul), .bubble :deep(ol) { margin: 4px 0 8px; padding-left: 18px; }
.bubble :deep(li) { margin: 2px 0; }
.bubble :deep(li)::marker { color: var(--primary); }
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

.caret {
  display: inline-block; width: 7px; height: 14px; margin-left: 1px;
  vertical-align: text-bottom; background: var(--primary);
  border-radius: 1px; animation: ecaret 0.9s steps(2) infinite;
}
@keyframes ecaret { 50% { opacity: 0; } }
.t-typing { letter-spacing: 3px; color: var(--dim); animation: eblink 1s steps(3) infinite; }
@keyframes eblink { 50% { opacity: 0.35; } }

.msg-foot { display: flex; align-items: center; gap: 8px; padding: 0 2px; }
.msg.me .msg-foot { flex-direction: row-reverse; }
.msg-time { font-size: 10px; color: var(--dim); font-variant-numeric: tabular-nums; }
.msg-copy { border: none; background: transparent; color: var(--dim); font-size: 10px; cursor: pointer; padding: 0; }
.msg-copy:hover { color: var(--primary); }

.chat-ctx {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 14px 0;
}
.ctx-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--muted); }
.ctx-live { width: 6px; height: 6px; border-radius: 50%; background: var(--dim); flex: none; }
.ctx-live.on { background: var(--ok); animation: epulse 1.1s ease-in-out infinite; }
.ctx-clear { border: none; background: transparent; color: var(--dim); font-size: 10.5px; cursor: pointer; padding: 0; }
.ctx-clear:hover { color: var(--vermilion); }

/* 输入浮岛：真磨砂 chrome，内容从玻璃下滑过 */
.chat-input {
  position: relative;
  display: flex; gap: 8px; align-items: flex-end;
  margin: 8px 12px 12px; padding: 8px 8px 8px 12px;
  border: 1px solid var(--chrome-border);
  border-radius: 14px; background: var(--chrome-bg);
  backdrop-filter: var(--chrome-blur);
  -webkit-backdrop-filter: var(--chrome-blur);
  box-shadow: var(--glass-hi);
  transition: border-color 0.15s var(--ease, ease), box-shadow 0.15s var(--ease, ease);
}
/* 棱边折射环：跟随圆角的 1px 玻璃棱光 */
.chat-input::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
  background: var(--edge-refract);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  pointer-events: none; z-index: 3;
}
.chat-input:focus-within { border-color: var(--primary); box-shadow: var(--glass-hi), 0 0 0 3px var(--primary-soft); }
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
  transition: opacity 0.15s, transform 0.12s var(--ease, ease), filter 0.15s;
}
.chat-send { background: linear-gradient(160deg, var(--primary), var(--primary-deep)); color: #fff; }
.chat-send:hover:not(:disabled) { transform: translateY(-1px); }
.chat-send:active:not(:disabled) { transform: translateY(0) scale(0.98); }
.chat-send:disabled { opacity: 0.4; cursor: default; }
.chat-stop { background: var(--vermilion-soft); color: var(--vermilion); }
.chat-stop:hover { filter: brightness(0.95); }

.console-head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--muted); padding: 10px 14px 6px;
}
.lnk { border: none; background: transparent; color: var(--muted); font-size: 10.5px; cursor: pointer; text-transform: none; }
.lnk:hover { color: var(--primary); }
.console-log {
  flex: 1; min-height: 120px; overflow-y: auto; margin: 0 12px;
  background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 9px;
  box-shadow: var(--card-shadow);
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
.run { display: flex; gap: 8px; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 8px; padding: 7px 9px; box-shadow: var(--card-shadow); }
.run-kind { font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 5px; height: fit-content; background: var(--primary-soft); color: var(--primary-deep); text-transform: uppercase; letter-spacing: 0.08em; }
.run-sum { font-size: 11.5px; font-weight: 600; color: var(--text); }
.run-meta { font-size: 9.5px; color: var(--dim); font-family: var(--mono); margin-top: 1px; }

@media (max-width: 1100px) {
  .erp { grid-template-columns: 1fr 0; }
}
</style>
