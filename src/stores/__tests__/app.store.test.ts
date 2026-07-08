import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAppStore, type ModuleTab } from "../app";

const tauriMock = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(async () => () => {}),
  backendReady: vi.fn(() => false),
  convApi: {
    listProjects: vi.fn(async () => []),
    listConversations: vi.fn(async () => []),
    createProject: vi.fn(),
    archiveProject: vi.fn(),
    openProjectDir: vi.fn(),
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
    archiveConversation: vi.fn(),
    renameConversation: vi.fn(),
    getMessages: vi.fn(async () => []),
  },
  chat: {
    send: vi.fn(),
    cancel: vi.fn(),
  },
}));

vi.mock("../../tauri", () => ({
  isTauri: false,
  invoke: tauriMock.invoke,
  listen: tauriMock.listen,
  backendReady: tauriMock.backendReady,
  convApi: tauriMock.convApi,
  chat: tauriMock.chat,
}));

const THEME_KEY = "polaris.theme.v1";
const PINNED_KEY = "polaris.pinnedConvs.v1";
const SIDEBAR_W_KEY = "polaris.sidebarWidth.v1";
const CHAT_W_KEY = "polaris.chatDockWidth.v1";

describe("app store shell state", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    vi.clearAllMocks();
  });

  it("moduleTab defaults to trade and isNativeTab is the single source of truth", () => {
    const store = useAppStore();

    expect(store.moduleTab).toBe("trade");
    expect(store.isNativeTab).toBe(true);

    const cases: Array<[ModuleTab, boolean]> = [
      ["trade", true],
      ["erp", true],
      ["kb", false],
      ["skill", false],
    ];

    for (const [tab, expected] of cases) {
      store.setModuleTab(tab);
      expect(store.moduleTab).toBe(tab);
      expect(store.isNativeTab).toBe(expected);
    }
  });

  it("loads migrated/default themes and persists setTheme", () => {
    localStorage.setItem(THEME_KEY, "nougat");
    let store = useAppStore();
    expect(store.theme).toBe("aurora-light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("aurora-light");

    setActivePinia(createPinia());
    localStorage.setItem(THEME_KEY, "not-a-theme");
    store = useAppStore();
    expect(store.theme).toBe("aurora-light");

    store.setTheme("aurora-dark");
    expect(store.theme).toBe("aurora-dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("aurora-dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("aurora-dark");
  });

  it("clamps sidebar/chat dock widths and only persists when requested", () => {
    const store = useAppStore();

    store.setSidebarWidth(120, false);
    expect(store.sidebarWidth).toBe(200);
    expect(localStorage.getItem(SIDEBAR_W_KEY)).toBeNull();

    store.setSidebarWidth(900, true);
    expect(store.sidebarWidth).toBe(420);
    expect(localStorage.getItem(SIDEBAR_W_KEY)).toBe("420");

    localStorage.removeItem(CHAT_W_KEY);
    store.setChatDockWidth(120, false);
    expect(store.chatDockWidth).toBe(320);
    expect(localStorage.getItem(CHAT_W_KEY)).toBeNull();

    store.setChatDockWidth(1200, true);
    expect(store.chatDockWidth).toBe(960);
    expect(localStorage.getItem(CHAT_W_KEY)).toBe("960");
  });

  it("toggles pinned conversations without duplicates and persists the set", () => {
    const store = useAppStore();

    expect(store.isPinned("c-1")).toBe(false);

    store.togglePin("c-1");
    expect(store.isPinned("c-1")).toBe(true);
    expect([...store.pinnedConvs]).toEqual(["c-1"]);
    expect(JSON.parse(localStorage.getItem(PINNED_KEY)!)).toEqual(["c-1"]);

    store.togglePin("c-2");
    expect(store.isPinned("c-2")).toBe(true);
    expect(JSON.parse(localStorage.getItem(PINNED_KEY)!)).toEqual(["c-1", "c-2"]);

    store.togglePin("c-1");
    expect(store.isPinned("c-1")).toBe(false);
    expect(store.isPinned("c-2")).toBe(true);
    expect(JSON.parse(localStorage.getItem(PINNED_KEY)!)).toEqual(["c-2"]);

    store.togglePin("");
    expect(JSON.parse(localStorage.getItem(PINNED_KEY)!)).toEqual(["c-2"]);
  });

  it("marks and clears unread conversations but skips the current conversation", () => {
    const store = useAppStore();

    store.currentConvId = "current";
    store.markUnread("current");
    expect(store.unreadConvs.has("current")).toBe(false);

    store.markUnread("other");
    expect(store.unreadConvs.has("other")).toBe(true);

    store.clearUnread("other");
    expect(store.unreadConvs.has("other")).toBe(false);
  });

  it("tolerates corrupt localStorage during initialization", () => {
    localStorage.setItem(PINNED_KEY, "{bad json");
    localStorage.setItem(THEME_KEY, "{bad json");

    expect(() => useAppStore()).not.toThrow();
    const store = useAppStore();
    expect(store.theme).toBe("aurora-light");
    expect([...store.pinnedConvs]).toEqual([]);
  });
});
