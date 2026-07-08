// 统一 markdown 渲染管线(聊天回复等所有 v-html 的来源):
// 1) 同步:marked(自定义 code/link 渲染) + DOMPurify → 立即可显示的 HTML,按原文缓存
//    —— 流式期间每 token 只为「活跃那条」做一次解析,历史回合全部命中缓存,不再全量重算。
// 2) 异步增强:shiki 代码高亮 + KaTeX 数学公式(都懒加载,首次用到才拉 chunk),
//    完成后更新缓存并 bump mdVersion,组件读它实现响应式刷新。
import { marked } from "marked";
import { ref } from "vue";
import { sanitizeHtml } from "./sanitize";

export const mdVersion = ref(0);

const cache = new Map<string, string>();
const enhanceQueued = new Set<string>();
const CACHE_CAP = 500;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── marked 全局配置:代码块包壳(语言标签 + 复制钮 + 超长折叠) ──
const COLLAPSE_LINES = 28;
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = (lang || "").trim().split(/\s+/)[0];
      const lines = text.split("\n").length;
      const collapsed = lines > COLLAPSE_LINES ? " collapsed" : "";
      const langLabel = language || "text";
      return (
        `<div class="code-block${collapsed}" data-lang="${escapeHtml(language)}">` +
        `<div class="code-head"><span class="code-lang">${escapeHtml(langLabel)}</span>` +
        `<span class="code-actions">` +
        (collapsed
          ? `<button type="button" class="code-expand">展开 ${lines} 行</button>`
          : "") +
        `<button type="button" class="code-copy">复制</button></span></div>` +
        `<pre><code class="language-${escapeHtml(language)}">${escapeHtml(text)}</code></pre>` +
        `</div>`
      );
    },
  },
});

