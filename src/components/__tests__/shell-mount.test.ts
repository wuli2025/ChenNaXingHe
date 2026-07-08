/**
 * C07 外壳组件挂载测试。
 * 用原生 createApp + Pinia 挂载核心外壳组件，后端与 agent runner 全部 mock。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App, type Component } from "vue";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import SideNav from "../SideNav.vue";
import ToastHost from "../ToastHost.vue";
import { useAppStore } from "../../stores/app";

vi.mock("../../tauri", () => ({
  isTauri: false,
  invoke: async () => null,
  convApi: {
    listProjects: async () => [],
    listConversations: async () => [],
    createProject: async (name: string) => ({ id: "p-test", name, created_at: 0, archived: false }),
    archiveProject: async () => undefined,
    openProjectDir: async () => undefined,
    createConversation: async (projectId: string) => ({
      id: "c-test",
      projectId,
      title: "测试对话",
      createdAt: 0,
      updatedAt: 0,
    }),
    deleteConversation: async () => undefined,
    archiveConversation: async () => undefined,
    renameConversation: async () => undefined,
    getMessages: async () => [],
  },
}));

vi.mock("../../composables/useAgentRunner", () => ({
  useAgentRunner: () => ({
    running: { value: false },
    run: async () => ({ raw: "MOCK" }),
    runJson: async () => ({ data: {}, raw: "{}" }),
  }),
}));

vi.mock("../../lib/markdown", () => ({
  renderMarkdown: (t: string) => `<p>${t}</p>`,
  mdVersion: { value: 0 },
}));

type MountedApp = { app: App<Element>; host: HTMLElement };
const mounted: MountedApp[] = [];

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  while (mounted.length) {
    const item = mounted.pop()!;
    item.app.unmount();
    item.host.remove();
  }
  document.body.innerHTML = "";
});

function mountComponent(comp: Component, pinia?: Pinia): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp(comp);
  app.config.warnHandler = () => {};
  if (pinia) app.use(pinia);
  app.mount(host);
  mounted.push({ app, host });
  return host;
}

async function mountSideNav() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const appStore = useAppStore(pinia);
  const host = mountComponent(SideNav, pinia);
  await nextTick();
  return { host, appStore };
}

async function click(el: Element) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await nextTick();
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
    .find((el) => el.textContent?.includes(text));
  expect(button, `button not found: ${text}`).toBeTruthy();
  return button!;
}

describe("C07 外壳组件挂载", () => {
  it("SideNav 可挂载并渲染工作台入口", async () => {
    const { host } = await mountSideNav();

    expect(host.innerHTML.length).toBeGreaterThan(200);
    expect(host.textContent).toContain("外贸 OS");
    expect(host.textContent).toContain("星河 ERP");
  });

  it("点击 ERP 入口后切换 app.moduleTab", async () => {
    const { host, appStore } = await mountSideNav();

    await click(buttonByText(host, "星河 ERP"));

    expect(appStore.moduleTab).toBe("erp");
  });

  it("moduleTab 切换时渲染对应子导航", async () => {
    const { host, appStore } = await mountSideNav();

    appStore.setModuleTab("erp");
    await nextTick();
    expect(host.textContent).toContain("审批中心");
    expect(host.textContent).not.toContain("人工审核看板");

    appStore.setModuleTab("trade");
    await nextTick();
    expect(host.textContent).toContain("人工审核看板");
    expect(host.textContent).not.toContain("审批中心");
  });

  it("侧栏收起时隐藏标签文本但保留图标", async () => {
    const { host, appStore } = await mountSideNav();

    appStore.sidebarCollapsed = true;
    await nextTick();

    expect(host.textContent).not.toContain("外贸 OS");
    expect(host.textContent).not.toContain("星河 ERP");
    expect(host.querySelectorAll("svg").length).toBeGreaterThan(0);
    expect(host.querySelectorAll("button.nav-item").length).toBeGreaterThanOrEqual(4);
  });

  it("ToastHost 可挂载为空队列宿主", async () => {
    const host = mountComponent(ToastHost);
    await nextTick();

    expect(host.querySelector(".toast-host")).toBeTruthy();
  });
});