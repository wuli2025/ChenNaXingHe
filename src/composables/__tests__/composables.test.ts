import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, type App as VueApp } from "vue";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  uploadToBackend: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
  onDragDropEvent: vi.fn(),
}));

vi.mock("../../tauri", () => ({
  isTauri: false,
  uploadToBackend: mocks.uploadToBackend,
  invoke: mocks.invoke,
  listen: mocks.listen,
  backendReady: () => true,
  chat: {
    send: vi.fn(),
    cancel: vi.fn(),
    buildManifest: vi.fn(),
    attachFiles: vi.fn(),
    attachImage: vi.fn(),
  },
  convApi: {
    listProjects: vi.fn(async () => []),
    createProject: vi.fn(async (name: string) => ({
      id: `p-${name}`,
      name,
      createdAt: 0,
      archived: false,
    })),
    archiveProject: vi.fn(async () => undefined),
    openProjectDir: vi.fn(async () => undefined),
    listConversations: vi.fn(async () => []),
    createConversation: vi.fn(async (projectId: string) => ({
      id: "c-test",
      projectId,
      title: "新对话",
      createdAt: 0,
      updatedAt: 0,
    })),
    deleteConversation: vi.fn(async () => undefined),
    archiveConversation: vi.fn(async () => undefined),
    distillConversation: vi.fn(async () => undefined),
    renameConversation: vi.fn(async () => undefined),
    getMessages: vi.fn(async () => []),
    setKbScope: vi.fn(async () => undefined),
  },
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: mocks.onDragDropEvent,
  }),
}));

import { toast, useToastQueue } from "../useToast";
import { usePolling, type PollingHandle } from "../usePolling";
import { useFileDrop, type UseFileDropOptions } from "../useFileDrop";
import { humanizeError } from "../../lib/humanizeError";
import { useAppStore, type ModuleTab } from "../../stores/app";

interface Mounted<T> {
  app: VueApp<Element>;
  host: HTMLDivElement;
  result: T;
  unmount: () => void;
}

function mountSetup<T>(factory: () => T): Mounted<T> {
  let result!: T;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp(
    defineComponent({
      setup() {
        result = factory();
        return () => h("div");
      },
    })
  );
  app.mount(host);
  return {
    app,
    host,
    result,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

function resetToastQueue() {
  const { items } = useToastQueue();
  items.value.splice(0, items.value.length);
}

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
}

function makeDragEvent(type: string, files: File[] = [new File(["a"], "a.txt")]) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", {
    configurable: true,
    value: {
      types: ["Files"],
      files,
    },
  });
  Object.defineProperty(event, "relatedTarget", {
    configurable: true,
    value: null,
  });
  return event;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  resetToastQueue();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllTimers();
    resetToastQueue();
  });

  it("success/error/info 入队并保留 kind、文本、默认 duration", () => {
    const { items } = useToastQueue();

    toast.success(" 保存成功 ");
    toast.error("保存失败");
    toast.info("处理中");

    expect(items.value.map((item) => item.kind)).toEqual(["success", "error", "info"]);
    expect(items.value.map((item) => item.text)).toEqual([
      "保存成功",
      "保存失败",
      "处理中",
    ]);
    expect(items.value.map((item) => item.duration)).toEqual([2600, 6000, 2600]);
  });

  it("按 duration 自动过期移除", () => {
    const { items } = useToastQueue();

    toast.success("短提示", 1000);

    expect(items.value).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(items.value).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(items.value).toHaveLength(0);
  });

  it("并发多条保持顺序，超过 4 条时移除最旧项", () => {
    const { items } = useToastQueue();

    for (const text of ["一", "二", "三", "四", "五"]) {
      toast.info(text, 5000);
    }

    expect(items.value.map((item) => item.text)).toEqual(["二", "三", "四", "五"]);
    vi.advanceTimersByTime(5000);
    expect(items.value).toHaveLength(0);
  });

  it("相同 kind 和最终展示文案去重，不同 kind 可并存", () => {
    const { items } = useToastQueue();
    const long = `${"甲".repeat(260)}-尾部差异`;

    toast.error("重复");
    toast.error("重复");
    toast.success("重复");
    toast.info(long);
    toast.info(`${"甲".repeat(260)}-另一个尾部`);

    expect(items.value.map((item) => `${item.kind}:${item.text}`)).toEqual([
      "error:重复",
      "success:重复",
      `info:${"甲".repeat(240)}…`,
    ]);
  });
});

describe("usePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllTimers();
    setDocumentHidden(false);
  });

  it("start 立即触发一次，并按间隔继续触发", () => {
    const fn = vi.fn();
    let handle!: PollingHandle;
    const mounted = mountSetup(() => {
      handle = usePolling(fn, 1000);
      return handle;
    });

    handle.start();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(handle.active).toBe(true);

    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(4);

    mounted.unmount();
  });

  it("start 幂等，不重复创建 interval 或立即重复触发", () => {
    const fn = vi.fn();
    let handle!: PollingHandle;
    const mounted = mountSetup(() => {
      handle = usePolling(fn, 1000);
      return handle;
    });

    handle.start();
    handle.start();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    mounted.unmount();
  });

  it("stop 后清理 interval 且不再触发", () => {
    const fn = vi.fn();
    let handle!: PollingHandle;
    const mounted = mountSetup(() => {
      handle = usePolling(fn, 500);
      return handle;
    });

    handle.start();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(3);

    handle.stop();
    expect(handle.active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(3);

    mounted.unmount();
  });

  it("组件卸载时清定时器，卸载后不泄漏触发", () => {
    const fn = vi.fn();
    let handle!: PollingHandle;
    const mounted = mountSetup(() => {
      handle = usePolling(fn, 250);
      return handle;
    });

    handle.start();
    expect(vi.getTimerCount()).toBe(1);
    mounted.unmount();

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("页面隐藏时暂停 interval，恢复可见时立即补拉一次", () => {
    const fn = vi.fn();
    let handle!: PollingHandle;
    setDocumentHidden(true);
    const mounted = mountSetup(() => {
      handle = usePolling(fn, 1000);
      return handle;
    });

    handle.start();
    expect(handle.active).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    setDocumentHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fn).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);

    mounted.unmount();
  });
});

