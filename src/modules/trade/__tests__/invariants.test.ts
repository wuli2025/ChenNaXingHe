import { describe, it, expect, vi } from "vitest";
import {
  computeWineTax,
  REVIEW_COLUMNS,
  REVIEW_KIND_META,
  round2,
  TAX,
  type ReviewKind,
  type ReviewRisk,
} from "../types";

const h = vi.hoisted(() => ({
  runResult: { value: "MOCK-TEXT" },
  runJsonResult: { value: {} as Record<string, unknown> },
  runJsonQueue: [] as Record<string, unknown>[],
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
      const data = h.runJsonQueue.length > 0 ? h.runJsonQueue.shift()! : h.runJsonResult.value;
      return { data, raw: JSON.stringify(data) };
    },
  }),
}));

async function freshStore() {
  vi.resetModules();
  localStorage.clear();
  h.runResult.value = "MOCK-TEXT";
  h.runJsonResult.value = {};
  h.runJsonQueue.length = 0;
  h.calls.length = 0;
  const mod = await import("../useTradeStore");
  return mod.useTradeStore();
}

function makeLcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function cents(n: number) {
  return Math.round(n * 100) / 100;
}

function pick<T>(rng: () => number, xs: T[]): T {
  return xs[Math.floor(rng() * xs.length)];
}

function columnIds(store: any) {
  return REVIEW_COLUMNS.flatMap((col) => store.reviewColumns.value[col.key].map((task: any) => task.id));
}

function expectReviewConservation(store: any) {
  const ids = columnIds(store);
  expect(ids.length).toBe(store.reviewTasks.value.length);
  expect(new Set(ids).size).toBe(store.reviewTasks.value.length);
}

function runJsonCalls() {
  return h.calls.filter((call) => call.fn === "runJson").length;
}

