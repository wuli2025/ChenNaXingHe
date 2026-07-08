import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type {
  ClaudeAuthStatus,
  CodexProxyInfo,
  CodexStatus,
  ProviderBalance,
  ProviderSaveInput,
  ProviderView,
  UsageSummary,
} from "../../tauri";

const h = vi.hoisted(() => {
  type AnyProvider = Record<string, any>;
  type AnyUsage = Record<string, any>;
  type AnyBalance = Record<string, any>;

  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

  function providerFixture(overrides: AnyProvider = {}): AnyProvider {
    const id = overrides.id ?? "claude-official";
    return {
      id,
      name: overrides.name ?? id,
      note: "",
      baseUrl: "https://api.example.com",
      tokenField: "ANTHROPIC_AUTH_TOKEN",
      category: "custom",
      websiteUrl: "",
      color: "#64748b",
      kind: "key",
      isPreset: false,
      hasKey: true,
      authToken: "sk-test",
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: "https://api.example.com",
          ANTHROPIC_AUTH_TOKEN: "sk-test",
        },
      },
      ...overrides,
    };
  }

  function usageFixture(overrides: AnyUsage = {}): AnyUsage {
    const bucket = {
      input: 100,
      output: 50,
      cacheRead: 20,
      cacheCreation: 10,
      total: 180,
      requests: 3,
      cost: 1.25,
    };
    return {
      available: true,
      today: { ...bucket },
      week: { ...bucket, input: 300, total: 520, requests: 9, cost: 3.5 },
      month: { ...bucket, input: 700, total: 1230, requests: 20, cost: 8.75 },
      year: { ...bucket, input: 1000, total: 1800, requests: 30, cost: 12.5 },
      daily: [
        { date: "2026-07-06", label: "7/6", total: 90, cost: 0.6 },
        { date: "2026-07-07", label: "7/7", total: 180, cost: 1.25 },
      ],
      ...overrides,
    };
  }

  function balanceFixture(overrides: AnyBalance = {}): AnyBalance {
    return {
      id: overrides.id ?? "openai-compatible",
      available: true,
      kind: "balance",
      label: "$42.00",
      detail: "mock balance",
      consoleUrl: "https://console.example.com",
      ...overrides,
    };
  }

  function defaultProviders(): AnyProvider[] {
    return [
      providerFixture({
        id: "claude-official",
        name: "Claude Official",
        category: "official",
        kind: "official",
        isPreset: true,
      }),
      providerFixture({
        id: "openai-compatible",
        name: "OpenAI Compatible",
        baseUrl: "https://openai.example.com/v1",
      }),
      providerFixture({ id: "codex-local", name: "Codex", kind: "codex" }),
      providerFixture({ id: "github-copilot", name: "Copilot", kind: "copilot" }),
      providerFixture({ id: "no-key", name: "No Key", hasKey: false, authToken: "" }),
    ];
  }

  const state: {
    providers: AnyProvider[];
    currentId: string;
    linkGlobal: boolean;
    usage: AnyUsage;
    balances: Record<string, AnyBalance>;
    codex: Record<string, any>;
    codexProxy: Record<string, any>;
    claudeAuth: Record<string, any>;
    pollStatus: "pending" | "ok";
    fail: Record<string, unknown>;
    listGate: Promise<unknown> | null;
    switchGate: Promise<unknown> | null;
    nextGeneratedId: number;
  } = {
    providers: defaultProviders(),
    currentId: "claude-official",
    linkGlobal: false,
    usage: usageFixture(),
    balances: {
      "claude-official": balanceFixture({ id: "claude-official", label: "official active", kind: "alive" }),
      "openai-compatible": balanceFixture({ id: "openai-compatible", label: "$42.00" }),
    },
    codex: { installed: true, loggedIn: false, authPath: "C:/mock/codex/auth.json" },
    codexProxy: { running: true, port: 17888, lastError: "" },
    claudeAuth: { loggedIn: false, credPath: "C:/mock/claude/.credentials.json" },
    pollStatus: "pending",
    fail: {},
    listGate: null,
    switchGate: null,
    nextGeneratedId: 1,
  };

  function generatedId(input: AnyProvider): string {
    if (input.id !== undefined) return String(input.id);
    const slug = String(input.name ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return slug || `provider-${state.nextGeneratedId++}`;
  }

  const provider = {
    list: vi.fn(async () => {
      if (state.listGate) {
        const gate = state.listGate;
        state.listGate = null;
        await gate;
      }
      if (state.fail.list) throw state.fail.list;
      return clone({
        providers: state.providers,
        currentId: state.currentId,
        linkGlobal: state.linkGlobal,
      });
    }),
    switch: vi.fn(async (id: string) => {
      if (state.switchGate) {
        const gate = state.switchGate;
        state.switchGate = null;
        await gate;
      }
      if (state.fail.switch) throw state.fail.switch;
      if (!id) throw new Error("empty provider id");
      if (!state.providers.some((p) => p.id === id)) throw new Error(`provider not found: ${id}`);
      state.currentId = id;
      return id;
    }),
    setLinkMode: vi.fn(async (link: boolean) => {
      if (state.fail.setLinkMode) throw state.fail.setLinkMode;
      state.linkGlobal = link;
      return link;
    }),
    save: vi.fn(async (input: AnyProvider) => {
      if (state.fail.save) throw state.fail.save;
      const id = generatedId(input);
      if (!id) throw new Error("empty provider id");
      const idx = state.providers.findIndex((p) => p.id === id);
      const previous = idx >= 0 ? state.providers[idx] : {};
      const env = input.settingsConfig?.env ?? {};
      const tokenField =
        input.tokenField ??
        Object.keys(env).find((k) => k.includes("TOKEN") || k.includes("KEY")) ??
        previous.tokenField ??
        "ANTHROPIC_AUTH_TOKEN";
      const authToken = env[tokenField] ?? env.ANTHROPIC_AUTH_TOKEN ?? env.OPENAI_API_KEY ?? "";
      const next = providerFixture({
        ...previous,
        id,
        name: input.name,
        note: input.note ?? previous.note ?? "",
        websiteUrl: input.websiteUrl ?? previous.websiteUrl ?? "",
        tokenField,
        settingsConfig: input.settingsConfig,
        baseUrl: env.ANTHROPIC_BASE_URL ?? env.OPENAI_BASE_URL ?? previous.baseUrl ?? "",
        authToken,
        hasKey: Boolean(authToken || previous.hasKey),
      });
      if (idx >= 0) state.providers.splice(idx, 1, next);
      else state.providers.push(next);
      return id;
    }),
    delete: vi.fn(async (id: string) => {
      if (state.fail.delete) throw state.fail.delete;
      if (!id) throw new Error("empty provider id");
      state.providers = state.providers.filter((p) => p.id !== id);
      if (state.currentId === id) state.currentId = state.providers[0]?.id ?? "";
    }),
    usage: vi.fn(async () => {
      if (state.fail.usage) throw state.fail.usage;
      return clone(state.usage);
    }),
    balance: vi.fn(async (id: string) => {
      if (state.fail.balance) throw state.fail.balance;
      if (!id) throw new Error("empty provider id");
      return clone(
        state.balances[id] ??
          balanceFixture({
            id,
            available: false,
            kind: "unsupported",
            label: "unsupported",
            detail: "no mock balance",
            consoleUrl: "",
          })
      );
    }),
    codexStatus: vi.fn(async () => {
      if (state.fail.codexStatus) throw state.fail.codexStatus;
      return clone(state.codex);
    }),
    codexStartLogin: vi.fn(async () => {
      if (state.fail.codexStartLogin) throw state.fail.codexStartLogin;
      return {
        deviceCode: "dev-123",
        userCode: "USER-123",
        verificationUri: "https://login.example.com/device",
        interval: 5,
        expiresIn: 600,
      };
    }),
    codexPollLogin: vi.fn(async (deviceCode: string, userCode: string) => {
      if (state.fail.codexPollLogin) throw state.fail.codexPollLogin;
      if (!deviceCode || !userCode) throw new Error("missing device login code");
      return { status: state.pollStatus };
    }),
    codexProxyInfo: vi.fn(async () => {
      if (state.fail.codexProxyInfo) throw state.fail.codexProxyInfo;
      return clone(state.codexProxy);
    }),
    claudeAuthStatus: vi.fn(async () => {
      if (state.fail.claudeAuthStatus) throw state.fail.claudeAuthStatus;
      return clone(state.claudeAuth);
    }),
    claudeStartLogin: vi.fn(async () => {
      if (state.fail.claudeStartLogin) throw state.fail.claudeStartLogin;
      return {
        authorizeUrl: "https://claude.example.com/oauth",
        verifier: "verifier-123",
        state: "state-123",
      };
    }),
    claudeFinishLogin: vi.fn(async (pasted: string, verifier: string, oauthState: string) => {
      if (state.fail.claudeFinishLogin) throw state.fail.claudeFinishLogin;
      if (!pasted || !verifier || !oauthState) throw new Error("missing oauth input");
      state.claudeAuth = { loggedIn: true, credPath: "C:/mock/claude/.credentials.json" };
      return clone(state.claudeAuth);
    }),
  };

  function reset() {
    state.providers = defaultProviders();
    state.currentId = "claude-official";
    state.linkGlobal = false;
    state.usage = usageFixture();
    state.balances = {
      "claude-official": balanceFixture({ id: "claude-official", label: "official active", kind: "alive" }),
      "openai-compatible": balanceFixture({ id: "openai-compatible", label: "$42.00" }),
    };
    state.codex = { installed: true, loggedIn: false, authPath: "C:/mock/codex/auth.json" };
    state.codexProxy = { running: true, port: 17888, lastError: "" };
    state.claudeAuth = { loggedIn: false, credPath: "C:/mock/claude/.credentials.json" };
    state.pollStatus = "pending";
    state.fail = {};
    state.listGate = null;
    state.switchGate = null;
    state.nextGeneratedId = 1;
    Object.values(provider).forEach((fn: any) => fn.mockClear());
  }

  return { state, provider, reset, providerFixture, usageFixture, balanceFixture };
});