describe("humanizeError", () => {
  it("Error 对象映射为可行动的中文提示", () => {
    expect(humanizeError(new Error("invalid api key"))).toContain("API 密钥无效");
  });

  it("字符串网络错误映射为中文网络提示", () => {
    expect(humanizeError("Failed to fetch")).toContain("网络连接失败");
  });

  it("带 code 和 message 的对象不抛，并按 message 识别常见错误", () => {
    expect(() =>
      humanizeError({ code: "EACCES", message: "permission denied" })
    ).not.toThrow();
    expect(humanizeError({ code: "EACCES", message: "permission denied" })).toContain(
      "没有权限"
    );
  });

  it("服务端 5xx 错误返回中文重试提示", () => {
    expect(humanizeError("HTTP 502 bad gateway")).toContain("服务端暂时不可用");
  });

  it("null/undefined 返回兜底中文提示且不抛", () => {
    expect(() => humanizeError(null)).not.toThrow();
    expect(() => humanizeError(undefined)).not.toThrow();
    expect(humanizeError(null)).toBe("操作失败,请稍后重试。");
    expect(humanizeError(undefined)).toBe("操作失败,请稍后重试。");
  });

  it("code-only 对象应读取 code 字段，而不是返回 [object Object]", () => {
    // 已修复：humanizeError 现在会读取 .code，{ code: "ECONNREFUSED" } 能命中网络错误映射。
    expect(humanizeError({ code: "ECONNREFUSED" })).toContain("网络连接失败");
  });
});

describe("useFileDrop", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    mocks.uploadToBackend.mockReset();
    mocks.uploadToBackend.mockResolvedValue([
      { name: "a.txt", path: "/server/uploads/a.txt", size: 1 },
    ]);
  });

  it("active 为 false 时不认领拖拽事件，也不上传", async () => {
    const onDrop = vi.fn();
    const mounted = mountSetup(() =>
      useFileDrop({
        active: () => false,
        onDrop,
      })
    );
    await nextTick();

    const over = makeDragEvent("dragover");
    document.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    expect(mounted.result.isOver.value).toBe(false);

    document.dispatchEvent(makeDragEvent("drop"));
    await flushPromises();
    expect(mocks.uploadToBackend).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();

    mounted.unmount();
  });

  it("用 app store 构造知识库落区：仅 moduleTab=kb 时认领并回传服务端路径", async () => {
    const app = useAppStore();
    const onDrop = vi.fn();
    const mounted = mountSetup(() =>
      useFileDrop({
        active: () => app.moduleTab === "kb",
        onDrop,
      })
    );
    await nextTick();

    app.setModuleTab("trade");
    document.dispatchEvent(makeDragEvent("dragover"));
    expect(mounted.result.isOver.value).toBe(false);

    app.setModuleTab("kb");
    const over = makeDragEvent("dragover");
    document.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(mounted.result.isOver.value).toBe(true);

    document.dispatchEvent(makeDragEvent("dragleave"));
    expect(mounted.result.isOver.value).toBe(false);

    document.dispatchEvent(makeDragEvent("drop"));
    await flushPromises();
    expect(mocks.uploadToBackend).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(["/server/uploads/a.txt"]);
    expect(mounted.result.isOver.value).toBe(false);

    mounted.unmount();
  });

  it("卸载后退订 document 级拖拽监听", async () => {
    const onDrop = vi.fn();
    const mounted = mountSetup(() =>
      useFileDrop({
        onDrop,
      } satisfies UseFileDropOptions)
    );
    await nextTick();
    mounted.unmount();

    document.dispatchEvent(makeDragEvent("drop"));
    await flushPromises();
    expect(mocks.uploadToBackend).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
  });

  // 现状契约（非缺陷）：ChatPanel 的落区谓词 chatOpen && !isNativeTab && !==kb && !==skill
  // 在当前四个 ModuleTab（trade/erp 属原生自带落区，kb/skill 由各自视图处理落区）下恒为 false，
  // 即 ChatPanel 不在任何当前主区 tab 认领窗口级文件落区。这是 tab 改版以来的既有设计意图
  // （原 trade|kb|skill 三值也全排除），非本次引入的回归。若未来要在某 tab 支持向对话拖文件，
  // 需产品明确该 tab 与其自身落区处理的关系后再放开。此测试锁定当前契约，防止无意改动。
  it("ChatPanel 落区谓词在当前所有 ModuleTab 下不认领（既有设计契约，待产品决策）", () => {
    const app = useAppStore();
    app.openChat();
    const tabs: ModuleTab[] = ["trade", "erp", "kb", "skill"];
    const anyClaim = tabs.some((tab) => {
      app.setModuleTab(tab);
      return (
        app.chatOpen &&
        !app.isNativeTab &&
        app.moduleTab !== "kb" &&
        app.moduleTab !== "skill"
      );
    });
    expect(anyClaim).toBe(false);
  });
});

