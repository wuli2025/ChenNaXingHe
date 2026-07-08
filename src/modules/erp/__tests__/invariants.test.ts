import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ErpParams, ReviewKind } from "../types";

const h = vi.hoisted(() => ({
  runResult: { value: "MOCK-TEXT" },
  runJsonResult: { value: {} as Record<string, unknown> },
  calls: [] as { fn: "run" | "runJson"; prompt: string }[],
}));

vi.mock("../../../composables/useAgentRunner", () => ({
  useAgentRunner: () => ({
    running: { value: false },
    run: async (opts: { prompt: string }) => {
      h.calls.push({ fn: "run", prompt: opts.prompt });
      return { raw: h.runResult.value };
    },
    runJson: async (opts: { prompt: string }) => {
      h.calls.push({ fn: "runJson", prompt: opts.prompt });
      return { data: h.runJsonResult.value, raw: JSON.stringify(h.runJsonResult.value) };
    },
  }),
}));

type Store = Awaited<ReturnType<typeof freshStore>>;

async function freshStore() {
  vi.resetModules();
  localStorage.clear();
  h.calls.length = 0;
  h.runJsonResult.value = {};
  const mod = await import("../useErpStore");
  return mod.useErpStore();
}

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function pick<T>(rnd: () => number, xs: T[]): T {
  return xs[Math.floor(rnd() * xs.length)]!;
}

function int(rnd: () => number, min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1));
}

function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

function openTask(t: { status: string }) {
  return t.status === "pending" || t.status === "in_review";
}

function applyParamThroughReview(store: Store, key: keyof ErpParams, to: number) {
  const before = store.params.value[key];
  const r = store.setParam(key, to);
  // 百分比类参数 ≥100% 或使可变成本+利润≥100% 会被核心层合法拒绝（保本价无法计算），此时参数不变。
  if (r === "invalid") {
    expect(store.params.value[key]).toBe(before);
    return;
  }
  if (r === "review") {
    const t = store.reviewTasks.value.find((x) => x.kind === "param-change" && x.refId === key && x.status === "pending");
    expect(t).toBeTruthy();
    if (!t) throw new Error(`missing param-change review for ${String(key)}`);
    store.approveReview(t.id);
  }
  expect(store.params.value[key]).toBe(to);
}

function approveLatestPriceReview(store: Store, sku: string, platform: string) {
  const refId = `${sku}@${platform}`;
  const t = store.reviewTasks.value.find((x) => x.kind === "price-change" && x.refId === refId && openTask(x));
  expect(t).toBeTruthy();
  if (!t) throw new Error(`missing price-change review for ${refId}`);
  store.approveReview(t.id);
}

function assertAutonomyStats(store: Store) {
  const stats = store.autonomyStats.value;
  const total = store.executedActions.value.length;
  const auto = store.executedActions.value.filter((a) => a.by === "auto").length;
  expect(stats.total).toBe(total);
  expect(stats.auto).toBe(auto);
  expect(stats.human).toBe(total - auto);
  expect(stats.total).toBe(stats.auto + stats.human);
  expect(stats.autoRate).toBeGreaterThanOrEqual(0);
  expect(stats.autoRate).toBeLessThanOrEqual(100);
}

function assertReviewColumns(store: Store) {
  const columns = store.reviewColumns.value;
  const all = [...columns.pending, ...columns.in_review, ...columns.approved, ...columns.rejected];
  expect(all.length).toBe(store.reviewTasks.value.length);
  expect(new Set(all.map((t) => t.id)).size).toBe(store.reviewTasks.value.length);
}

function assertNoNaNPollution(store: Store) {
  for (const c of store.prices.value) {
    expect(Number.isFinite(c.currentUsd)).toBe(true);
    expect(Number.isNaN(c.currentUsd)).toBe(false);
  }
  for (const j of store.journal.value) {
    expect(Number.isFinite(j.amountCny)).toBe(true);
    expect(Number.isNaN(j.amountCny)).toBe(false);
  }
}

