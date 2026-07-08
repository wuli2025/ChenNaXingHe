import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({
  runJsonQueue: [] as Record<string, unknown>[],
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
      const data = h.runJsonQueue.shift() ?? {};
      return { data, raw: JSON.stringify(data) };
    },
  }),
}));

async function freshStore() {
  vi.resetModules();
  localStorage.clear();
  h.calls.length = 0;
  h.runJsonQueue.length = 0;
  const mod = await import("../useErpStore");
  return mod.useErpStore();
}

type Store = Awaited<ReturnType<typeof freshStore>>;

function pushRunJson(...items: Record<string, unknown>[]) {
  h.runJsonQueue.push(...items);
}

function pendingTask(store: Store, kind: string, refId?: string) {
  const task = store.reviewTasks.value.find((t: any) => (
    t.kind === kind
    && t.status === "pending"
    && (refId === undefined || t.refId === refId)
  ));
  expect(task).toBeTruthy();
  return task as any;
}

function actionsSince(store: Store, before: Set<string>) {
  return store.executedActions.value.filter((a: any) => !before.has(a.id));
}

function expectAutonomyStatsConserved(store: Store) {
  const stats = store.autonomyStats.value;
  expect(stats.total).toBe(stats.auto + stats.human);
  expect(stats.total).toBe(store.executedActions.value.length);
}

function expectReviewColumnsConserved(store: Store) {
  const columns = store.reviewColumns.value;
  const count = columns.pending.length + columns.in_review.length + columns.approved.length + columns.rejected.length;
  expect(count).toBe(store.reviewTasks.value.length);
}

function journalTotal(store: Store) {
  return store.journal.value.reduce((sum: number, entry: any) => sum + entry.amountCny, 0);
}

