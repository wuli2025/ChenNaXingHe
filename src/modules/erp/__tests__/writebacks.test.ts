import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ErpModId, ReviewKind } from "../types";

const h = vi.hoisted(() => ({
  runJsonResult: { value: {} as Record<string, unknown> },
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
      return { data: h.runJsonResult.value, raw: JSON.stringify(h.runJsonResult.value) };
    },
  }),
}));

async function freshStore() {
  vi.resetModules();
  localStorage.clear();
  h.calls.length = 0;
  h.runJsonResult.value = {};
  const mod = await import("../useErpStore");
  return mod.useErpStore();
}

type Store = Awaited<ReturnType<typeof freshStore>>;
type TestTask = NonNullable<ReturnType<Store["enqueueReview"]>>;
type CaseResult = { task: TestTask; assert: () => void | Promise<void> };
type WritebackCase = {
  kind: ReviewKind;
  approve: (store: Store) => CaseResult;
  reject: (store: Store) => CaseResult;
  skipApprove?: string;
};

const MOD_BY_KIND: Record<ReviewKind, ErpModId> = {
  "listing-publish": "e2",
  "listing-update": "e2",
  "price-change": "e3",
  "order-refund": "e4",
  "logistics-channel": "e5",
  "claim-send": "e5",
  "replenish-po": "e6",
  "po-payment": "e6",
  "ocr-book": "e7",
  "recon-open": "e7",
  "month-close": "e7",
  "tax-filing": "e8",
  "export-rebate": "e8",
  "param-change": "e9",
};

const RERUNNABLE = new Set<ReviewKind>(["listing-publish", "listing-update", "price-change", "recon-open"]);

function enqueueReview(
  store: Store,
  kind: ReviewKind,
  init: {
    refId?: string;
    risk?: "hard" | "high" | "normal" | "low";
    hardGate?: boolean;
    origin?: "ai" | "auto" | "manual";
    payload?: Record<string, unknown>;
  } = {},
): TestTask {
  const task = store.enqueueReview({
    mod: MOD_BY_KIND[kind],
    kind,
    title: `WB ${kind}`,
    summary: `WB ${kind} writeback path`,
    facts: [],
    risk: init.risk ?? (init.hardGate ? "hard" : "normal"),
    origin: init.origin ?? "ai",
    ...(init.refId !== undefined ? { refId: init.refId } : {}),
    ...(init.hardGate !== undefined ? { hardGate: init.hardGate } : {}),
    ...(init.payload !== undefined ? { payload: init.payload } : {}),
  });
  expect(task).toBeTruthy();
  return task!;
}

function oneHumanAction(store: Store, kind: ReviewKind) {
  const actions = store.executedActions.value.filter((a: any) => a.kind === kind);
  expect(actions).toHaveLength(1);
  expect(actions[0].by).toBe("human");
  return actions[0];
}

function noActions(store: Store) {
  expect(store.executedActions.value).toHaveLength(0);
}

function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function primeRerun(kind: ReviewKind) {
  if (kind === "listing-publish" || kind === "listing-update") {
    h.runJsonResult.value = { title: `WB rerun ${kind}`, bullets: ["rerun 1", "rerun 2"], keywords: "rerun keywords", rationale: "rerun rationale" };
  } else if (kind === "price-change") {
    h.runJsonResult.value = { newPrice: 18.49, reason: "人工驳回后重议，仍需审批", marginPct: 30, confidence: 90 };
  } else if (kind === "recon-open") {
    h.runJsonResult.value = { candidates: [{ target: "WB-CANDIDATE", reason: "按驳回批注重新匹配", conf: 96 }] };
  } else {
    h.runJsonResult.value = {};
  }
}

function expectRerun(kind: ReviewKind, task: TestTask, callsBefore: number) {
  const delta = h.calls.length - callsBefore;
  if (RERUNNABLE.has(kind)) {
    expect(delta).toBeGreaterThan(0);
    expect(task.reran).toBe(true);
  } else {
    expect(delta).toBe(0);
    expect(task.reran).toBeFalsy();
  }
}

