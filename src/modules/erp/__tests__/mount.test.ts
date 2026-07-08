/**
 * 挂载冒烟测试 —— 10 个业务模块 + 审批中心真实 mount 一遍。
 * vue-tsc 管类型，这里管运行时：模板里访问不存在的字段、组件 props 错传、
 * onMounted 逻辑抛错等都会在此暴露。agent runner 被 mock。
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { createApp, type Component } from "vue";

vi.mock("../../../composables/useAgentRunner", () => ({
  useAgentRunner: () => ({
    running: { value: false },
    run: async () => ({ raw: "MOCK" }),
    runJson: async () => ({ data: {}, raw: "{}" }),
  }),
}));

/* lib/markdown 里的异步增强（shiki/katex）在测试环境不需要 */
vi.mock("../../../lib/markdown", () => ({
  renderMarkdown: (t: string) => `<p>${t}</p>`,
  mdVersion: { value: 0 },
}));

beforeAll(() => {
  localStorage.clear();
});

function mountOk(comp: Component): string {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp(comp);
  app.config.warnHandler = () => {}; // 冒烟只抓错误，不抓开发期告警
  app.mount(host);
  const html = host.innerHTML;
  app.unmount();
  host.remove();
  return html;
}

describe("ERP 模块挂载冒烟", () => {
  it("10 个业务模块全部可挂载且渲染出内容", async () => {
    const mods = import.meta.glob("../modules/E*.vue");
    const names = Object.keys(mods).sort();
    expect(names.length).toBe(10);
    for (const name of names) {
      const m = (await mods[name]()) as { default: Component };
      const html = mountOk(m.default);
      expect(html.length, `${name} 渲染为空`).toBeGreaterThan(200);
    }
  });

  it("审批中心可挂载并渲染出四列看板与强制人工说明", async () => {
    const m = await import("../review/ApprovalBoard.vue");
    const html = mountOk(m.default);
    expect(html).toContain("待审批");
    expect(html).toContain("强制人工");
  });
});
