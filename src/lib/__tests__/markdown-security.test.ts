/**
 * @vitest-environment jsdom
 *
 * XSS 防护测试必须跑在 jsdom 下：DOMPurify 依赖真实 DOM 的属性/节点操作，
 * 而 happy-dom 15 与 DOMPurify 3.4 的属性删除/节点禁用不兼容（会让 sanitize 不可靠地
 * 直通 payload，产生假阳性——已实测确认）。jsdom 与生产的 Chromium webview 行为一致，
 * 是验证 sanitize 真实防护的可信环境。
 */
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../markdown";
import { sanitizeHtml } from "../sanitize";

function renderSync(markdown: string): string {
  return renderMarkdown(markdown, { enhance: false });
}

function hrefs(html: string): string[] {
  const host = document.createElement("div");
  host.innerHTML = html;
  return Array.from(host.querySelectorAll("a[href]")).map((a) => a.getAttribute("href") || "");
}

describe("renderMarkdown XSS 防护", () => {
  it("剥离 script 标签", () => {
    const html = renderSync("<script>alert(1)</script>");

    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<\/script>/i);
  });

  it("剥离 img onerror 事件属性", () => {
    const html = renderSync("<img src=x onerror=alert(1)>");

    expect(html).not.toMatch(/\sonerror\s*=/i);
  });

  it("阻断 markdown 链接中的 javascript: href", () => {
    // P0: src/lib/markdown.ts:93 -> src/lib/sanitize.ts:8
    // payload: [x](javascript:alert(1))
    // actual: <a href="javascript:alert(1)">x</a>
    const html = renderSync("[x](javascript:alert(1))");

    expect(html).not.toMatch(/href\s*=\s*["']?\s*javascript:/i);
    expect(hrefs(html).some((href) => /^javascript:/i.test(href.trim()))).toBe(false);
  });

  it("剥离 svg onload 事件属性", () => {
    // P0: src/lib/markdown.ts:93 -> src/lib/sanitize.ts:8
    // payload: <svg onload=alert(1)><circle /></svg>
    // actual: <svg onload="alert" 1=""><circle></circle></svg>
    const html = renderSync("<svg onload=alert(1)><circle /></svg>");

    expect(html).not.toMatch(/\sonload\s*=/i);
  });

  it("剥离 iframe/object/embed 嵌入标签", () => {
    // P0: src/lib/markdown.ts:93 -> src/lib/sanitize.ts:8
    // payload: <iframe ...></iframe><object ...></object><embed ...>
    // actual: <object data="https://evil.example/poc"></object><embed src="https://evil.example/poc">
    const html = renderSync(
      [
        '<iframe src="https://evil.example/poc"></iframe>',
        '<object data="https://evil.example/poc"></object>',
        '<embed src="https://evil.example/poc">',
      ].join("\n")
    );

    expect(html).not.toMatch(/<iframe\b/i);
    expect(html).not.toMatch(/<object\b/i);
    expect(html).not.toMatch(/<embed\b/i);
  });

  it("阻断 data:text/html href", () => {
    // P0: src/lib/markdown.ts:93 -> src/lib/sanitize.ts:8
    // payload: <a href="data:text/html,<script>alert(1)</script>">x</a>
    // actual: <a href="data:text/html,<script>alert(1)</script>">x</a>
    const html = renderSync('<a href="data:text/html,<script>alert(1)</script>">x</a>');

    expect(html).not.toMatch(/href\s*=\s*["']?\s*data:text\/html/i);
    expect(hrefs(html).some((href) => /^data:text\/html/i.test(href.trim()))).toBe(false);
  });

  it("剥离内联 onclick/onmouseover 事件属性", () => {
    // P0: src/lib/markdown.ts:93 -> src/lib/sanitize.ts:8
    // payload: <button onclick=... onmouseover=...>ok</button><a href="https://safe.example" onclick=... onmouseover=...>
    // actual: <button onclick="alert(1)" onmouseover="alert(2)">ok</button> <a href="https://safe.example" onclick="alert(3)" onmouseover="alert(4)">safe</a>
    const html = renderSync(
      '<button onclick="alert(1)" onmouseover="alert(2)">ok</button> <a href="https://safe.example" onclick="alert(3)" onmouseover="alert(4)">safe</a>'
    );

    expect(html).not.toMatch(/\sonclick\s*=/i);
    expect(html).not.toMatch(/\sonmouseover\s*=/i);
  });

  it("保留正常 markdown 的粗体、代码块、表格和 http/https 链接", () => {
    const html = renderSync(
      [
        "**粗体**",
        "",
        "```ts",
        "const ok = 1;",
        "```",
        "",
        "| H |",
        "| - |",
        "| V |",
        "",
        "[http](http://example.com) [https](https://example.com)",
      ].join("\n")
    );

    expect(html).toContain("<strong>粗体</strong>");
    expect(html).toContain('class="code-block"');
    expect(html).toContain('data-lang="ts"');
    expect(html).toContain("const ok = 1;");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>H</th>");
    expect(html).toContain("<td>V</td>");
    expect(html).toContain('<a href="http://example.com">http</a>');
    expect(html).toContain('<a href="https://example.com">https</a>');
  });
});

describe("sanitizeHtml 白名单行为", () => {
  it("保留常规富文本、表格、代码块 class/data 属性和 http/https 链接", () => {
    const html = sanitizeHtml(
      [
        '<p><strong>粗体</strong><em>斜体</em></p>',
        '<pre><code class="language-ts" data-lang="ts">const ok = 1;</code></pre>',
        "<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>V</td></tr></tbody></table>",
        '<a href="http://example.com">http</a><a href="https://example.com">https</a>',
      ].join("")
    );

    expect(html).toContain("<strong>粗体</strong>");
    expect(html).toContain("<em>斜体</em>");
    expect(html).toContain('class="language-ts"');
    expect(html).toContain('data-lang="ts"');
    expect(html).toContain("<table>");
    expect(html).toContain('<a href="http://example.com">http</a>');
    expect(html).toContain('<a href="https://example.com">https</a>');
  });

  it("移除直接输入中的脚本、事件属性、危险协议和 iframe", () => {
    const html = sanitizeHtml(
      [
        '<script>alert(1)</script>',
        '<img src="x" onerror="alert(1)">',
        '<a href="javascript:alert(1)">x</a>',
        '<a href="data:text/html,<script>alert(3)</script>">data</a>',
        '<svg onload="alert(4)"><circle /></svg>',
        '<iframe src="https://evil.example"></iframe>',
      ].join("")
    );

    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/\sonerror\s*=/i);
    expect(html).not.toMatch(/\sonload\s*=/i);
    expect(html).not.toMatch(/href\s*=\s*["']?\s*javascript:/i);
    expect(html).not.toMatch(/href\s*=\s*["']?\s*data:text\/html/i);
    expect(html).not.toMatch(/<iframe\b/i);
  });

  it("移除 object/embed 嵌入标签", () => {
    // P0: src/lib/sanitize.ts:8
    // payload: <object data="https://evil.example"></object><embed src="https://evil.example">
    // actual: <object data="https://evil.example"></object><embed src="https://evil.example">
    const html = sanitizeHtml(
      '<object data="https://evil.example"></object><embed src="https://evil.example">'
    );

    expect(html).not.toMatch(/<object\b/i);
    expect(html).not.toMatch(/<embed\b/i);
  });

  it("剥离保留链接上的内联事件属性", () => {
    // P0: src/lib/sanitize.ts:8
    // payload: <a href="https://safe.example" onclick="alert(3)" onmouseover="alert(4)">safe</a>
    // actual: <a href="https://safe.example" onclick="alert(3)" onmouseover="alert(4)">safe</a>
    const html = sanitizeHtml(
      '<a href="https://safe.example" onclick="alert(3)" onmouseover="alert(4)">safe</a>'
    );

    expect(html).not.toMatch(/\sonclick\s*=/i);
    expect(html).not.toMatch(/\sonmouseover\s*=/i);
  });
});