vi.mock("../../tauri", () => ({
  provider: h.provider,
}));

import { useProvidersStore } from "../providers";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  h.reset();
});

describe("providers store · 初始状态与读取", () => {
  it("初始状态只来自 store 默认值，且 current getter 对空列表返回 null", () => {
    const store = useProvidersStore();

    expect(store.providers).toEqual([]);
    expect(store.currentId).toBe("claude-official");
    expect(store.current).toBeNull();
    expect(store.linkGlobal).toBe(false);
    expect(store.usage).toBeNull();
    expect(store.balances).toEqual({});
    expect(store.balanceBusy).toEqual({});
    expect(store.codex).toBeNull();
    expect(store.codexProxy).toBeNull();
    expect(store.claudeAuth).toBeNull();
    expect(store.loading).toBe(false);
    expect(store.switching).toBeNull();
    expect(store.error).toBeNull();
    expect(store.showAddModal).toBe(false);
    expect(store.addTarget).toBeNull();
    expect(store.showUsageBoard).toBe(false);
  });

  it("openAdd/closeAdd 只维护公开弹窗状态，不触发后端", () => {
    const store = useProvidersStore();
    const target = h.providerFixture({ id: "preset", name: "Preset" }) as ProviderView;

    store.openAdd(target);
    expect(store.showAddModal).toBe(true);
    expect(store.addTarget).toMatchObject({ id: "preset", name: "Preset" });

    store.closeAdd();
    expect(store.showAddModal).toBe(false);
    expect(store.addTarget).toBeNull();
    expect(h.provider.list).not.toHaveBeenCalled();
  });

  it("refresh 加载供应商、当前选择和联动模式，并维护 loading 状态", async () => {
    const store = useProvidersStore();
    const gate = deferred();
    h.state.listGate = gate.promise;

    const pending = store.refresh();
    expect(store.loading).toBe(true);
    gate.resolve();
    await pending;

    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
    expect(store.providers.map((p: ProviderView) => p.id)).toContain("openai-compatible");
    expect(store.currentId).toBe("claude-official");
    expect(store.current?.name).toBe("Claude Official");
    expect(store.linkGlobal).toBe(false);
    expect(h.provider.list).toHaveBeenCalledTimes(1);
  });

  it("localStorage 损坏不影响 provider store 初始化和后端刷新", async () => {
    localStorage.setItem("cnxh.providers.v1", "{bad json");
    localStorage.setItem("providers", "not-json");
    const store = useProvidersStore();

    await expect(store.refresh()).resolves.toBeUndefined();

    expect(store.providers.length).toBeGreaterThan(0);
    expect(store.current?.id).toBe("claude-official");
    expect(localStorage.getItem("cnxh.providers.v1")).toBe("{bad json");
  });
});