function addPayablePo(store: Store) {
  const po = { id: "PO-WB-PAY", supplier: "付款测试供应商", sku: "P-002", goods: "猫胸背带测试付款", qty: 10, unitCny: 11, amountCny: 110, status: "pending_pay", grnOk: true, invoiceOk: true };
  store.pos.value.unshift(po as any);
  return po;
}

function addDoc(store: Store) {
  const doc = { id: "D-WB-OCR", type: "logistics-bill", party: "云途测试账单", no: "YT-WB-1", date: "2026-07-07", amount: 321.45, currency: "CNY", conf: 87, lowFields: ["金额"], booked: false, dupCheck: "ok" };
  store.docs.value.unshift(doc as any);
  return doc;
}

function addRebateFiling(store: Store) {
  const filing = { id: "F-WB-REBATE", name: "2026-06 出口退税测试批", region: "国内", period: "2026-06", due: "2026-08-15", status: "ready", amountDue: 888, currency: "CNY", docsReady: [{ name: "退税资料包", ok: true }] };
  store.filings.value.unshift(filing as any);
  return filing;
}

const CASES: WritebackCase[] = [
  {
    kind: "listing-publish",
    approve: (store) => {
      const listing = store.listings.value.find((x: any) => x.id === "L-104")!;
      const task = enqueueReview(store, "listing-publish", { refId: listing.id, payload: { listingId: listing.id, title: "WB Published Storage Ottoman", bullets: ["A", "B", "C", "D", "E", "DROP"], keywords: "storage ottoman wb" } });
      return { task, assert: () => { expect(listing.status).toBe("live"); expect(listing.title).toBe("WB Published Storage Ottoman"); expect(listing.bullets).toEqual(["A", "B", "C", "D", "E"]); expect(listing.keywords).toBe("storage ottoman wb"); } };
    },
    reject: (store) => {
      const listing = store.listings.value.find((x: any) => x.id === "L-104")!;
      listing.status = "pending_review";
      const title = listing.title;
      const task = enqueueReview(store, "listing-publish", { refId: listing.id, payload: { listingId: listing.id, title: "Rejected publish title" } });
      return { task, assert: () => { expect(listing.status).toBe("draft"); expect(listing.title).toBe(title); } };
    },
  },
  {
    kind: "listing-update",
    approve: (store) => {
      const listing = store.listings.value.find((x: any) => x.id === "L-101")!;
      const task = enqueueReview(store, "listing-update", { refId: listing.id, risk: "high", payload: { listingId: listing.id, title: "WB Updated Fountain Title", bullets: ["quiet", "filtered", "large"], keywords: "updated fountain wb" } });
      return { task, assert: () => { expect(listing.status).toBe("live"); expect(listing.title).toBe("WB Updated Fountain Title"); expect(listing.bullets).toEqual(["quiet", "filtered", "large"]); expect(listing.keywords).toBe("updated fountain wb"); } };
    },
    reject: (store) => {
      const listing = store.listings.value.find((x: any) => x.id === "L-101")!;
      const snapshot = { status: listing.status, title: listing.title, bullets: [...listing.bullets], keywords: listing.keywords };
      const task = enqueueReview(store, "listing-update", { refId: listing.id, risk: "high", payload: { listingId: listing.id, title: "Rejected update title" } });
      return { task, assert: () => { expect(listing.status).toBe(snapshot.status); expect(listing.title).toBe(snapshot.title); expect(listing.bullets).toEqual(snapshot.bullets); expect(listing.keywords).toBe(snapshot.keywords); } };
    },
  },
  {
    kind: "price-change",
    approve: (store) => {
      const card = store.prices.value.find((x: any) => x.sku === "P-002" && x.platform === "Amazon US")!;
      const product = store.products.value.find((x: any) => x.id === "P-002")!;
      const task = enqueueReview(store, "price-change", { refId: `${card.sku}@${card.platform}`, risk: "high", payload: { sku: card.sku, platform: card.platform, newPrice: 18.49, reason: "WB approved price" } });
      return { task, assert: () => { expect(card.currentUsd).toBe(18.49); expect(card.lastChange).toMatchObject({ from: 15.99, to: 18.49, by: "human" }); expect(product.priceUsd).toBe(18.49); } };
    },
    reject: (store) => {
      const card = store.prices.value.find((x: any) => x.sku === "P-002" && x.platform === "Amazon US")!;
      const task = enqueueReview(store, "price-change", { refId: `${card.sku}@${card.platform}`, risk: "high", payload: { sku: card.sku, platform: card.platform, newPrice: 18.49, reason: "WB rejected price" } });
      return { task, assert: () => { expect(card.currentUsd).toBe(15.99); expect(card.lastChange).toBeUndefined(); } };
    },
  },
  {
    kind: "order-refund",
    approve: (store) => {
      const afterSale = store.afterSales.value.find((x: any) => x.id === "AS-31")!;
      const order = store.orders.value.find((x: any) => x.id === afterSale.orderId)!;
      const task = enqueueReview(store, "order-refund", { refId: afterSale.id, risk: "high", payload: { afterSaleId: afterSale.id } });
      return { task, assert: () => { expect(afterSale.status).toBe("done"); expect(order.status).toBe("closed"); } };
    },
    reject: (store) => {
      const afterSale = store.afterSales.value.find((x: any) => x.id === "AS-31")!;
      const order = store.orders.value.find((x: any) => x.id === afterSale.orderId)!;
      const task = enqueueReview(store, "order-refund", { refId: afterSale.id, risk: "high", payload: { afterSaleId: afterSale.id } });
      return { task, assert: () => { expect(afterSale.status).toBe("rejected"); expect(order.status).toBe("delivered"); } };
    },
  },
  {
    kind: "logistics-channel",
    approve: (store) => {
      const order = store.orders.value.find((x: any) => x.id === "112-671")!;
      const before = store.shipments.value.length;
      const task = enqueueReview(store, "logistics-channel", { refId: order.id, risk: "high", payload: { orderId: order.id, goods: order.goods, to: order.country, channel: "云途全球专线（普货）", weightG: 440, costCny: 35.88, reason: "WB route approval" } });
      return { task, assert: () => { expect(store.shipments.value.length).toBe(before + 1); const shipment = store.shipments.value[0]; expect(shipment).toMatchObject({ orderId: order.id, goods: order.goods, to: order.country, channel: "云途全球专线（普货）", weightG: 440, costCny: 35.88, status: "已出单" }); expect(order.status).toBe("shipped"); expect(order.channel).toBe("云途全球专线（普货）"); expect(order.trackingNo).toBe(shipment.id); } };
    },
    reject: (store) => {
      const order = store.orders.value.find((x: any) => x.id === "112-671")!;
      const before = store.shipments.value.length;
      const task = enqueueReview(store, "logistics-channel", { refId: order.id, risk: "high", payload: { orderId: order.id, goods: order.goods, to: order.country, channel: "云途全球专线（普货）", weightG: 440, costCny: 35.88, reason: "WB route rejection" } });
      return { task, assert: () => { expect(store.shipments.value.length).toBe(before); expect(order.status).toBe("allocated"); expect(order.trackingNo).toBeUndefined(); } };
    },
  },
  {
    kind: "claim-send",
    approve: (store) => {
      const shipment = store.shipments.value.find((x: any) => x.id === "SH-690")!;
      const task = enqueueReview(store, "claim-send", { refId: shipment.id, risk: "high" });
      return { task, assert: () => { expect(shipment.status).toBe("索赔中"); expect(shipment.stalled).toBe(true); } };
    },
    reject: (store) => {
      const shipment = store.shipments.value.find((x: any) => x.id === "SH-690")!;
      const task = enqueueReview(store, "claim-send", { refId: shipment.id, risk: "high" });
      return { task, assert: () => { expect(shipment.status).toBe("停滞"); expect(shipment.stalled).toBe(true); } };
    },
  },
  {
    kind: "replenish-po",
    approve: (store) => {
      const beforePos = store.pos.value.length;
      const beforePayGates = store.reviewTasks.value.filter((x: any) => x.kind === "po-payment").length;
      const task = enqueueReview(store, "replenish-po", { refId: "P-002-WB", risk: "high", payload: { sku: "P-002", goods: "猫胸背带测试补货", qty: 123, unitCny: 16.8, supplier: "义乌市恒达宠物用品" } });
      return { task, assert: () => { expect(store.pos.value.length).toBe(beforePos + 1); const po = store.pos.value[0]; expect(po).toMatchObject({ supplier: "义乌市恒达宠物用品", sku: "P-002", goods: "猫胸背带测试补货", qty: 123, unitCny: 16.8, amountCny: 2066.4, status: "pending_pay", grnOk: false, invoiceOk: false }); const payGate = store.reviewTasks.value.find((x: any) => x.kind === "po-payment" && x.refId === po.id); expect(store.reviewTasks.value.filter((x: any) => x.kind === "po-payment").length).toBe(beforePayGates + 1); expect(payGate).toBeTruthy(); expect(payGate!.hardGate).toBe(true); expect(payGate!.payload).toMatchObject({ poId: po.id }); } };
    },
    reject: (store) => {
      const beforePos = store.pos.value.length;
      const beforePayGates = store.reviewTasks.value.filter((x: any) => x.kind === "po-payment").length;
      const task = enqueueReview(store, "replenish-po", { refId: "P-002-WB", risk: "high", payload: { sku: "P-002", goods: "猫胸背带测试补货", qty: 123, unitCny: 16.8, supplier: "义乌市恒达宠物用品" } });
      return { task, assert: () => { expect(store.pos.value.length).toBe(beforePos); expect(store.reviewTasks.value.filter((x: any) => x.kind === "po-payment").length).toBe(beforePayGates); } };
    },
  },
  {
    kind: "po-payment",
    approve: (store) => {
      const po = addPayablePo(store);
      const task = enqueueReview(store, "po-payment", { refId: po.id, risk: "hard", hardGate: true, payload: { poId: po.id } });
      return { task, assert: () => { expect(po.status).toBe("paid"); } };
    },
    reject: (store) => {
      const po = addPayablePo(store);
      const task = enqueueReview(store, "po-payment", { refId: po.id, risk: "hard", hardGate: true, payload: { poId: po.id } });
      return { task, assert: () => { expect(po.status).toBe("pending_pay"); } };
    },
  },
  {
    kind: "ocr-book",
    approve: (store) => {
      const doc = addDoc(store);
      const beforeJournal = store.journal.value.length;
      const task = enqueueReview(store, "ocr-book", { refId: doc.id, payload: { docId: doc.id } });
      return { task, assert: () => { expect(doc.booked).toBe(true); expect(store.journal.value.length).toBe(beforeJournal + 1); expect(store.journal.value[0]).toMatchObject({ docId: doc.id, amountCny: 321.45, by: "human" }); } };
    },
    reject: (store) => {
      const doc = addDoc(store);
      const beforeJournal = store.journal.value.length;
      const task = enqueueReview(store, "ocr-book", { refId: doc.id, payload: { docId: doc.id } });
      return { task, assert: () => { expect(doc.booked).toBe(false); expect(store.journal.value.length).toBe(beforeJournal); } };
    },
  },
  {
    kind: "recon-open",
    approve: (store) => {
      const row = store.recon.value.find((x: any) => x.id === "R-24")!;
      // 真实前置：recon-open 卡由 runRecon 生成时行已置「待确认」且带真实候选；批准才可闭合为「已匹配」。
      row.status = "待确认";
      row.match = "WB-REAL-MATCH";
      const beforeJournal = store.journal.value.length;
      const task = enqueueReview(store, "recon-open", { refId: row.id, payload: { reconId: row.id } });
      return { task, assert: () => { expect(row.status).toBe("已匹配"); expect(store.journal.value.length).toBe(beforeJournal); } };
    },
    reject: (store) => {
      const row = store.recon.value.find((x: any) => x.id === "R-22")!;
      const beforeJournal = store.journal.value.length;
      const task = enqueueReview(store, "recon-open", { refId: row.id, payload: { reconId: row.id } });
      return { task, assert: () => { expect(row.status).toBe("待确认"); expect(row.match).toBe("WB-CANDIDATE"); expect(row.conf).toBe(96); expect(store.journal.value.length).toBe(beforeJournal); } };
    },
  },
  {
    kind: "month-close",
    approve: (store) => {
      const report = store.reports.value.find((x: any) => x.month === "2026-06")!;
      const task = enqueueReview(store, "month-close", { refId: report.month, payload: { month: report.month } });
      return { task, assert: () => { expect(report.closed).toBe(true); } };
    },
    reject: (store) => {
      const report = store.reports.value.find((x: any) => x.month === "2026-06")!;
      const task = enqueueReview(store, "month-close", { refId: report.month, payload: { month: report.month } });
      return { task, assert: () => { expect(report.closed).toBe(false); } };
    },
  },
  {
    kind: "tax-filing",
    approve: (store) => {
      const filing = store.filings.value.find((x: any) => x.id === "F-62")!;
      // 提交回写契约：只有「就绪且资料齐」的申报可置 submitted；F-62 种子缺「申报表草稿」，需补齐。
      filing.status = "ready";
      filing.docsReady!.forEach((d: any) => { d.ok = true; });
      const task = enqueueReview(store, "tax-filing", { refId: filing.id, risk: "hard", hardGate: true, payload: { filingId: filing.id } });
      return { task, assert: () => { expect(filing.status).toBe("submitted"); } };
    },
    reject: (store) => {
      const filing = store.filings.value.find((x: any) => x.id === "F-62")!;
      filing.status = "ready";
      filing.docsReady!.forEach((d: any) => { d.ok = true; });
      const task = enqueueReview(store, "tax-filing", { refId: filing.id, risk: "hard", hardGate: true, payload: { filingId: filing.id } });
      return { task, assert: () => { expect(filing.status).toBe("ready"); } };
    },
  },
  {
    kind: "export-rebate",
    approve: (store) => {
      const filing = addRebateFiling(store);
      const task = enqueueReview(store, "export-rebate", { refId: filing.id, risk: "hard", hardGate: true, payload: { filingId: filing.id } });
      return { task, assert: () => { expect(filing.status).toBe("submitted"); } };
    },
    reject: (store) => {
      const filing = addRebateFiling(store);
      const task = enqueueReview(store, "export-rebate", { refId: filing.id, risk: "hard", hardGate: true, payload: { filingId: filing.id } });
      return { task, assert: () => { expect(filing.status).toBe("ready"); } };
    },
  },
  {
    kind: "param-change",
    skipApprove: "源码当前只写 params/paramLog，未写 executedActions human 台账。",
    approve: (store) => {
      const beforeLog = store.paramLog.value.length;
      const task = enqueueReview(store, "param-change", { refId: "autoAmountCapUsd", origin: "manual", risk: "high", payload: { key: "autoAmountCapUsd", to: 750 } });
      return { task, assert: () => { expect(store.params.value.autoAmountCapUsd).toBe(750); expect(store.paramLog.value.length).toBe(beforeLog + 1); expect(store.paramLog.value[0]).toMatchObject({ key: "autoAmountCapUsd", from: 500, to: 750, by: "human" }); } };
    },
    reject: (store) => {
      const beforeLog = store.paramLog.value.length;
      const task = enqueueReview(store, "param-change", { refId: "autoAmountCapUsd", origin: "manual", risk: "high", payload: { key: "autoAmountCapUsd", to: 750 } });
      return { task, assert: () => { expect(store.params.value.autoAmountCapUsd).toBe(500); expect(store.paramLog.value.length).toBe(beforeLog); } };
    },
  },
];

describe("ERP 审批回写完备性 T2", () => {
  let store: Store;

  beforeEach(async () => {
    store = await freshStore();
  });

  describe("批准路径", () => {
    for (const c of CASES) {
      const name = `${c.kind} 批准 -> 业务终态 + human executedActions`;
      const body = async () => {
        const r = c.approve(store);
        store.approveReview(r.task.id, "WB approve");
        await flushAsync();
        await r.assert();
        oneHumanAction(store, c.kind);
      };
      if (c.skipApprove) it(`${name}（${c.skipApprove}）`, body);
      else it(name, body);
    }
  });

  describe("驳回路径", () => {
    for (const c of CASES) {
      it(`${c.kind} 驳回 -> 不执行 + 不中断链路/不卡死 + 重跑策略正确`, async () => {
        const r = c.reject(store);
        primeRerun(c.kind);
        const callsBefore = h.calls.length;
        store.rejectReview(r.task.id, "WB reject note");
        await flushAsync();
        await r.assert();
        noActions(store);
        expectRerun(c.kind, r.task, callsBefore);
      });
    }
  });
});
