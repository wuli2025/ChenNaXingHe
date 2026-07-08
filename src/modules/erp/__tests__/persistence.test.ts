/**
 * T4 持久化往返测试：localStorage 原文、重建 store、种子幂等与老参数合并。
 * agent runner 被 mock，测试只覆盖 ERP store 的确定性本地状态。
 */
import { describe, it, expect, vi } from "vitest";
import { nextTick } from "vue";
import { DEFAULT_PARAMS, ELS } from "../types";

const h = vi.hoisted(() => ({
  calls: [] as { fn: "run" | "runJson"; prompt: string }[],
}));

vi.mock("../../../composables/useAgentRunner", () => ({
  useAgentRunner: () => ({
    running: { value: false },
    run: async (opts: { prompt: string }) => {
      h.calls.push({ fn: "run", prompt: opts.prompt });
      return { raw: "MOCK-TEXT" };
    },
    runJson: async (opts: { prompt: string }) => {
      h.calls.push({ fn: "runJson", prompt: opts.prompt });
      return { data: {}, raw: "{}" };
    },
  }),
}));

async function rebuildStore() {
  vi.resetModules();
  const mod = await import("../useErpStore");
  return mod.useErpStore();
}

async function freshStore() {
  localStorage.clear();
  h.calls.length = 0;
  return rebuildStore();
}

async function flushPersist() {
  await nextTick();
  await Promise.resolve();
}

function parseLs<T = any>(key: string): T {
  const raw = localStorage.getItem(key);
  expect(raw, `${key} should be persisted`).toBeTruthy();
  return JSON.parse(raw!);
}

describe("ERP 持久化 · T4", () => {
  it("round-trip：业务对象落 localStorage 原文后，重建 store 关键字段深比较无损", async () => {
    const store = await freshStore();

    store.products.value.unshift({
      id: "P-RT", name: "往返测试品", nameEn: "Round Trip Item", category: "测试",
      state: "candidate", costCny: 12.5, shipUsd: 2.3, priceUsd: 18.88, rivalUsd: 19.99,
      monthlySales: 7, marginPct: 26.4, score: 73, reason: "持久化 round-trip",
      provenance: "user", hsCode: "9503.00.00", platforms: ["Amazon US", "Temu"],
    });
    const card = store.prices.value.find((x: any) => x.sku === "P-002" && x.platform === "Amazon US");
    card.currentUsd = 18.88;
    card.lastChange = { at: 1800000000000, from: 15.99, to: 18.88, reason: "持久化调价", by: "human" };
    const task = store.enqueueReview({
      mod: "e3", kind: "price-change", title: "持久化调价确认", refId: "P-RT", origin: "manual",
      summary: "验证 reviewTasks 往返不丢 payload。", reasoning: "round-trip", consequence: "无",
      facts: [{ k: "拟售价", v: "$18.88", warn: true }],
      risk: "high", payload: { sku: "P-RT", platform: "Amazon US", newPrice: 18.88 },
    });
    expect(task).toBeTruthy();

    await flushPersist();

    const productsRaw = parseLs(ELS.products);
    const pricesRaw = parseLs(ELS.prices);
    const reviewsRaw = parseLs(ELS.reviews);
    const expectedProduct = productsRaw.find((x: any) => x.id === "P-RT");
    const expectedPrice = pricesRaw.find((x: any) => x.sku === "P-002" && x.platform === "Amazon US");
    const expectedReview = reviewsRaw.find((x: any) => x.kind === "price-change" && x.refId === "P-RT");

    expect(expectedProduct).toMatchObject({ name: "往返测试品", platforms: ["Amazon US", "Temu"] });
    expect(expectedPrice).toMatchObject({ currentUsd: 18.88, lastChange: { reason: "持久化调价", by: "human" } });
    expect(expectedReview).toMatchObject({ title: "持久化调价确认", payload: { sku: "P-RT", newPrice: 18.88 } });

    const restored = await rebuildStore();
    expect(restored.products.value.find((x: any) => x.id === "P-RT")).toEqual(expectedProduct);
    expect(restored.prices.value.find((x: any) => x.sku === "P-002" && x.platform === "Amazon US")).toEqual(expectedPrice);
    expect(restored.reviewTasks.value.find((x: any) => x.kind === "price-change" && x.refId === "P-RT")).toEqual(expectedReview);
  });

  it("种子幂等：二次载入不重播种子审批卡，且无重复 refId+kind", async () => {
    const first = await freshStore();
    expect(first.reviewTasks.value.length).toBe(6);
    const firstKeys = first.reviewTasks.value.map((t: any) => `${t.refId}:${t.kind}`).sort();

    const second = await rebuildStore();
    const secondKeys = second.reviewTasks.value.map((t: any) => `${t.refId}:${t.kind}`).sort();

    expect(second.reviewTasks.value.length).toBe(6);
    expect(new Set(secondKeys).size).toBe(secondKeys.length);
    expect(secondKeys).toEqual(firstKeys);
    expect(parseLs<any[]>(ELS.reviews).length).toBe(6);
  });

  it("损坏容错：products 非法 JSON 不抛，载入时回退种子数据", async () => {
    localStorage.clear();
    localStorage.setItem(ELS.products, "{oops");

    let store: Awaited<ReturnType<typeof rebuildStore>> | undefined;
    let caught: unknown;
    try {
      store = await rebuildStore();
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeUndefined();
    expect(store!.products.value.map((x: any) => x.id)).toContain("P-001");
    expect(store!.products.value.find((x: any) => x.id === "P-001")?.name).toBe("宠物自动饮水机 2.5L");
    expect(store!.reviewTasks.value.length).toBe(6);
  });

  it("参数合并：老版本只存部分 params 时，缺失字段由 DEFAULT_PARAMS 补齐", async () => {
    localStorage.clear();
    localStorage.setItem(ELS.params, JSON.stringify({ autoRefundCapUsd: 77, usdCny: 7.45 }));

    const store = await rebuildStore();

    expect(store.params.value.autoRefundCapUsd).toBe(77);
    expect(store.params.value.usdCny).toBe(7.45);
    expect(store.params.value.priceAutoBandPct).toBe(DEFAULT_PARAMS.priceAutoBandPct);
    expect(store.params.value.targetMarginPct).toBe(DEFAULT_PARAMS.targetMarginPct);
    for (const key of Object.keys(DEFAULT_PARAMS) as (keyof typeof DEFAULT_PARAMS)[]) {
      expect(store.params.value[key], `${String(key)} should exist after merge`).not.toBeUndefined();
    }
  });
});