describe("providers store · 增删改与当前供应商", () => {
  it("save 新增和编辑后会 refresh，mock 后端状态可被新 store 读回", async () => {
    const store = useProvidersStore();
    await store.refresh();

    const input: ProviderSaveInput = {
      id: "custom-one",
      name: "Custom One",
      note: "first version",
      websiteUrl: "https://custom.example.com",
      tokenField: "OPENAI_API_KEY",
      settingsConfig: {
        env: {
          OPENAI_BASE_URL: "https://custom.example.com/v1",
          OPENAI_API_KEY: "sk-custom",
        },
      },
    };
    await expect(store.save(input)).resolves.toBe("custom-one");
    expect(store.providers.find((p: ProviderView) => p.id === "custom-one")).toMatchObject({
      name: "Custom One",
      note: "first version",
      baseUrl: "https://custom.example.com/v1",
      hasKey: true,
    });

    await expect(
      store.save({
        ...input,
        name: "Custom One Edited",
        note: "edited",
        settingsConfig: {
          env: {
            OPENAI_BASE_URL: "https://custom.example.com/v2",
            OPENAI_API_KEY: "sk-custom-2",
          },
        },
      })
    ).resolves.toBe("custom-one");
    expect(store.providers.filter((p: ProviderView) => p.id === "custom-one")).toHaveLength(1);
    expect(store.providers.find((p: ProviderView) => p.id === "custom-one")).toMatchObject({
      name: "Custom One Edited",
      note: "edited",
      baseUrl: "https://custom.example.com/v2",
    });

    setActivePinia(createPinia());
    const restored = useProvidersStore();
    await restored.refresh();
    expect(restored.providers.find((p: ProviderView) => p.id === "custom-one")?.name).toBe("Custom One Edited");
  });

  it("remove 删除当前 provider 后 refresh 到后端给出的新 current", async () => {
    const store = useProvidersStore();
    await store.refresh();
    await store.save({
      id: "temporary",
      name: "Temporary",
      settingsConfig: { env: { ANTHROPIC_AUTH_TOKEN: "sk-temp" } },
    });
    await store.switchTo("temporary");
    expect(store.current?.id).toBe("temporary");

    await store.remove("temporary");

    expect(store.providers.some((p: ProviderView) => p.id === "temporary")).toBe(false);
    expect(store.currentId).toBe("claude-official");
    expect(store.current?.id).toBe("claude-official");
    expect(h.provider.delete).toHaveBeenCalledWith("temporary");
  });

  it("switchTo 成功时只在后端切换成功后更新 currentId，并在失败时保持原选择", async () => {
    const store = useProvidersStore();
    await store.refresh();
    const gate = deferred();
    h.state.switchGate = gate.promise;

    const pending = store.switchTo("openai-compatible");
    expect(store.switching).toBe("openai-compatible");
    expect(store.currentId).toBe("claude-official");
    gate.resolve();
    await expect(pending).resolves.toBe(true);

    expect(store.switching).toBeNull();
    expect(store.error).toBeNull();
    expect(store.currentId).toBe("openai-compatible");
    expect(store.current?.id).toBe("openai-compatible");

    h.state.fail.switch = new Error("missing api key");
    await expect(store.switchTo("no-key")).resolves.toBe(false);
    expect(store.currentId).toBe("openai-compatible");
    expect(store.current?.id).toBe("openai-compatible");
    expect(store.switching).toBeNull();
    expect(store.error).toContain("missing api key");
  });

  it("setLinkMode 成功同步 linkGlobal，失败时返回 false 并保留原值", async () => {
    const store = useProvidersStore();
    await store.refresh();

    await expect(store.setLinkMode(true)).resolves.toBe(true);
    expect(store.linkGlobal).toBe(true);
    expect(h.provider.setLinkMode).toHaveBeenCalledWith(true);

    h.state.fail.setLinkMode = new Error("settings not writable");
    await expect(store.setLinkMode(false)).resolves.toBe(false);
    expect(store.linkGlobal).toBe(true);
    expect(store.error).toContain("settings not writable");
  });
});