const humanOnlyKinds = ["po-payment", "tax-filing", "export-rebate"] as const satisfies readonly ReviewKind[];
const paramKeys = [
  "targetMarginPct", "minMarginFloorPct", "monthlyGmvTarget",
  "priceAutoBandPct", "fxRecalcThresholdPct",
  "autoAmountCapUsd", "autoRefundCapUsd", "dailyActionCap",
  "ocrAutoBookConf", "ocrAutoBookCapCny",
  "safetyStockDays", "leadTimeDays", "highValueShipmentUsd",
  "platformFeePct", "adCostPct", "returnRatePct", "usdCny", "eurUsd",
] as const satisfies readonly (keyof ErpParams)[];

describe("T1 策略引擎边界矩阵", () => {
  let store: Store;
  beforeEach(async () => { store = await freshStore(); });

  it("强制人工清单任意金额恒 review+hardGate", () => {
    const amounts = [0.01, 1, 499, 500, 501, 999999];
    for (const kind of humanOnlyKinds) {
      for (const amountUsd of amounts) {
        const d = store.decide(kind, { amountUsd });
        expect(d.mode).toBe("review");
        expect(d.hardGate).toBe(true);
      }
    }
  });

  it("autoAmountCapUsd 的 ±1 边界：下界自动，上界审批", () => {
    const cap = store.params.value.autoAmountCapUsd;
    expect(store.decide("claim-send", { amountUsd: cap - 1 }).mode).toBe("auto");
    expect(store.decide("claim-send", { amountUsd: cap }).mode).toBe("auto");
    expect(store.decide("claim-send", { amountUsd: cap + 1 }).mode).toBe("review");
  });

  it("autoRefundCapUsd 的 ±1 边界：退款专属阈值生效", () => {
    const cap = store.params.value.autoRefundCapUsd;
    expect(store.decide("order-refund", { amountUsd: cap - 1 }).mode).toBe("auto");
    expect(store.decide("order-refund", { amountUsd: cap }).mode).toBe("auto");
    expect(store.decide("order-refund", { amountUsd: cap + 1 }).mode).toBe("review");
  });

  it("highValueShipmentUsd 的 ±1 边界，且不被通用上限短路", () => {
    const p = store.params.value;
    expect(store.decide("logistics-channel", { amountUsd: p.highValueShipmentUsd - 1 }).mode).toBe("auto");
    expect(store.decide("logistics-channel", { amountUsd: p.highValueShipmentUsd }).mode).toBe("review");
    expect(store.decide("logistics-channel", { amountUsd: p.highValueShipmentUsd + 1 }).mode).toBe("review");
    expect(p.autoAmountCapUsd + 100).toBeLessThan(p.highValueShipmentUsd);
    expect(store.decide("logistics-channel", { amountUsd: p.autoAmountCapUsd + 100 }).mode).toBe("auto");
  });

  it("priceAutoBandPct 的正负 ±1 边界：超幅才审批", () => {
    const band = store.params.value.priceAutoBandPct;
    expect(store.decide("price-change", { pct: band - 1 }).mode).toBe("auto");
    expect(store.decide("price-change", { pct: band }).mode).toBe("auto");
    expect(store.decide("price-change", { pct: band + 1 }).mode).toBe("review");
    expect(store.decide("price-change", { pct: -(band - 1) }).mode).toBe("auto");
    expect(store.decide("price-change", { pct: -band }).mode).toBe("auto");
    expect(store.decide("price-change", { pct: -(band + 1) }).mode).toBe("review");
  });

  it("ocrAutoBookConf 与 ocrAutoBookCapCny 的 ±1 边界", () => {
    const p = store.params.value;
    expect(store.decide("ocr-book", { conf: p.ocrAutoBookConf - 1, amountCny: p.ocrAutoBookCapCny - 1 }).mode).toBe("review");
    expect(store.decide("ocr-book", { conf: p.ocrAutoBookConf, amountCny: p.ocrAutoBookCapCny - 1 }).mode).toBe("auto");
    expect(store.decide("ocr-book", { conf: p.ocrAutoBookConf + 1, amountCny: p.ocrAutoBookCapCny + 1 }).mode).toBe("review");
    expect(store.decide("ocr-book", { conf: p.ocrAutoBookConf + 1, amountCny: p.ocrAutoBookCapCny }).mode).toBe("auto");
  });

  it("OCR 金额闸使用 USD/EUR 折 CNY 口径", () => {
    const p = store.params.value;
    const usdUnderCap = (p.ocrAutoBookCapCny - 1) / p.usdCny;
    const eurOverCap = (p.ocrAutoBookCapCny + 1) / (p.usdCny * p.eurUsd);

    const usdDoc = store.intakeDoc({
      type: "receipt", party: "USD Vendor", no: "INV-T1-USD", date: "2026-07-07",
      amount: usdUnderCap, currency: "USD", conf: p.ocrAutoBookConf + 1, lowFields: [],
    });
    expect(usdDoc.booked).toBe(true);

    const eurDoc = store.intakeDoc({
      type: "receipt", party: "EUR Vendor", no: "INV-T1-EUR", date: "2026-07-07",
      amount: eurOverCap, currency: "EUR", conf: p.ocrAutoBookConf + 1, lowFields: [],
    });
    expect(eurDoc.booked).toBe(false);
    expect(store.reviewTasks.value.some((t) => t.kind === "ocr-book" && t.refId === eurDoc.id && t.status === "pending")).toBe(true);
  });

  it("dailyActionCap 的 ±1 边界：第 cap+1 次自动动作转审批", () => {
    const cap = store.params.value.dailyActionCap;
    for (let i = 0; i < cap - 1; i += 1) {
      store.executedActions.value.unshift({
        id: `seed-auto-${i}`, at: Date.now(), mod: "e3", kind: "price-change",
        title: "seed", detail: "seed", by: "auto",
      });
    }
    expect(store.decide("claim-send", { amountUsd: 1 }).mode).toBe("auto");
    store.executedActions.value.unshift({
      id: "seed-auto-cap", at: Date.now(), mod: "e3", kind: "price-change",
      title: "seed", detail: "seed", by: "auto",
    });
    expect(store.decide("claim-send", { amountUsd: 1 }).mode).toBe("review");
  });
});