// ── 数学公式:fence 外把 $$…$$ / \[…\] / \(…\) 换成占位节点,异步 KaTeX 渲染 ──
const MATH_HINT = /\$\$|\\\[|\\\(/;

function mathPlaceholders(src: string): string {
  if (!MATH_HINT.test(src)) return src;
  // 按代码 fence 切段,只在 fence 外替换(行内 `code` 里出现 $$ 的概率低,接受)
  const parts = src.split(/(```[\s\S]*?(?:```|$))/);
  return parts
    .map((seg, i) => {
      if (i % 2 === 1) return seg; // fence 内原样
      return seg
        .replace(
          /\$\$([\s\S]+?)\$\$/g,
          (_m, tex) =>
            `<div class="math-block" data-tex="${escapeHtml(tex.trim())}"></div>`
        )
        .replace(
          /\\\[([\s\S]+?)\\\]/g,
          (_m, tex) =>
            `<div class="math-block" data-tex="${escapeHtml(tex.trim())}"></div>`
        )
        .replace(
          /\\\((.+?)\\\)/g,
          (_m, tex) =>
            `<span class="math-inline" data-tex="${escapeHtml(tex.trim())}"></span>`
        );
    })
    .join("");
}

export interface RenderOpts {
  /** false = 流式中的活跃消息:跳过异步增强排队(等定稿后再高亮),省 CPU */
  enhance?: boolean;
}

export function renderMarkdown(text: string, opts?: RenderOpts): string {
  const key = text || "";
  const hit = cache.get(key);
  if (hit !== undefined) {
    // 已有基础版但还没排过增强(此前是流式中渲染的) → 这次定稿了就补排
    if (opts?.enhance !== false) scheduleEnhance(key, hit);
    return hit;
  }
  const html = sanitizeHtml(marked.parse(mathPlaceholders(key)) as string);
  if (cache.size >= CACHE_CAP) {
    cache.clear();
    enhanceQueued.clear();
  }
  cache.set(key, html);
  if (opts?.enhance !== false) scheduleEnhance(key, html);
  return html;
}

function scheduleEnhance(key: string, html: string) {
  if (enhanceQueued.has(key)) return;
  const needCode = html.includes('class="code-block');
  const needMath = html.includes('data-tex="');
  if (!needCode && !needMath) {
    enhanceQueued.add(key); // 标记免重复检查
    return;
  }
  enhanceQueued.add(key);
  // 空闲时再做,别跟流式渲染抢主线程
  const run = () => {
    enhanceHtml(html, needCode, needMath)
      .then((out) => {
        if (out && cache.get(key) === html) {
          cache.set(key, out);
          mdVersion.value++;
        }
      })
      .catch(() => {});
  };
  if ("requestIdleCallback" in window) {
    (window as any).requestIdleCallback(run, { timeout: 800 });
  } else {
    setTimeout(run, 60);
  }
}

// ── 懒加载 shiki / katex ──
// 用 shiki/core 细粒度按需导入: 只把白名单里的语言 + 单一主题打进产物,
// 避免主入口 codeToHtml 把 bundledLanguages(~200 语言)全部 code-split 成 chunk。
// 新增语言 = 在下方 SHIKI_LANGS 里加一行 import(...), 不会拖进其余语言。
const SHIKI_THEME = "one-dark-pro";
/* Promise<any> 而非 unknown：shiki createHighlighterCore 的 langs 形参是
   Promise<MaybeModule<...>>，unknown 不可赋值会挂 vue-tsc */
const SHIKI_LANGS: Record<string, () => Promise<any>> = {
  javascript: () => import("shiki/langs/javascript.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  shell: () => import("shiki/langs/shellscript.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
};
// 常见别名 → 白名单键
const SHIKI_ALIAS: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  rs: "rust",
  sh: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  "c++": "cpp",
  golang: "go",
};

let highlighterP: Promise<{
  codeToHtml: (code: string, opts: { lang: string; theme: string }) => string;
  getLoadedLanguages: () => string[];
} | null> | null = null;
function getHighlighter() {
  if (!highlighterP) {
    highlighterP = (async () => {
      const [{ createHighlighterCore }, { createOnigurumaEngine }] = await Promise.all([
        import("shiki/core"),
        import("shiki/engine/oniguruma"),
      ]);
      return createHighlighterCore({
        themes: [import("shiki/themes/one-dark-pro.mjs")],
        langs: Object.values(SHIKI_LANGS).map((load) => load()),
        engine: createOnigurumaEngine(import("shiki/wasm")),
      });
    })().catch(() => null);
  }
  return highlighterP;
}
function resolveLang(lang: string): string | null {
  const key = SHIKI_ALIAS[lang] ?? lang;
  return key in SHIKI_LANGS ? key : null;
}
let katexMod: Promise<any> | null = null;
function getKatex() {
  if (!katexMod) {
    katexMod = Promise.all([
      import("katex"),
      // CSS 随首次使用注入
      import("katex/dist/katex.min.css" as any),
    ]).then(([m]) => (m as any).default ?? m);
  }
  return katexMod;
}

async function enhanceHtml(
  html: string,
  needCode: boolean,
  needMath: boolean
): Promise<string | null> {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  let changed = false;

  if (needCode) {
    const highlighter = await getHighlighter();
    const blocks = highlighter ? tpl.content.querySelectorAll(".code-block") : [];
    for (const blk of Array.from(blocks)) {
      const codeEl = blk.querySelector("pre > code");
      const pre = blk.querySelector("pre");
      if (!codeEl || !pre) continue;
      const raw = (blk.getAttribute("data-lang") || "").toLowerCase();
      if (!raw || raw === "text" || raw === "plain") continue;
      const lang = resolveLang(raw);
      if (!lang) continue; // 未在白名单:保留无高亮原样
      try {
        const out = highlighter!.codeToHtml(codeEl.textContent || "", {
          lang,
          theme: SHIKI_THEME,
        });
        const t2 = document.createElement("template");
        t2.innerHTML = out;
        const shikiPre = t2.content.querySelector("pre");
        if (shikiPre) {
          pre.replaceWith(shikiPre);
          changed = true;
        }
      } catch {
        /* 未知语言:保留无高亮原样 */
      }
    }
  }

  if (needMath) {
    const katex = await getKatex();
    const nodes = tpl.content.querySelectorAll(".math-block[data-tex], .math-inline[data-tex]");
    for (const n of Array.from(nodes)) {
      const tex = n.getAttribute("data-tex") || "";
      if (!tex) continue;
      try {
        n.innerHTML = katex.renderToString(tex, {
          throwOnError: false,
          displayMode: n.classList.contains("math-block"),
          output: "html",
        });
        n.removeAttribute("data-tex");
        changed = true;
      } catch {
        n.textContent = tex;
      }
    }
  }

  return changed ? tpl.innerHTML : null;
}

/**
 * 给渲染 markdown 的容器装事件委托(复制代码/展开折叠/外链系统浏览器打开)。
 * 挂在 App 根上一次即可,所有 v-html 区域全覆盖。返回卸载函数。
 */
export function installMarkdownDelegation(
  root: HTMLElement | Document,
  openExternal: (url: string) => void
): () => void {
  const handler = (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const copyBtn = target.closest(".code-copy");
    if (copyBtn) {
      const blk = copyBtn.closest(".code-block");
      const code = blk?.querySelector("pre code, pre")?.textContent ?? "";
      navigator.clipboard
        .writeText(code)
        .then(() => {
          copyBtn.textContent = "已复制 ✓";
          setTimeout(() => (copyBtn.textContent = "复制"), 1400);
        })
        .catch(() => {});
      return;
    }
    const expandBtn = target.closest(".code-expand");
    if (expandBtn) {
      const blk = expandBtn.closest(".code-block");
      if (blk) {
        blk.classList.remove("collapsed");
        expandBtn.remove();
      }
      return;
    }
    const a = target.closest("a[href]") as HTMLAnchorElement | null;
    if (a) {
      const href = (a.getAttribute("href") || "").trim();
      // 纯页内锚点(#foo):不会替换 index.html,交给浏览器默认滚动。
      if (!href || href.startsWith("#")) return;
      // 关键:拦截所有带 href 的点击 —— 绝不允许 webview 内导航替换掉 index.html(否则整个 app 变白)。
      e.preventDefault();
      if (/^javascript:/i.test(href)) return; // 阻断 javascript: 伪协议
      if (/^https?:\/\//i.test(href)) {
        openExternal(href); // http(s) 外链:系统浏览器打开
      } else if (/^(mailto:|tel:)/i.test(href)) {
        openExternal(href); // 邮件/电话:交给系统处理(webview 内 default 未必可靠)
      }
      // 其余(相对路径 ./report.html、file: 等):已 preventDefault,直接忽略,不导航。
      // 无可用的产物/文件打开机制回调,故此处只做拦截防走丢。
    }
  };
  root.addEventListener("click", handler);
  return () => root.removeEventListener("click", handler);
}
