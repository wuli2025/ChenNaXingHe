/**
 * useAgentRunner —— 把 Claude Code 当唯一后端大脑的统一驱动层。
 *
 * 业务模块（外贸 OS 等）都经此发起 agent 任务：
 *  - run()      ：发一轮，流式回 delta/tool，done 后返回全文。
 *  - runJson()  ：要求结构化 JSON，自带提取 + 坏 JSON 回灌 Claude 修复。
 *
 * 设计要点
 *  - 复用后端既有 `chat:stream` 流式协议（{conversationId, kind, text}）与 chat_send 命令，
 *    不新增后端命令；前端自挂监听、按 conversationId 路由、done/err 收尾、静默看门狗兜底。
 *  - 每次 workflow run 默认开**全新会话**（上下文隔离、无污染），符合「这次工作不带历史」。
 *    模块自身把结果持久化到 localStorage（保留记录/历史）。
 *  - providerId 透传 → 跟随用户在「供应商」中心选的 API（CC / 各家 key）。
 */
import { ref, computed } from "vue";
import {
  chat as chatApi,
  convApi,
  listen,
  isTauri,
  type ChatStreamEvent,
  type PermissionMode,
} from "../tauri";

export interface AgentRunOptions {
  /** 用户/系统拼好的完整提示词（含方法论硬约束、schema 等）。 */
  prompt: string;
  /** 目标模式：设置后 Claude 持续推进直到达成。长检索/多阶段任务建议给。 */
  goal?: string;
  /** 智能体模式：默认 single-agent（最快、最省，单轮分析足够）。 */
  agentMode?: string;
  /** 工作模式：默认 office（精简工具面，更快聚焦；营销分析不需要编程全家桶）。 */
  workMode?: string;
  /** 是否注入知识库（严格搜索）。默认 false。 */
  useKb?: boolean;
  /** 权限模式：默认 auto_current（允许本目录读写/检索，免逐次确认）。 */
  permissionMode?: PermissionMode;
  /** 选定供应商 id（空 = 跟随全局当前供应商）。 */
  providerId?: string;
  /** 复用某会话（默认每次新建，隔离上下文）。 */
  conversationId?: string;
  /** 流式增量回调（拼接 assistant 文本）。 */
  onDelta?: (text: string, full: string) => void;
  /** 工具调用回调（让「AI 跑了什么」可见）。 */
  onTool?: (tool: string, detail?: string) => void;
  /** 取消信号。 */
  signal?: AbortSignal;
}

export interface AgentRunResult {
  raw: string;
  convId: string;
  /** 期间触发的工具调用轨迹（供「AI 跑了什么」审计）。 */
  tools: Array<{ tool: string; detail?: string; at: number }>;
}

const PROJECT_CACHE_KEY = "chuanying.agentProjectId.v1";
const SILENCE_LIMIT_MS = 300_000; // 5 分钟完全无心跳 → 判异常终止

let projectPromise: Promise<string> | null = null;

/** 取（或建）一个隐藏的承载项目：营销模块的 Claude 会话都挂在它下面。 */
async function ensureAgentProject(): Promise<string> {
  if (!isTauri) return "browser-stub-project";
  if (projectPromise) return projectPromise;
  projectPromise = (async () => {
    const cached = localStorage.getItem(PROJECT_CACHE_KEY);
    if (cached) {
      // 校验它还在（用户可能清过库）。
      try {
        const projects = await convApi.listProjects();
        if (projects.some((p) => p.id === cached)) return cached;
      } catch {
        /* 列举失败就重建 */
      }
    }
    const p = await convApi.createProject("营销智能体");
    try {
      localStorage.setItem(PROJECT_CACHE_KEY, p.id);
    } catch {
      /* ignore */
    }
    return p.id;
  })();
  // 别把「失败的 promise」永久缓存:一次 createProject 瞬时失败若被记住,本会话之后每次 run
  // 都会拿到同一个 rejected promise 而永远跑不起来。失败即清空,让下次调用重试。
  projectPromise.catch(() => {
    projectPromise = null;
  });
  return projectPromise;
}

/** 从第一个 { 或 [ 起做括号配平（识别字符串/转义），截到对应收尾；无平衡则 null。 */
function balancedFrom(t: string): string | null {
  const first = t.search(/[[{]/);
  if (first < 0) return null;
  const open = t[first];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = first; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return t.slice(first, i + 1);
    }
  }
  return null;
}

/**
 * 从模型全文里抠出第一个合法 JSON。
 * M2 修复:不再「先按 ``` 围栏粗截再配平」——那会在两种真实场景出错:
 *   (1) JSON 某字段值里含 markdown 代码围栏 → 非贪婪匹配把 JSON 提前截断成残缺;
 *   (2) 正文里先出现无关 ```bash 块 → 取到没有 { 的错块直接返回 null。
 * 改为:优先尝试围栏内内容,但仅当其能配平「且能真正解析」才采用;否则退回对全文做括号配平。
 * 全文配平天然跳过 markdown 围栏字符(``` 不是括号)与前后解释文字,更稳。
 */
export function sliceJson(text: string): string | null {
  if (!text) return null;
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const inner = balancedFrom(fence[1].trim());
    if (inner && tryParse(inner) !== null) return inner;
  }
  return balancedFrom(t);
}

/** 去掉 JSON 里位于「字符串外」的尾随逗号(逗号后紧跟 } 或 ])。字符串内的逗号原样保留。 */
function stripTrailingCommas(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      // 向后跳过空白,看下一个非空白是否为收尾括号 → 是则丢弃这个逗号。
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (j < s.length && (s[j] === "}" || s[j] === "]")) continue;
    }
    out += ch;
  }
  return out;
}

function tryParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // M3 修复:去尾随逗号只在字符串外进行,不再用全局正则误改字符串内容(如 "a, }")。
    try {
      return JSON.parse(stripTrailingCommas(raw)) as T;
    } catch {
      return null;
    }
  }
}

export function useAgentRunner() {
  // H2 修复:用「活跃轮数」引用计数,而非单个布尔。多个 run() 并发时(如连点多个评判、
  // 或一边聊天一边选品),只要还有任意一轮在跑 running 就为 true;先完成的那一轮不会
  // 把 running 提前置 false 而放开 busy 门控、导致重复触发。
  const activeRuns = ref(0);
  const running = computed(() => activeRuns.value > 0);

  /** 发一轮，流式回调，done 后返回全文。 */
  async function run(opts: AgentRunOptions): Promise<AgentRunResult> {
    activeRuns.value++;
    const tools: AgentRunResult["tools"] = [];
    let full = "";
    try {
      const projectId = await ensureAgentProject();
      let convId = opts.conversationId;
      if (!convId) {
        if (isTauri) {
          const c = await convApi.createConversation(projectId);
          convId = c.id;
        } else {
          convId = `stub-${Math.round(performance.now())}`;
        }
      }

      let lastBeat = Date.now();
      let unlisten: (() => void) | null = null;

      const result = await new Promise<AgentRunResult>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          unlisten?.();
          clearInterval(watchdog);
          if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
          fn();
        };
        const onAbort = () => {
          // 若用户在 chatApi.send resolve(拿到 reqId)之前就取消: reqId 还是空串, cancel("")
          // 是个 no-op → 后端会继续流式跑。此时记一个 pendingAbort, 等 send resolve 拿到真正的
          // reqId 后立刻补发取消(见下方 .then)。
          if (reqId) chatApi.cancel(reqId).catch(() => {});
          else pendingAbort = true;
          finish(() => reject(new Error("已取消")));
        };
        const watchdog = window.setInterval(() => {
          if (Date.now() - lastBeat >= SILENCE_LIMIT_MS) {
            finish(() => reject(new Error("后端长时间无响应（本轮超时）")));
          }
        }, 15_000);

        let reqId = "";
        let pendingAbort = false;
        listen<ChatStreamEvent>("chat:stream", (ev) => {
          if (ev.conversationId !== convId) return;
          lastBeat = Date.now();
          if (ev.kind === "delta") {
            full += ev.text ?? "";
            opts.onDelta?.(ev.text ?? "", full);
          } else if (ev.kind === "tool") {
            const rec = { tool: ev.tool ?? "(unknown)", detail: ev.text || undefined, at: Date.now() };
            tools.push(rec);
            opts.onTool?.(rec.tool, rec.detail);
          } else if (ev.kind === "error") {
            // stderr 行：仅记录，不作终态
            full += "";
          } else if (ev.kind === "done") {
            finish(() => resolve({ raw: full, convId: convId!, tools }));
          }
        })
          .then((un): string | Promise<string> => {
            unlisten = un;
            if (opts.signal?.aborted) {
              onAbort();
              return "";
            }
            if (opts.signal) opts.signal.addEventListener("abort", onAbort);
            // 监听挂上后再发，避免首帧 delta 早于注册而丢失。
            return chatApi.send({
              prompt: opts.prompt,
              permissionMode: opts.permissionMode ?? "auto_current",
              goal: opts.goal,
              agentMode: opts.agentMode ?? "single-agent",
              workMode: opts.workMode ?? "office",
              useKb: opts.useKb ?? false,
              providerId: opts.providerId,
              conversationId: convId,
            });
          })
          .then((id) => {
            reqId = id;
            // 用户在拿到 reqId 之前已按取消:此刻才有 reqId 可用 → 立刻取消,别让后端空跑。
            if (pendingAbort && reqId) chatApi.cancel(reqId).catch(() => {});
          })
          .catch((e) => finish(() => reject(e)));
      });

      return result;
    } finally {
      activeRuns.value = Math.max(0, activeRuns.value - 1);
    }
  }

  /**
   * 要求结构化 JSON：跑一轮 → 提取 → 解析；坏 JSON 则把原文回灌 Claude 让它「只输出修好的 JSON」。
   * 失败抛错，调用方决定是否回落 demo/重试。
   */
  async function runJson<T>(
    opts: AgentRunOptions & { repair?: boolean }
  ): Promise<{ data: T; raw: string; convId: string; tools: AgentRunResult["tools"] }> {
    const res = await run(opts);
    const sliced = sliceJson(res.raw);
    if (sliced) {
      const parsed = tryParse<T>(sliced);
      if (parsed) return { data: parsed, raw: res.raw, convId: res.convId, tools: res.tools };
    }
    if (opts.repair === false) throw new Error("模型未返回有效 JSON");
    // 修复轮：复用同一会话，喂回坏文本。
    const repair = await run({
      ...opts,
      conversationId: res.convId,
      prompt: `上一条本应是合法 JSON 但解析失败。请只输出修好后的合法 JSON，不要任何解释文字、不要 markdown 围栏。注意：字符串内的双引号转义为 \\"，去掉尾随逗号。\n\n坏 JSON：\n${res.raw.slice(0, 8000)}`,
      onDelta: undefined,
    });
    const sliced2 = sliceJson(repair.raw);
    const parsed2 = sliced2 ? tryParse<T>(sliced2) : null;
    if (parsed2) return { data: parsed2, raw: repair.raw, convId: repair.convId, tools: res.tools.concat(repair.tools) };
    throw new Error("模型未返回有效 JSON（修复后仍失败）");
  }

  return { running, run, runJson };
}