describe("T3 不变量模糊测试", () => {
  it("INV-1 硬闸不可逾越：随机合法极端参数下强制人工恒 review+hardGate", async () => {
    const store = await freshStore();
    const rnd = lcg(0xA11CE);

    for (let i = 0; i < 240; i += 1) {
      const key = pick(rnd, [...paramKeys]);
      const to = rnd() < 0.5 ? 0.01 + (i % 3) * 0.01 : 10000 + i;
      applyParamThroughReview(store, key, to);

      for (const kind of humanOnlyKinds) {
        const d = store.decide(kind, { amountUsd: i % 2 ? 0.01 : 999999, amountCny: 999999 });
        expect(d.mode).toBe("review");
        expect(d.hardGate).toBe(true);
      }
    }
  });

  it("INV-2 保本硬底线：随机拟价经 propose+批准后恒不低于 floorPrice", async () => {
    const store = await freshStore();
    const rnd = lcg(0xBEEF02);

    for (let i = 0; i < 140; i += 1) {
      const card = pick(rnd, store.prices.value);
      const mode = i % 12;
      const newPrice = mode === 0
        ? 0.000001
        : mode === 1
          ? 0
          : mode === 2
            ? -int(rnd, 1, 200)
            : cents(card.currentUsd * (0.25 + rnd() * 1.75));
      const before = card.currentUsd;
      const result = store.proposePriceChange(card.sku, card.platform, newPrice, `lcg-price-${i}`, int(rnd, 80, 100));
      if (!Number.isFinite(newPrice) || newPrice <= 0) {
        // 非法拟价（0/负数）被核心层直接拒绝：返回 null 且价格纹丝不动
        expect(result).toBeNull();
        expect(card.currentUsd).toBe(before);
      } else {
        expect(result).not.toBeNull();
        if (result === "review") approveLatestPriceReview(store, card.sku, card.platform);
      }

      const floor = store.floorPrice(card);
      expect(Number.isFinite(card.currentUsd)).toBe(true);
      expect(card.currentUsd).toBeGreaterThanOrEqual(floor);
    }
  });

  it("INV-3 台账守恒：随机操作后 total === auto+human 且 autoRate 在 [0,100]", async () => {
    const store = await freshStore();
    const rnd = lcg(0xC0FFEE);

    for (let i = 0; i < 220; i += 1) {
      const op = int(rnd, 0, 4);
      if (op === 0) {
        store.createShipment(`INV-ORDER-${i}`, "测试货品", "US", "云途全球专线", int(rnd, 10, 900), int(rnd, 10, 500), "lcg-route", rnd() < 0.5 ? "auto" : "human");
      } else if (op === 1) {
        const card = pick(rnd, store.prices.value);
        const result = store.proposePriceChange(card.sku, card.platform, cents(card.currentUsd * (0.8 + rnd() * 0.4)), `lcg-auto-price-${i}`, 90);
        if (result === "review") approveLatestPriceReview(store, card.sku, card.platform);
      } else if (op === 2) {
        const doc = store.intakeDoc({
          type: "receipt", party: `LCG Vendor ${i}`, no: `LCG-DOC-${i}`, date: "2026-07-07",
          amount: int(rnd, 1, 8000), currency: "CNY", conf: int(rnd, 80, 100), lowFields: [],
        });
        const t = store.reviewTasks.value.find((x) => x.kind === "ocr-book" && x.refId === doc.id && openTask(x));
        if (t && rnd() < 0.7) store.approveReview(t.id);
      } else if (op === 3) {
        const open = store.reviewTasks.value.filter(openTask);
        const t = open.length ? pick(rnd, open) : null;
        if (t) store.approveReview(t.id);
      } else {
        store.enqueueReview({
          mod: "e5", kind: "claim-send", title: `LCG 索赔 ${i}`, refId: `LCG-CLAIM-${i}`,
          origin: "ai", summary: "lcg", facts: [], risk: "normal", payload: {},
        });
      }
      assertAutonomyStats(store);
    }
  });

  it("INV-4 四列任务数之和恒等于 reviewTasks 总数", async () => {
    const store = await freshStore();
    const rnd = lcg(0xDADA55);
    const rerunnable = new Set<ReviewKind>(["listing-publish", "listing-update", "price-change", "recon-open"]);

    for (let i = 0; i < 240; i += 1) {
      const op = int(rnd, 0, 5);
      if (op === 0) {
        store.enqueueReview({
          mod: "e5", kind: "claim-send", title: `列守恒 ${i}`, refId: `COL-${i}`,
          origin: "ai", summary: "lcg", facts: [], risk: "normal", payload: {},
        });
      } else if (op === 1) {
        const pending = store.reviewTasks.value.filter((t) => t.status === "pending");
        const t = pending.length ? pick(rnd, pending) : null;
        if (t) store.claimReview(t.id);
      } else if (op === 2) {
        const open = store.reviewTasks.value.filter(openTask);
        const t = open.length ? pick(rnd, open) : null;
        if (t) store.approveReview(t.id);
      } else if (op === 3) {
        const rejectable = store.reviewTasks.value.filter((t) => openTask(t) && !rerunnable.has(t.kind));
        const t = rejectable.length ? pick(rnd, rejectable) : null;
        if (t) store.rejectReview(t.id, "lcg reject");
      } else if (op === 4) {
        const rejected = store.reviewTasks.value.filter((t) => t.status === "rejected");
        const t = rejected.length ? pick(rnd, rejected) : null;
        if (t) store.resetReview(t.id);
      } else {
        const card = pick(rnd, store.prices.value);
        const result = store.proposePriceChange(card.sku, card.platform, cents(card.currentUsd * (0.7 + rnd() * 0.8)), `columns-price-${i}`, 90);
        if (result === "review" && rnd() < 0.5) approveLatestPriceReview(store, card.sku, card.platform);
      }
      assertReviewColumns(store);
    }
  });

  it("INV-5 非法 AI 输出无害：缺字段/字符串金额/负数/非法枚举不制造 NaN 价格或账目", async () => {
    const store = await freshStore();
    const card = store.prices.value.find((c) => c.sku === "P-002" && c.platform === "Amazon US")!;

    h.runJsonResult.value = {};
    await store.runOcr("missing fields");
    assertNoNaNPollution(store);

    h.runJsonResult.value = {
      type: "receipt", party: "String Amount Vendor", no: "AI-STR-1", date: "2026-07-07",
      amount: "88.5", currency: "CNY", conf: 99, lowFields: [],
    };
    await store.runOcr("string amount");
    assertNoNaNPollution(store);

    h.runJsonResult.value = { newPrice: -1, reason: "negative price", confidence: 90 };
    await store.runPriceAdvice(card.sku, card.platform, "negative price");
    expect(card.currentUsd).not.toBe(-1);
    assertNoNaNPollution(store);

    h.runJsonResult.value = {
      type: "not-a-doc-type", party: "Illegal Enum Vendor", no: "AI-BAD-TYPE-1", date: "2026-07-07",
      amount: 12, currency: "CNY", conf: 80, lowFields: [],
    };
    await store.runOcr("illegal enum");
    assertNoNaNPollution(store);
  });

  // 源码缺陷证明：runPriceAdvice 未校验缺失/NaN newPrice，会经 proposePriceChange 写入 currentUsd=NaN。
  it("INV-5 源码缺陷：缺失 newPrice 的 AI 定价输出不应污染价格", async () => {
    const store = await freshStore();
    const card = store.prices.value.find((c) => c.sku === "P-002" && c.platform === "Amazon US")!;
    h.runJsonResult.value = { reason: "missing newPrice", confidence: 90 };

    await store.runPriceAdvice(card.sku, card.platform, "missing newPrice");

    expect(Number.isFinite(card.currentUsd)).toBe(true);
  });

  // 源码缺陷证明：proposePriceChange 对 NaN 拟价未拦截，直接进入自动调价路径。
  it("INV-2 源码缺陷：NaN 拟价不应落地为 currentUsd=NaN", async () => {
    const store = await freshStore();
    const card = store.prices.value.find((c) => c.sku === "P-002" && c.platform === "Amazon US")!;

    store.proposePriceChange(card.sku, card.platform, Number.NaN, "nan proposal", 90);

    expect(Number.isFinite(card.currentUsd)).toBe(true);
    expect(card.currentUsd).toBeGreaterThanOrEqual(store.floorPrice(card));
  });

  // 源码缺陷证明：runOcr 未拒绝负金额，高置信小额负数会自动生成负数凭证。
  it("INV-5 源码缺陷：负数 OCR 金额不应自动入账", async () => {
    const store = await freshStore();
    h.runJsonResult.value = {
      type: "receipt", party: "Negative Amount Vendor", no: "AI-NEG-1", date: "2026-07-07",
      amount: -120, currency: "CNY", conf: 99, lowFields: [],
    };

    await store.runOcr("negative amount");

    expect(store.journal.value.every((j) => j.amountCny >= 0)).toBe(true);
  });

  // 源码缺陷证明：非法 DocType 会先落 docs，再在 bookDoc 取 RULE[d.type] 时失败。
  it("INV-5 源码缺陷：非法 OCR 枚举不应落库无效票据", async () => {
    const store = await freshStore();
    const before = store.docs.value.length;
    h.runJsonResult.value = {
      type: "not-a-doc-type", party: "Illegal Enum Vendor", no: "AI-BAD-TYPE-2", date: "2026-07-07",
      amount: 12, currency: "CNY", conf: 99, lowFields: [],
    };

    await store.runOcr("illegal enum high confidence");

    expect(store.docs.value.length).toBe(before);
  });
});