describe("providers store · 用量与额度", () => {
  it("refreshUsage 和 openUsage 使用后端 UsageSummary 口径，不在 store 内二次改写", async () => {
    const store = useProvidersStore();
    h.state.usage = h.usageFixture({
      today: {
        input: 11,
        output: 7,
        cacheRead: 5,
        cacheCreation: 3,
        total: 26,
        requests: 4,
        cost: 0.52,
      },
    }) as UsageSummary;

    await store.refreshUsage();
    expect(store.usage?.today).toEqual({
      input: 11,
      output: 7,
      cacheRead: 5,
      cacheCreation: 3,
      total: 26,
      requests: 4,
      cost: 0.52,
    });
    expect(store.usage?.daily.map((d) => d.total)).toEqual([90, 180]);

    store.usage = null;
    store.openUsage();
    expect(store.showUsageBoard).toBe(true);
    await vi.waitFor(() => expect(store.usage?.today.total).toBe(26));
    store.closeUsage();
    expect(store.showUsageBoard).toBe(false);
  });

  it("refreshBalance 处理成功、失败和空 id；busy 标志最终清理", async () => {
    const store = useProvidersStore();

    await expect(store.refreshBalance("")).resolves.toBeNull();
    expect(h.provider.balance).not.toHaveBeenCalled();

    const pending = store.refreshBalance("openai-compatible");
    expect(store.balanceBusy["openai-compatible"]).toBe(true);
    await expect(pending).resolves.toMatchObject({
      id: "openai-compatible",
      available: true,
      label: "$42.00",
    });
    expect(store.balances["openai-compatible"]).toMatchObject({ label: "$42.00" });
    expect(store.balanceBusy["openai-compatible"]).toBeUndefined();

    h.state.fail.balance = new Error("balance api down");
    await expect(store.refreshBalance("broken-provider")).resolves.toMatchObject({
      id: "broken-provider",
      available: false,
      kind: "error",
      label: "查询失败",
    } as Partial<ProviderBalance>);
    expect(store.balances["broken-provider"].detail).toContain("balance api down");
    expect(store.balanceBusy["broken-provider"]).toBeUndefined();
  });

  it("refreshConfiguredBalances 只查询 hasKey 且非 codex/copilot 的 provider", async () => {
    const store = useProvidersStore();
    h.state.providers = [
      h.providerFixture({ id: "key-a", kind: "key", hasKey: true }),
      h.providerFixture({ id: "official-key", kind: "official", hasKey: true }),
      h.providerFixture({ id: "codex-key", kind: "codex", hasKey: true }),
      h.providerFixture({ id: "copilot-key", kind: "copilot", hasKey: true }),
      h.providerFixture({ id: "keyless", kind: "key", hasKey: false }),
    ];

    await store.refresh();
    await store.refreshConfiguredBalances();

    expect(h.provider.balance).toHaveBeenCalledTimes(2);
    expect(h.provider.balance).toHaveBeenNthCalledWith(1, "key-a");
    expect(h.provider.balance).toHaveBeenNthCalledWith(2, "official-key");
    expect(Object.keys(store.balances).sort()).toEqual(["key-a", "official-key"]);
  });
});