async function flushAsync() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("trade invariants · computeWineTax", () => {
  it("keeps cents-level tax math non-negative, monotonic, and clamped", () => {
    const zero = computeWineTax(0);
    expect(zero).toEqual({ taxable: 0, wet: 0, gstBase: 0, gst: 0, totalTax: 0, inclTotal: 0 });
    expect(computeWineTax(-1234.56)).toEqual(zero);

    const rng = makeLcg(0xc05);
    const taxableValues = Array.from({ length: 180 }, () => cents(rng() * 250000)).sort((a, b) => a - b);
    let prevInclTotal = -Infinity;

    for (const taxable of taxableValues) {
      const tax = computeWineTax(taxable);
      expect(Object.values(tax).every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
      expect(tax.inclTotal).toBeGreaterThanOrEqual(prevInclTotal);
      expect(tax.taxable).toBe(taxable);
      expect(tax.wet).toBe(round2(taxable * TAX.WET_RATE));
      expect(tax.gstBase).toBe(round2(taxable + taxable * TAX.WET_RATE));
      expect(tax.gst).toBe(round2((taxable + taxable * TAX.WET_RATE) * TAX.GST_RATE));
      expect(tax.totalTax).toBe(round2(taxable * TAX.WET_RATE + (taxable + taxable * TAX.WET_RATE) * TAX.GST_RATE));
      expect(tax.inclTotal).toBe(round2(taxable + taxable * TAX.WET_RATE + (taxable + taxable * TAX.WET_RATE) * TAX.GST_RATE));
      prevInclTotal = tax.inclTotal;
    }
  });
});

describe("trade invariants · review pipeline", () => {
  it("keeps the four review columns conserved under seeded random transitions", async () => {
    const store = await freshStore();
    const rng = makeLcg(0xc0505);
    const kinds: ReviewKind[] = [
      "sku-intake",
      "customs-draft",
      "doc-consistency",
      "compliance-release",
      "lead-convert",
      "rfq-send",
      "replenish",
      "milestone-anomaly",
    ];
    const risks: ReviewRisk[] = ["low", "normal", "high", "hard"];

    expectReviewConservation(store);
    for (let i = 0; i < 240; i += 1) {
      const action = Math.floor(rng() * 4);
      if (action === 0) {
        const kind = pick(rng, kinds);
        store.enqueueReview({
          mod: REVIEW_KIND_META[kind].mod,
          kind,
          title: `Invariant task ${i}`,
          refId: `REF-${Math.floor(rng() * 48)}`,
          summary: "random invariant task",
          facts: [],
          risk: pick(rng, risks),
        });
      } else if (action === 1) {
        const pending = store.reviewTasks.value.filter((task: any) => task.status === "pending");
        if (pending.length) store.claimReview(pick(rng, pending).id);
      } else if (action === 2) {
        const open = store.reviewTasks.value.filter((task: any) => task.status === "pending" || task.status === "in_review");
        if (open.length) store.approveReview(pick(rng, open).id, "seeded approve");
      } else {
        const open = store.reviewTasks.value.filter((task: any) => task.status === "pending" || task.status === "in_review");
        if (open.length) store.rejectReview(pick(rng, open).id, "seeded reject");
      }

      expectReviewConservation(store);
    }
  });

  it("dedupes unresolved review tasks by kind and refId", async () => {
    const store = await freshStore();
    const before = store.reviewTasks.value.length;

    const first = store.enqueueReview({
      mod: "m3",
      kind: "rfq-send",
      title: "RFQ dedupe first",
      refId: "RFQ-DEDUPE",
      summary: "first",
      facts: [],
      risk: "normal",
    });
    const pendingDup = store.enqueueReview({
      mod: "m3",
      kind: "rfq-send",
      title: "RFQ dedupe pending duplicate",
      refId: "RFQ-DEDUPE",
      summary: "duplicate",
      facts: [],
      risk: "high",
    });

    expect(store.reviewTasks.value.length).toBe(before + 1);
    expect(pendingDup?.id).toBe(first?.id);

    store.claimReview(first!.id);
    const inReviewDup = store.enqueueReview({
      mod: "m3",
      kind: "rfq-send",
      title: "RFQ dedupe in review duplicate",
      refId: "RFQ-DEDUPE",
      summary: "duplicate",
      facts: [],
      risk: "low",
    });

    expect(store.reviewTasks.value.length).toBe(before + 1);
    expect(inReviewDup?.id).toBe(first?.id);

    store.approveReview(first!.id);
    const afterResolved = store.enqueueReview({
      mod: "m3",
      kind: "rfq-send",
      title: "RFQ dedupe after resolved",
      refId: "RFQ-DEDUPE",
      summary: "new task after approval",
      facts: [],
      risk: "normal",
    });

    expect(store.reviewTasks.value.length).toBe(before + 2);
    expect(afterResolved?.id).not.toBe(first?.id);
  });

  it("reruns runJson-backed rejected tasks once, while non-rerunnable rejects stay quiet", async () => {
    const store = await freshStore();
    const reconItem = "报关行费 BRK-0621";

    h.runJsonQueue.push(
      { hsCode: "2204.29", reasoning: "retry hs", dutyRate: "5%", hsConf: 70, dutyConf: 60 },
      { candidates: [{ target: "BRK-0621 manual voucher", reason: "retry recon", conf: 72 }] },
    );

    const hsTask = store.enqueueReview({
      mod: "m4",
      kind: "hs-review",
      title: "HS rerun invariant",
      refId: "0621",
      summary: "low confidence",
      facts: [],
      risk: "high",
      origin: "ai",
      payload: { decId: "0621" },
    });
    const reconTask = store.enqueueReview({
      mod: "m8",
      kind: "recon-match",
      title: "Recon rerun invariant",
      refId: reconItem,
      summary: "candidate review",
      facts: [],
      risk: "normal",
      origin: "ai",
      payload: { item: reconItem },
    });

    const beforeRerun = runJsonCalls();
    store.rejectReview(hsTask!.id, "recheck hs");
    store.rejectReview(reconTask!.id, "recheck recon");
    await flushAsync();

    expect(runJsonCalls()).toBe(beforeRerun + 2);
    expect(hsTask?.reran).toBe(true);
    expect(reconTask?.reran).toBe(true);

    const nonRerunnable = store.enqueueReview({
      mod: "m9",
      kind: "compliance-release",
      title: "No rerun invariant",
      refId: "NO-RERUN",
      summary: "manual hard gate",
      facts: [],
      risk: "hard",
      hardGate: true,
    });
    const beforeNonRerun = runJsonCalls();
    store.rejectReview(nonRerunnable!.id, "manual reject");
    await flushAsync();

    expect(runJsonCalls()).toBe(beforeNonRerun);
  });
});

describe("trade invariants · invalid AI output", () => {
  it("ignores invalid replyClass enum values without changing lead state", async () => {
    const store = await freshStore();
    const lead = store.leads.value.find((item: any) => item.id === "L-2202");
    const before = {
      status: lead.status,
      replyClass: lead.replyClass,
      threadLength: lead.thread.length,
    };

    h.runJsonResult.value = { replyClass: "spam-folder", reason: "not allowed", conf: 99 };

    await expect(store.runReplyClass(lead.id, "This is not a valid business reply class.")).resolves.toBeNull();
    expect(lead.status).toBe(before.status);
    expect(lead.replyClass).toBe(before.replyClass);
    expect(lead.thread.length).toBe(before.threadLength);
  });

  it("ignores missing recon candidates without changing the recon row or queue", async () => {
    const store = await freshStore();
    const row = store.recon.value.find((item: any) => item.item === "报关行费 BRK-0621");
    const before = {
      match: row.match,
      conf: row.conf,
      status: row.status,
      reviewTasks: store.reviewTasks.value.length,
    };

    h.runJsonResult.value = { note: "missing candidates array" };

    await expect(store.runRecon(row.item)).resolves.toBe(true);
    expect(row.match).toBe(before.match);
    expect(row.conf).toBe(before.conf);
    expect(row.status).toBe(before.status);
    expect(store.reviewTasks.value.length).toBe(before.reviewTasks);
  });

  it("BUG-FIXED: missing HS fields should not reset existing declaration confidence", async () => {
    const store = await freshStore();
    const dec = store.declarations.value.find((item: any) => item.id === "0621");
    const line = dec.lines[0];
    const before = {
      hs: line.hs,
      hsConf: line.hsConf,
      dutyRate: line.dutyRate,
      dutyConf: line.dutyConf,
      hsComplete: dec.hsComplete,
      reviewTasks: store.reviewTasks.value.length,
    };

    h.runJsonResult.value = { reasoning: "missing hsCode, hsConf, dutyRate, dutyConf" };

    await store.runHsClassify(dec.id);
    expect(line.hs).toBe(before.hs);
    expect(line.hsConf).toBe(before.hsConf);
    expect(line.dutyRate).toBe(before.dutyRate);
    expect(line.dutyConf).toBe(before.dutyConf);
    expect(dec.hsComplete).toBe(before.hsComplete);
    expect(store.reviewTasks.value.length).toBe(before.reviewTasks);
  });

  it("BUG-FIXED: recon candidates missing target should not overwrite the recon row", async () => {
    const store = await freshStore();
    const row = store.recon.value.find((item: any) => item.item === "报关行费 BRK-0621");
    const before = {
      match: row.match,
      conf: row.conf,
      status: row.status,
      reviewTasks: store.reviewTasks.value.length,
    };

    h.runJsonResult.value = { candidates: [{ reason: "missing target", conf: 93 }] };

    await store.runRecon(row.item);
    expect(row.match).toBe(before.match);
    expect(row.conf).toBe(before.conf);
    expect(row.status).toBe(before.status);
    expect(store.reviewTasks.value.length).toBe(before.reviewTasks);
  });
});