describe("ERP C06 全链路场景", () => {
  it("A-D 一单到底：采购付款、订单发货、票据月结、报税提交保持跨模块一致", async () => {
    const store = await freshStore();

    pushRunJson(
      {
        suggestions: [{
          sku: "P-003",
          name: "可折叠收纳凳 60L",
          qty: 240,
          reason: "FBA 可售天数低于安全库存线，建议补到 40 天。",
          supplier: "佛山场景供应商",
          unitCny: 42,
        }],
      },
      { channel: "4PX 联邮通标快", costCny: 26.3, reason: "德国轻小件按时效优先走 4PX。", confidence: 94 },
      { channel: "云途全球专线（普货）", costCny: 118.8, reason: "高值件需人工确认承运渠道。", confidence: 91 },
      {
        type: "receipt",
        party: "顺丰同城",
        no: "SF-C06-AUTO",
        date: "2026-07-07",
        amount: 88,
        currency: "CNY",
        conf: 99,
        lowFields: [],
        suggestBundle: "C06 自动入账",
      },
      {
        type: "logistics-bill",
        party: "云途物流",
        no: "YT-C06-LOW",
        date: "2026-07-07",
        amount: 321.45,
        currency: "CNY",
        conf: 87,
        lowFields: ["金额"],
        suggestBundle: "C06 人工入账",
      },
      { candidates: [{ target: "PP-TEMU-C06", reason: "金额与 Temu 结算批次吻合。", conf: 95 }] },
      {
        issues: [],
        missingDocs: [],
        amountCheck: "应缴金额与申报草稿一致。",
        conclusion: "资料齐备，可以提交。",
        readyToSubmit: true,
      },
    );

    // 场景 A：采购到付款。
    const beforeAActionIds = new Set(store.executedActions.value.map((a: any) => a.id));
    const replenishCount = await store.runReplenish();
    expect(replenishCount).toBe(1);

    const replenishGate = pendingTask(store, "replenish-po", "P-003");
    expect(replenishGate.title).toContain("补货 PO 确认");
    store.approveReview(replenishGate.id, "C06 批准补货");

    const createdPo = store.pos.value[0];
    expect(createdPo).toMatchObject({
      sku: "P-003",
      supplier: "佛山场景供应商",
      qty: 240,
      unitCny: 42,
      amountCny: 10080,
      status: "pending_pay",
    });

    const payGate = pendingTask(store, "po-payment", createdPo.id);
    expect(payGate.hardGate).toBe(true);
    store.approveReview(payGate.id, "C06 批准付款");
    expect(createdPo.status).toBe("paid");

    const aActions = actionsSince(store, beforeAActionIds);
    expect(aActions.map((a: any) => a.kind)).toEqual(["po-payment", "replenish-po"]);
    expect(aActions.every((a: any) => a.refId === createdPo.id && a.by === "human")).toBe(true);
    expectAutonomyStatsConserved(store);

    // 场景 B：订单到发货，低值自动出单，高值进渠道闸后出单。
    const lowOrder = store.orders.value.find((o: any) => o.id === "305-882");
    expect(lowOrder?.status).toBe("pending");
    const lowRouteResult = await store.runRoute(lowOrder.id);
    expect(lowRouteResult).toBe("auto");
    expect(lowOrder.status).toBe("shipped");
    const lowShipment = store.shipments.value.find((s: any) => s.orderId === lowOrder.id && s.id === lowOrder.trackingNo);
    expect(lowShipment).toMatchObject({ channel: "4PX 联邮通标快", status: "已出单" });
    expect(store.executedActions.value[0]).toMatchObject({ kind: "logistics-channel", refId: lowShipment.id, by: "auto" });

    store.orders.value.unshift({
      id: "C06-HV-ORDER",
      platform: "Amazon US",
      sku: "P-003",
      goods: "高值收纳凳套装",
      qty: 30,
      amountUsd: 980,
      country: "US",
      status: "pending",
      placedAt: "07-07",
    } as any);
    const highOrder = store.orders.value[0];
    const highRouteResult = await store.runRoute(highOrder.id);
    expect(highRouteResult).toBe("review");
    expect(highOrder.status).toBe("pending");

    const channelGate = pendingTask(store, "logistics-channel", highOrder.id);
    store.approveReview(channelGate.id, "C06 批准高值渠道");
    expect(highOrder.status).toBe("shipped");
    const highShipment = store.shipments.value.find((s: any) => s.orderId === highOrder.id && s.id === highOrder.trackingNo);
    expect(highShipment).toMatchObject({ channel: "云途全球专线（普货）", status: "已出单" });
    expect(store.executedActions.value[0]).toMatchObject({ kind: "logistics-channel", refId: highShipment.id, by: "human" });
    expectAutonomyStatsConserved(store);

    // 场景 C：票据 OCR 到对账、月结。
    const beforeJournal = journalTotal(store);
    const autoDoc = await store.runOcr("顺丰同城收据 SF-C06-AUTO 金额 88");
    expect(autoDoc).toMatchObject({ no: "SF-C06-AUTO", booked: true });
    const autoEntry = store.journal.value.find((j: any) => j.docId === autoDoc?.id);
    expect(autoEntry).toMatchObject({ amountCny: 88, by: "auto" });

    const lowConfDoc = await store.runOcr("云途物流账单 YT-C06-LOW 金额字段低置信");
    expect(lowConfDoc).toMatchObject({ no: "YT-C06-LOW", booked: false });
    const ocrGate = pendingTask(store, "ocr-book", lowConfDoc?.id);
    store.approveReview(ocrGate.id, "C06 核对后入账");
    expect(lowConfDoc?.booked).toBe(true);
    const lowConfEntry = store.journal.value.find((j: any) => j.docId === lowConfDoc?.id);
    expect(lowConfEntry).toMatchObject({ amountCny: 321.45, by: "human" });

    const afterOcrJournal = journalTotal(store);
    expect(afterOcrJournal - beforeJournal).toBeCloseTo(409.45, 2);

    const reconRow = store.recon.value.find((r: any) => r.id === "R-24");
    expect(reconRow?.status).toBe("未达");
    await store.runRecon(reconRow.id);
    const reconGate = pendingTask(store, "recon-open", reconRow.id);
    store.approveReview(reconGate.id, "C06 确认 Temu 回款匹配");
    expect(reconRow.status).toBe("已匹配");

    const report = store.reports.value.find((r: any) => r.month === "2026-06");
    expect(report?.closed).toBe(false);
    const beforeCloseJournal = journalTotal(store);
    const beforeCloseNetProfit = report.netProfitCny;
    const monthCloseGate = pendingTask(store, "month-close", "2026-06");
    store.approveReview(monthCloseGate.id, "C06 月结确认");
    expect(report.closed).toBe(true);
    expect(report.netProfitCny).toBe(beforeCloseNetProfit);
    expect(journalTotal(store)).toBeCloseTo(beforeCloseJournal, 2);
    expectAutonomyStatsConserved(store);

    // 场景 D：报税检查到提交。
    const filing = store.filings.value.find((f: any) => f.id === "F-62");
    expect(filing?.status).toBe("preparing");
    // 就绪三重条件之一是本地资料包全齐：F-62 种子缺「申报表草稿」，先补齐再检查
    //（若不补齐，即使 AI mock 说 readyToSubmit 也必须维持 preparing —— 这正是防 LLM 幻觉提交的守卫）。
    filing.docsReady!.forEach((d: any) => { d.ok = true; });
    await store.runTaxCheck(filing.id);
    expect(filing.status).toBe("ready");

    const taxGate = pendingTask(store, "tax-filing", filing.id);
    expect(taxGate.hardGate).toBe(true);
    store.approveReview(taxGate.id, "C06 批准申报提交");
    expect(filing.status).toBe("submitted");

    expectAutonomyStatsConserved(store);
    expectReviewColumnsConserved(store);
    expect(store.journal.value.every((entry: any) => Number.isFinite(entry.amountCny))).toBe(true);
    expect(h.runJsonQueue).toHaveLength(0);
    expect(h.calls.filter((call) => call.fn === "runJson")).toHaveLength(7);
  });
});