describe("providers store · Codex 与 Claude 授权 action", () => {
  it("Codex 状态、代理、Device Code 登录和 ok 轮询都走 provider API", async () => {
    const store = useProvidersStore();

    await store.refreshCodex();
    expect(store.codex).toEqual({
      installed: true,
      loggedIn: false,
      authPath: "C:/mock/codex/auth.json",
    } satisfies CodexStatus);

    await store.refreshCodexProxy();
    expect(store.codexProxy).toEqual({
      running: true,
      port: 17888,
      lastError: "",
    } satisfies CodexProxyInfo);

    await expect(store.codexStartLogin()).resolves.toMatchObject({
      deviceCode: "dev-123",
      userCode: "USER-123",
    });

    await expect(store.codexPollLogin("dev-123", "USER-123")).resolves.toBe("pending");
    expect(h.provider.codexStatus).toHaveBeenCalledTimes(1);

    h.state.pollStatus = "ok";
    h.state.codex = { installed: true, loggedIn: true, authPath: "C:/mock/codex/auth.json" };
    await expect(store.codexPollLogin("dev-123", "USER-123")).resolves.toBe("ok");
    expect(store.codex?.loggedIn).toBe(true);
    expect(h.provider.codexStatus).toHaveBeenCalledTimes(2);
  });

  it("Claude OAuth 状态、开始登录和完成登录会写回 claudeAuth", async () => {
    const store = useProvidersStore();

    await store.refreshClaudeAuth();
    expect(store.claudeAuth).toEqual({
      loggedIn: false,
      credPath: "C:/mock/claude/.credentials.json",
    } satisfies ClaudeAuthStatus);

    await expect(store.claudeStartLogin()).resolves.toMatchObject({
      authorizeUrl: "https://claude.example.com/oauth",
      verifier: "verifier-123",
      state: "state-123",
    });

    await expect(store.claudeFinishLogin("code=ok", "verifier-123", "state-123")).resolves.toBe(true);
    expect(store.claudeAuth).toEqual({
      loggedIn: true,
      credPath: "C:/mock/claude/.credentials.json",
    } satisfies ClaudeAuthStatus);
  });
});

describe("providers store · 异常输入防御", () => {
  it("空 id、重复 id 和删除不存在项不抛出，并通过公开 error 暴露失败", async () => {
    const store = useProvidersStore();
    await store.refresh();
    const originalIds = store.providers.map((p: ProviderView) => p.id);

    await expect(store.switchTo("")).resolves.toBe(false);
    expect(store.currentId).toBe("claude-official");
    expect(store.error).toContain("empty provider id");

    h.state.fail.save = new Error("duplicate provider id");
    await expect(
      store.save({
        id: "openai-compatible",
        name: "Duplicate",
        settingsConfig: { env: { ANTHROPIC_AUTH_TOKEN: "sk-duplicate" } },
      })
    ).resolves.toBeNull();
    expect(store.providers.map((p: ProviderView) => p.id)).toEqual(originalIds);
    expect(store.error).toContain("duplicate provider id");

    h.state.fail.save = undefined;
    await expect(store.remove("does-not-exist")).resolves.toBeUndefined();
    expect(store.error).toBeNull();
    expect(store.providers.map((p: ProviderView) => p.id)).toEqual(originalIds);
  });
});
