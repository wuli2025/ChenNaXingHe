/**
 * 财税守卫回归 —— 针对 2026-07 财税优化补的四道防线：
 *  1) 审批幂等：已决任务重复 approve/reject 不得二次执行回写
 *  2) 月结锁账真正生效：已锁月不再落凭证（计入当期并留痕）
 *  3) 对账挂账币种安全：$/€ 面额按记账汇率折 CNY，不得按面额直记
 *  4) 税务检查守卫：submitted/archived 申报不可重查回拉状态；taxAmount=0 不丢
 */
import { describe, it, expect, vi } from "vitest";

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

describe("财税守卫 · 审批幂等", () => {
  it("同一挂账任务重复 approve 只落一张凭证", async () => {
    const store = await freshStore();
    const r23 = store.recon.value.find((x) => x.id === "R-23");
    expect(r23?.side).toBe("费用挂账");
    const t = store.enqueueReview({
      mod: "e7", kind: "recon-open", title: "挂账确认", summary: "", facts: [],
      risk: "normal", origin: "ai", refId: "R-23", payload: { reconId: "R-23" },
    });
    const before = store.journal.value.length;
    store.approveReview(t!.id);
    expect(store.journal.value.length).toBe(before + 1);
    expect(store.journal.value[0].amountCny).toBeCloseTo(1285.1, 2);
    store.approveReview(t!.id); // 二次 approve 必须被幂等守卫拦下
    expect(store.journal.value.length).toBe(before + 1);
  });

  it("已驳回任务再 approve 不执行回写（月结不被锁）", async () => {
    const store = await freshStore();
    const t = store.reviewTasks.value.find((x) => x.kind === "month-close");
    expect(t).toBeTruthy();
    store.rejectReview(t!.id, "本月对账未闭合，先不锁");
    store.approveReview(t!.id);
    expect(store.reports.value.find((r) => r.month === "2026-06")?.closed).toBe(false);
    expect(t!.status).toBe("rejected");
  });
});

describe("财税守卫 · 月结锁账", () => {
  it("票面日期落在已锁月的票据，凭证计入当期并留痕", async () => {
    const store = await freshStore();
    const rep6 = store.reports.value.find((r) => r.month === "2026-06");
    expect(rep6).toBeTruthy();
    rep6!.closed = true;
    const doc = store.intakeDoc({
      type: "receipt", party: "锁账测试对手方", no: "LOCK-001",
      date: "2026-06-15", amount: 200, currency: "CNY", conf: 99, lowFields: [],
    });
    expect(doc.booked).toBe(true); // 高置信小额仍自动入账
    const j = store.journal.value.find((x) => x.docId === doc.id);
    expect(j).toBeTruthy();
    expect(j!.date.startsWith("2026-06")).toBe(false); // 但凭证绝不落进已锁月
    expect(j!.summary).toContain("已锁账");
    expect(j!.summary).toContain("2026-06-15"); // 原票日期留痕
  });

  it("未锁月照常按票面日期入账", async () => {
    const store = await freshStore();
    const doc = store.intakeDoc({
      type: "receipt", party: "开放月对手方", no: "OPEN-001",
      date: "2026-07-02", amount: 200, currency: "CNY", conf: 99, lowFields: [],
    });
    const j = store.journal.value.find((x) => x.docId === doc.id);
    expect(j!.date).toBe("2026-07-02");
    expect(j!.summary).not.toContain("已锁账");
  });
});

describe("财税守卫 · 挂账币种折算", () => {
  it("美元面额的费用挂账按记账汇率折 CNY", async () => {
    const store = await freshStore();
    const r24 = store.recon.value.find((x) => x.id === "R-24");
    expect(r24?.amount).toBe("$1,742.00");
    r24!.side = "费用挂账";
    const t = store.enqueueReview({
      mod: "e7", kind: "recon-open", title: "美元挂账确认", summary: "", facts: [],
      risk: "normal", origin: "ai", refId: "R-24", payload: { reconId: "R-24" },
    });
    store.approveReview(t!.id);
    const j = store.journal.value[0];
    expect(j.summary).toContain("对账差异挂账");
    expect(j.summary).toContain("USD");
    expect(j.amountCny).toBeCloseTo(1742 * store.params.value.usdCny, 2); // 不是 1742
  });
});

describe("财税守卫 · 税务检查", () => {
  it("已提交申报不可重查：状态不回拉、不调 AI、不重新入闸", async () => {
    const store = await freshStore();
    const f = store.filings.value[0];
    f.status = "submitted";
    const callsBefore = h.calls.length;
    const gatesBefore = store.reviewTasks.value.length;
    const ok = await store.runTaxCheck(f.id);
    expect(ok).toBe(false);
    expect(f.status).toBe("submitted");
    expect(h.calls.length).toBe(callsBefore);
    expect(store.reviewTasks.value.length).toBe(gatesBefore);
  });

  it("非法币种（如 JPY）整单拒绝落库，不会被折算口径误当 EUR", async () => {
    const store = await freshStore();
    h.runJsonResult.value = {
      type: "receipt", party: "日元对手方", no: "JPY-001", date: "2026-07-01",
      amount: 1000, currency: "JPY", conf: 99, lowFields: [], suggestBundle: "",
    };
    const docsBefore = store.docs.value.length;
    const doc = await store.runOcr("日元小票");
    expect(doc).toBeNull();
    expect(store.docs.value.length).toBe(docsBefore);
  });

  it("非增值税发票（收据）的 taxAmount:0 不保存为 0（应为无税额 undefined）", async () => {
    const store = await freshStore();
    h.runJsonResult.value = {
      type: "receipt", party: "零税额对手方", no: "TA-000", date: "2026-07-01",
      amount: 88, currency: "CNY", taxAmount: 0, conf: 99, lowFields: [], suggestBundle: "",
    };
    const doc = await store.runOcr("零税额小票文本");
    expect(doc).toBeTruthy();
    expect(doc!.taxAmount).toBeUndefined(); // 非发票不应显示「税额 ¥0」
  });

  it("增值税发票的正税额正常保留", async () => {
    const store = await freshStore();
    h.runJsonResult.value = {
      type: "vat-invoice", party: "有税额供应商", no: "VAT-TA-1", date: "2026-07-01",
      amount: 1130, currency: "CNY", taxAmount: 130, conf: 99, lowFields: [], suggestBundle: "",
    };
    const doc = await store.runOcr("增值税发票文本");
    expect(doc!.taxAmount).toBe(130);
  });

  it("非就绪申报：不入提交闸，批准回写也拒绝置 submitted", async () => {
    const store = await freshStore();
    const f62 = store.filings.value.find((x) => x.id === "F-62");
    expect(f62?.status).toBe("preparing");
    const gatesBefore = store.reviewTasks.value.length;
    store.gateFilingSubmit("F-62"); // 非 ready 不入闸
    expect(store.reviewTasks.value.length).toBe(gatesBefore);
    // 即便有人绕过闸直接塞了一张卡片，批准回写也必须拒绝
    const t = store.enqueueReview({
      mod: "e8", kind: "tax-filing", title: "绕闸卡片", summary: "", facts: [],
      risk: "hard", origin: "ai", hardGate: true, refId: "F-62", payload: { filingId: "F-62" },
    });
    store.approveReview(t!.id);
    expect(f62!.status).toBe("preparing");
  });

  it("AI 判就绪但本地资料包未齐时维持 preparing，不入提交闸", async () => {
    const store = await freshStore();
    const f62 = store.filings.value.find((x) => x.id === "F-62")!; // 种子缺「申报表草稿」
    h.runJsonResult.value = { issues: [], missingDocs: [], amountCheck: "一致", conclusion: "可提交", readyToSubmit: true };
    const gatesBefore = store.reviewTasks.value.length;
    await store.runTaxCheck(f62.id);
    expect(f62.status).toBe("preparing");
    expect(store.reviewTasks.value.length).toBe(gatesBefore);
  });
});

describe("财税守卫 · 票据入账", () => {
  it("增值税发票价税分离：进项税单独挂应交税费，两笔合计等于票面", async () => {
    const store = await freshStore();
    const doc = store.intakeDoc({
      type: "vat-invoice", party: "价税分离供应商", no: "VAT-SPLIT-1",
      date: "2026-07-03", amount: 1130, currency: "CNY", taxAmount: 130, conf: 99, lowFields: [],
    });
    expect(doc.booked).toBe(true);
    const entries = store.journal.value.filter((j) => j.docId === doc.id);
    expect(entries).toHaveLength(2);
    const tax = entries.find((j) => j.debit.includes("进项税额"))!;
    const net = entries.find((j) => !j.debit.includes("进项税额"))!;
    expect(tax.amountCny).toBeCloseTo(130, 2);
    expect(net.amountCny).toBeCloseTo(1000, 2);
  });

  it("同号票已入账后，第二张即便人工批准也拒绝重复记账", async () => {
    const store = await freshStore();
    const first = store.intakeDoc({
      type: "receipt", party: "重复票对手方", no: "DUP-100",
      date: "2026-07-03", amount: 300, currency: "CNY", conf: 99, lowFields: [],
    });
    expect(first.booked).toBe(true);
    const second = store.intakeDoc({
      type: "receipt", party: "重复票对手方", no: "DUP-100",
      date: "2026-07-03", amount: 300, currency: "CNY", conf: 99, lowFields: [],
    });
    expect(second.dupCheck).toBe("dup"); // 自动路径已拦截，进入审批
    const t = store.reviewTasks.value.find((x) => x.kind === "ocr-book" && x.refId === second.id);
    expect(t).toBeTruthy();
    const journalBefore = store.journal.value.length;
    store.approveReview(t!.id, "看走眼了，批了");
    expect(second.booked).toBe(false); // 账本防线兜底：人工批准也不能重复入账
    expect(store.journal.value.length).toBe(journalBefore);
  });

  it("汇率快照：入闸后改 usdCny 参数，批准入账仍按入闸时汇率折算", async () => {
    const store = await freshStore();
    const fxAtIntake = store.params.value.usdCny; // 7.12
    const doc = store.intakeDoc({
      type: "logistics-bill", party: "美元账单商", no: "FX-SNAP-1",
      date: "2026-07-03", amount: 100, currency: "USD", conf: 50, lowFields: [], // 低置信 → 入闸
    });
    expect(doc.booked).toBe(false);
    store.setParam("usdCny", 7.5); // 非关键参数，直接生效
    expect(store.params.value.usdCny).toBe(7.5);
    const t = store.reviewTasks.value.find((x) => x.kind === "ocr-book" && x.refId === doc.id);
    store.approveReview(t!.id);
    const j = store.journal.value.find((x) => x.docId === doc.id)!;
    expect(j.amountCny).toBeCloseTo(100 * fxAtIntake, 2); // 712，不是 750
  });

  it("种子账实一致：每张 booked 票据凭证合计等于按口径折算额", async () => {
    const store = await freshStore();
    const { round2 } = await import("../types");
    const fx = (cur: string, amt: number) => (cur === "CNY" ? amt : cur === "USD" ? amt * store.params.value.usdCny : amt * store.params.value.usdCny * store.params.value.eurUsd);
    for (const d of store.docs.value.filter((x) => x.booked)) {
      const entries = store.journal.value.filter((j) => j.docId === d.id);
      expect(entries.length, `${d.id} 缺凭证`).toBeGreaterThan(0);
      const sum = round2(entries.reduce((s, j) => s + j.amountCny, 0));
      expect(sum, `${d.id} 凭证合计与折算额不符`).toBeCloseTo(round2(fx(d.currency, d.amount)), 2);
    }
  });

  it("增值税发票税额≥票面时拒绝入账（非法发票不落库污染进项）", async () => {
    const store = await freshStore();
    const doc = store.intakeDoc({
      type: "vat-invoice", party: "异常税额供应商", no: "BADTAX-1",
      date: "2026-07-03", amount: 100, currency: "CNY", taxAmount: 100, conf: 99, lowFields: [],
    });
    expect(doc.booked).toBe(false);
    expect(store.journal.value.some((j) => j.docId === doc.id)).toBe(false);
  });
});

describe("财税守卫 · 第二轮（codex 复审）", () => {
  it("OCR 缺失币种不再默认 CNY，整单拒绝落库", async () => {
    const store = await freshStore();
    h.runJsonResult.value = {
      type: "receipt", party: "缺币种对手方", no: "NOCUR-1", date: "2026-07-07",
      amount: 100, conf: 99, lowFields: [], suggestBundle: "", // 无 currency 字段
    };
    const docsBefore = store.docs.value.length;
    const doc = await store.runOcr("缺币种小票");
    expect(doc).toBeNull();
    expect(store.docs.value.length).toBe(docsBefore);
  });

  it("无 docsReady 的申报（F-64）即便 AI 判就绪也维持 preparing，不入提交闸", async () => {
    const store = await freshStore();
    const f64 = store.filings.value.find((x) => x.id === "F-64")!;
    expect(f64.docsReady).toBeUndefined();
    h.runJsonResult.value = { issues: [], missingDocs: [], amountCheck: "一致", conclusion: "可提交", readyToSubmit: true };
    const gatesBefore = store.reviewTasks.value.length;
    await store.runTaxCheck(f64.id);
    expect(f64.status).toBe("preparing");
    expect(store.reviewTasks.value.length).toBe(gatesBefore);
  });

  it("双锁月：票面月与当期月都已锁时，延期凭证不落进任一已锁月", async () => {
    const store = await freshStore();
    const { round2 } = await import("../types");
    void round2;
    const todayMonth = new Date();
    const curMonth = `${todayMonth.getFullYear()}-${String(todayMonth.getMonth() + 1).padStart(2, "0")}`;
    // 锁 2026-06 与当前月
    store.reports.value.find((r) => r.month === "2026-06")!.closed = true;
    if (!store.reports.value.some((r) => r.month === curMonth)) {
      store.reports.value.push({ month: curMonth, gmvUsd: 0, netProfitCny: 0, marginPct: 0, cashCny: 0, closed: true } as any);
    } else {
      store.reports.value.find((r) => r.month === curMonth)!.closed = true;
    }
    const doc = store.intakeDoc({
      type: "receipt", party: "双锁月对手方", no: "DBL-LOCK-1",
      date: "2026-06-15", amount: 200, currency: "CNY", conf: 99, lowFields: [],
    });
    expect(doc.booked).toBe(true);
    const j = store.journal.value.find((x) => x.docId === doc.id)!;
    const postedMonth = j.date.slice(0, 7);
    const closedMonths = store.reports.value.filter((r) => r.closed).map((r) => r.month);
    expect(closedMonths).not.toContain(postedMonth); // 绝不落进任何已锁月
  });

  it("斜杠日期在入库前即被拒绝（核心字段校验只认 YYYY-MM-DD）", async () => {
    const store = await freshStore();
    expect(() => store.intakeDoc({
      type: "receipt", party: "斜杠日期对手方", no: "SLASH-1",
      date: "2026/06/15", amount: 200, currency: "CNY", conf: 99, lowFields: [],
    })).toThrow();
    // monthKey 仍对斜杠容错（内部防御），锁账识别不依赖票据日期格式
    store.reports.value.find((r) => r.month === "2026-06")!.closed = true;
    const doc = store.intakeDoc({
      type: "receipt", party: "正常日期对手方", no: "DASH-1",
      date: "2026-06-15", amount: 200, currency: "CNY", conf: 99, lowFields: [],
    });
    const j = store.journal.value.find((x) => x.docId === doc.id)!;
    expect(j.date.slice(0, 7)).not.toBe("2026-06"); // 6 月已锁，未落进 6 月
  });

  it("resetReview 拒绝重开已有更新待审卡的旧驳回卡", async () => {
    const store = await freshStore();
    // 手动构造：同 kind+refId 一张 rejected（旧）+ 一张 pending（新，模拟自动重跑产物）
    const oldCard = store.enqueueReview({
      mod: "e3", kind: "price-change", title: "旧提案", summary: "", facts: [],
      risk: "high", origin: "ai", refId: "P-X@Amazon US", payload: { newPrice: 10 },
    })!;
    store.rejectReview(oldCard.id, "驳回，改价太低");
    expect(oldCard.status).toBe("rejected");
    const newCard = store.enqueueReview({
      mod: "e3", kind: "price-change", title: "重跑新提案", summary: "", facts: [],
      risk: "high", origin: "ai", refId: "P-X@Amazon US", payload: { newPrice: 18 },
    })!;
    expect(newCard.status).toBe("pending");
    store.resetReview(oldCard.id); // 应被拒绝
    expect(oldCard.status).toBe("rejected");
  });

  it("正常重开：无更新待审卡时，已驳回卡可重开为 pending", async () => {
    const store = await freshStore();
    const card = store.enqueueReview({
      mod: "e3", kind: "price-change", title: "单卡提案", summary: "", facts: [],
      risk: "high", origin: "ai", refId: "P-Y@Temu", payload: { newPrice: 10 },
    })!;
    store.rejectReview(card.id, "先驳回");
    expect(card.status).toBe("rejected");
    store.resetReview(card.id);
    expect(card.status).toBe("pending");
  });

  it("费用挂账保留负号：-$100 冲回记为负数 CNY", async () => {
    const store = await freshStore();
    const r = store.recon.value.find((x) => x.id === "R-24")!;
    r.side = "费用挂账";
    r.amount = "-$100.00";
    const t = store.enqueueReview({
      mod: "e7", kind: "recon-open", title: "负数挂账", summary: "", facts: [],
      risk: "normal", origin: "ai", refId: "R-24", payload: { reconId: "R-24" },
    })!;
    store.approveReview(t.id);
    const j = store.journal.value[0];
    expect(j.amountCny).toBeCloseTo(-100 * store.params.value.usdCny, 2);
  });
});

describe("财税守卫 · 第三轮（codex 终审）", () => {
  it("OCR 原型链键（toString/__proto__）不被误判为合法票种", async () => {
    const store = await freshStore();
    for (const badType of ["toString", "constructor", "__proto__"]) {
      h.runJsonResult.value = {
        type: badType, party: "原型污染", no: "PROTO-1", date: "2026-07-07",
        amount: 100, currency: "CNY", conf: 99, lowFields: [], suggestBundle: "",
      };
      const doc = await store.runOcr("原型链票种");
      expect(doc).toBeNull();
    }
  });

  it("OCR 缺票号/对手方/非法日期一律拒绝落库", async () => {
    const store = await freshStore();
    const bad = [
      { party: "", no: "N-1", date: "2026-07-07" },
      { party: "对手方", no: "", date: "2026-07-07" },
      { party: "对手方", no: "N-1", date: "" },
      { party: "对手方", no: "N-1", date: "2026/07/07" }, // 非 YYYY-MM-DD
      { party: "对手方", no: "N-1", date: "2026-13-40" }, // 无效日期
    ];
    for (const b of bad) {
      h.runJsonResult.value = { type: "receipt", amount: 100, currency: "CNY", conf: 99, lowFields: [], suggestBundle: "", ...b };
      const docsBefore = store.docs.value.length;
      const doc = await store.runOcr("字段缺失票");
      expect(doc, JSON.stringify(b)).toBeNull();
      expect(store.docs.value.length).toBe(docsBefore);
    }
  });

  it("增值税发票税额占比>20%（异常税率）拒绝入账，合规11.5%正常拆分", async () => {
    const store = await freshStore();
    const bad = store.intakeDoc({
      type: "vat-invoice", party: "异常税率", no: "RATE-BAD",
      date: "2026-07-03", amount: 100, currency: "CNY", taxAmount: 90, conf: 99, lowFields: [],
    });
    expect(bad.booked).toBe(false);
    const ok = store.intakeDoc({
      type: "vat-invoice", party: "合规税率", no: "RATE-OK",
      date: "2026-07-03", amount: 1130, currency: "CNY", taxAmount: 130, conf: 99, lowFields: [],
    });
    expect(ok.booked).toBe(true);
    expect(store.journal.value.filter((j) => j.docId === ok.id)).toHaveLength(2);
  });

  it("toCny 非法币种按 1:1 处理，不被误当 EUR 放大", async () => {
    const store = await freshStore();
    // 模拟持久化写入的非法币种票据（绕过 runOcr 校验），bookDoc 币种防线应拒绝
    const doc: any = {
      id: "D-JPY", type: "receipt", party: "日元遗留", no: "JPY-LEGACY",
      date: "2026-07-03", amount: 1000, currency: "JPY", conf: 99, booked: false, dupCheck: "ok",
    };
    store.docs.value.unshift(doc);
    store.bookDoc(doc, "human");
    expect(doc.booked).toBe(false); // 币种防线拒绝，未生成凭证
    expect(store.journal.value.some((j) => j.docId === "D-JPY")).toBe(false);
  });

  it("全期锁账兜底：票面月及此后各期全锁时拒绝入账，不污染已锁期", async () => {
    const store = await freshStore();
    // 把所有已存在月份 + 未来 130 个月全部标记为已锁
    const base = new Date("2026-06-01T00:00:00");
    for (let i = 0; i < 140; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!store.reports.value.some((r) => r.month === mk)) {
        store.reports.value.push({ month: mk, gmvUsd: 0, netProfitCny: 0, marginPct: 0, cashCny: 0, closed: true } as any);
      } else {
        store.reports.value.find((r) => r.month === mk)!.closed = true;
      }
    }
    const doc = store.intakeDoc({
      type: "receipt", party: "全锁月对手方", no: "ALL-LOCK-1",
      date: "2026-06-15", amount: 200, currency: "CNY", conf: 99, lowFields: [],
    });
    expect(doc.booked).toBe(false);
    expect(store.journal.value.some((j) => j.docId === doc.id)).toBe(false);
  });

  it("dueFilings 按截止日升序，驾驶舱最近截止取真正最早的一项", async () => {
    const store = await freshStore();
    const dues = store.dueFilings.value.map((f) => f.due);
    const sorted = [...dues].sort((a, b) => a.localeCompare(b));
    expect(dues).toEqual(sorted);
  });
});

describe("财税守卫 · 第四轮（codex 终审）", () => {
  it("对账候选 target 为空时不写回、不入闸、不假闭合", async () => {
    const store = await freshStore();
    const r = store.recon.value.find((x) => x.id === "R-24")!; // 未达
    const before = { status: r.status, match: r.match };
    const gatesBefore = store.reviewTasks.value.length;
    h.runJsonResult.value = { candidates: [{ target: "", reason: "没找到", conf: 80 }] };
    await store.runRecon("R-24");
    expect(r.status).toBe(before.status); // 仍「未达」
    expect(r.match).toBe(before.match);
    expect(store.reviewTasks.value.length).toBe(gatesBefore); // 未入闸
  });

  it("对账候选缺 target 字段同样不写回", async () => {
    const store = await freshStore();
    const r = store.recon.value.find((x) => x.id === "R-24")!;
    h.runJsonResult.value = { candidates: [{ reason: "缺字段", conf: 90 }] };
    await store.runRecon("R-24");
    expect(r.status).toBe("未达");
  });

  it("OCR 不存在的历日（2026-02-31）拒绝落库，闰年真实日期通过", async () => {
    const store = await freshStore();
    for (const bad of ["2026-02-31", "2026-04-31", "2026-13-01", "2025-02-29"]) {
      h.runJsonResult.value = { type: "receipt", party: "日期对手方", no: "DT-" + bad, date: bad, amount: 100, currency: "CNY", conf: 99, lowFields: [], suggestBundle: "" };
      expect(await store.runOcr("历日票"), bad).toBeNull();
    }
    h.runJsonResult.value = { type: "receipt", party: "闰年对手方", no: "LEAP-1", date: "2024-02-29", amount: 100, currency: "CNY", conf: 99, lowFields: [], suggestBundle: "" };
    const ok = await store.runOcr("闰年票");
    expect(ok).toBeTruthy();
    expect(ok!.date).toBe("2024-02-29");
  });

  it("补货 PO 负数量/负单价被拒绝建单，不生成负额 PO 与付款闸", async () => {
    const store = await freshStore();
    const posBefore = store.pos.value.length;
    const t = store.enqueueReview({
      mod: "e6", kind: "replenish-po", title: "污染补货", summary: "", facts: [],
      risk: "high", origin: "ai", refId: "P-BAD", payload: { sku: "P-BAD", goods: "坏货", qty: -10, unitCny: 100, supplier: "X" },
    })!;
    store.approveReview(t.id);
    expect(store.pos.value.length).toBe(posBefore); // 未建 PO
    expect(store.pos.value.some((p) => p.amountCny < 0)).toBe(false);
  });

  it("直接以非法币种调 intakeDoc 抛错拒绝，不落僵尸票据", async () => {
    const store = await freshStore();
    const docsBefore = store.docs.value.length;
    expect(() => store.intakeDoc({
      type: "receipt", party: "日元直调", no: "JPY-DIRECT",
      date: "2026-07-03", amount: 1000, currency: "JPY" as any, conf: 99, lowFields: [],
    })).toThrow();
    expect(store.docs.value.length).toBe(docsBefore);
  });

  it("未来票面月已锁、当期未锁：延期日期不早于票面日期", async () => {
    const store = await freshStore();
    const now = new Date();
    // 取「今天 + 2 个月」作为未来锁月，避免依赖固定系统日期
    const fut = new Date(now.getFullYear(), now.getMonth() + 2, 1);
    const futMk = `${fut.getFullYear()}-${String(fut.getMonth() + 1).padStart(2, "0")}`;
    store.reports.value.push({ month: futMk, gmvUsd: 0, netProfitCny: 0, marginPct: 0, cashCny: 0, closed: true } as any);
    const doc = store.intakeDoc({
      type: "receipt", party: "未来锁月对手方", no: "FUT-1",
      date: `${futMk}-15`, amount: 200, currency: "CNY", conf: 99, lowFields: [],
    });
    expect(doc.booked).toBe(true);
    const j = store.journal.value.find((x) => x.docId === doc.id)!;
    expect(j.date >= `${futMk}-01`).toBe(true); // 不倒挂到今天（今天早于该未来月）
    expect(store.reports.value.some((r) => r.closed && r.month === j.date.slice(0, 7))).toBe(false);
  });
});

describe("财税守卫 · 第五轮（codex 终审：深度纵深）", () => {
  it("采购付款复核 PO 自洽：金额与量价不符的脏 PO 批准被拒，卡片退回待审", async () => {
    const store = await freshStore();
    const po: any = { id: "PO-DIRTY", supplier: "脏数据供应商", sku: "P-X", goods: "货", qty: 10, unitCny: 50, amountCny: -9999, status: "pending_pay", grnOk: false, invoiceOk: true };
    store.pos.value.unshift(po);
    const t = store.enqueueReview({
      mod: "e6", kind: "po-payment", title: "脏PO付款", summary: "", facts: [],
      risk: "hard", origin: "ai", hardGate: true, refId: "PO-DIRTY", payload: { poId: "PO-DIRTY" },
    })!;
    store.approveReview(t.id);
    expect(po.status).toBe("pending_pay"); // 未付款
    expect(t.status).not.toBe("approved"); // 卡片回滚，不停留在已批准假象
  });

  it("负数量脏 PO 付款被拒", async () => {
    const store = await freshStore();
    const po: any = { id: "PO-NEG", supplier: "负量", sku: "P-Y", goods: "货", qty: -5, unitCny: 100, amountCny: -500, status: "pending_pay", grnOk: false, invoiceOk: true };
    store.pos.value.unshift(po);
    const t = store.enqueueReview({
      mod: "e6", kind: "po-payment", title: "负量PO付款", summary: "", facts: [],
      risk: "hard", origin: "ai", hardGate: true, refId: "PO-NEG", payload: { poId: "PO-NEG" },
    })!;
    store.approveReview(t.id);
    expect(po.status).toBe("pending_pay");
  });

  it("对账脏卡兜底：非费用挂账行 match 为空/状态非待确认时批准被拒，不假闭合", async () => {
    const store = await freshStore();
    const r = store.recon.value.find((x) => x.id === "R-24")!; // 未达 · 平台↔回款商 · match「未找到候选」
    const t = store.enqueueReview({
      mod: "e7", kind: "recon-open", title: "脏对账卡", summary: "", facts: [],
      risk: "normal", origin: "ai", refId: "R-24", payload: { reconId: "R-24" },
    })!;
    // 人为把 match 清空模拟脏卡
    r.match = "";
    store.approveReview(t.id);
    expect(r.status).toBe("未达"); // 未被假闭合为已匹配
    expect(t.status).not.toBe("approved"); // 卡片回滚
  });

  it("approveReview 回写失败时卡片回滚到待审（tax-filing 未就绪）", async () => {
    const store = await freshStore();
    const f62 = store.filings.value.find((x) => x.id === "F-62")!; // preparing
    const t = store.enqueueReview({
      mod: "e8", kind: "tax-filing", title: "未就绪申报", summary: "", facts: [],
      risk: "hard", origin: "ai", hardGate: true, refId: "F-62", payload: { filingId: "F-62" },
    })!;
    store.approveReview(t.id);
    expect(f62.status).toBe("preparing");
    expect(t.status).toBe("pending"); // 回滚，不是 approved
    expect(t.decidedAt).toBeUndefined();
  });

  it("bookDoc 对非法票种（原型链键）拒绝入账，不生成 undefined 科目凭证", async () => {
    const store = await freshStore();
    const bad: any = { id: "D-BADTYPE", type: "constructor", party: "坏票种", no: "BT-1", date: "2026-07-03", amount: 100, currency: "CNY", conf: 99, booked: false, dupCheck: "ok" };
    store.docs.value.unshift(bad);
    store.bookDoc(bad, "human");
    expect(bad.booked).toBe(false);
    expect(store.journal.value.some((j) => j.docId === "D-BADTYPE")).toBe(false);
  });

  it("对账伪候选「未找到候选」不写回、不入闸、不假闭合", async () => {
    const store = await freshStore();
    const r = store.recon.value.find((x) => x.id === "R-24")!; // 未达
    const gatesBefore = store.reviewTasks.value.length;
    h.runJsonResult.value = { candidates: [{ target: "未找到候选", reason: "确实没有", conf: 70 }] };
    await store.runRecon("R-24");
    expect(r.status).toBe("未达");
    expect(store.reviewTasks.value.length).toBe(gatesBefore);
  });

  it("对账脏卡 match 为伪候选占位时批准被拒", async () => {
    const store = await freshStore();
    const r = store.recon.value.find((x) => x.id === "R-24")!;
    r.status = "待确认";
    r.match = "无匹配"; // 伪候选
    const t = store.enqueueReview({
      mod: "e7", kind: "recon-open", title: "伪候选卡", summary: "", facts: [],
      risk: "normal", origin: "ai", refId: "R-24", payload: { reconId: "R-24" },
    })!;
    store.approveReview(t.id);
    expect(r.status).toBe("待确认"); // 未闭合
    expect(t.status).not.toBe("approved");
  });

  it("E5 选路：AI 返回不存在渠道/负运费时不自动出单，转人工闸", async () => {
    const store = await freshStore();
    const o = store.orders.value.find((x) => x.status === "pending" || x.status === "paid");
    if (!o) return; // 无合适订单则跳过
    const shipBefore = store.shipments.value.length;
    h.runJsonResult.value = { channel: "不存在的野鸡渠道", costCny: -50, reason: "乱选", confidence: 99 };
    const res = await store.runRoute(o.id);
    expect(res).not.toBe("auto"); // 不自动出单
    // 若走了 review，运单数不应因自动路径增加
    if (res === "review") expect(store.shipments.value.length).toBe(shipBefore);
  });

  it("logistics-channel 批准：脏 payload（空渠道/负运费）拒绝出单并回滚卡片", async () => {
    const store = await freshStore();
    const o = store.orders.value[0];
    const shipBefore = store.shipments.value.length;
    const t = store.enqueueReview({
      mod: "e5", kind: "logistics-channel", title: "脏出单卡", summary: "", facts: [],
      risk: "high", origin: "ai", refId: o.id, payload: { orderId: o.id, goods: o.goods, to: o.country, channel: "野鸡渠道", weightG: 100, costCny: -9 },
    })!;
    store.approveReview(t.id);
    expect(store.shipments.value.length).toBe(shipBefore); // 未出单
    expect(t.status).not.toBe("approved"); // 回滚
  });

  it("logistics-channel 批准：带电货被选到不可带电渠道时拒绝出单", async () => {
    const store = await freshStore();
    const o = store.orders.value[0];
    const shipBefore = store.shipments.value.length;
    // CH-1「云途全球专线（普货）」battery=false；带电货品「宠物饮水机」应被拒
    const t = store.enqueueReview({
      mod: "e5", kind: "logistics-channel", title: "带电错渠道", summary: "", facts: [],
      risk: "high", origin: "ai", refId: o.id, payload: { orderId: o.id, goods: "宠物饮水机", to: o.country, channel: "云途全球专线（普货）", weightG: 500, costCny: 40 },
    })!;
    store.approveReview(t.id);
    expect(store.shipments.value.length).toBe(shipBefore);
    expect(t.status).not.toBe("approved");
  });

  it("调价批准：拟价 NaN/Infinity 被拒绝，不污染价卡", async () => {
    const store = await freshStore();
    const card = store.prices.value[0];
    const priceBefore = card.currentUsd;
    const t = store.enqueueReview({
      mod: "e3", kind: "price-change", title: "脏调价", summary: "", facts: [],
      risk: "high", origin: "ai", refId: `${card.sku}@${card.platform}`, payload: { sku: card.sku, platform: card.platform, newPrice: Number.NaN },
    })!;
    store.approveReview(t.id);
    expect(card.currentUsd).toBe(priceBefore);
    expect(t.status).not.toBe("approved");
  });

  it("退款批准：已 done 的售后旧卡重开批准被拒（防重复退款）", async () => {
    const store = await freshStore();
    const as = store.afterSales.value.find((x) => x.status === "done");
    if (!as) return;
    const t = store.enqueueReview({
      mod: "e4", kind: "order-refund", title: "重复退款", summary: "", facts: [],
      risk: "hard", origin: "ai", hardGate: true, refId: as.id, payload: { afterSaleId: as.id },
    })!;
    const actionsBefore = store.executedActions.value.filter((a) => a.kind === "order-refund").length;
    store.approveReview(t.id);
    expect(store.executedActions.value.filter((a) => a.kind === "order-refund").length).toBe(actionsBefore);
    expect(t.status).not.toBe("approved");
  });

  it("出单批准：按当前订单实物判带电，payload 谎报普货也拒绝走不可带电渠道", async () => {
    const store = await freshStore();
    // 找一个带电货订单（宠物饮水机）；没有则构造
    let o = store.orders.value.find((x) => /饮水机|电/.test(x.goods) && x.status !== "shipped" && !x.trackingNo);
    if (!o) { o = { ...store.orders.value[0], id: "ORD-BAT", goods: "宠物饮水机 2.5L", status: "pending", trackingNo: undefined } as any; store.orders.value.unshift(o!); }
    const shipBefore = store.shipments.value.length;
    const t = store.enqueueReview({
      mod: "e5", kind: "logistics-channel", title: "谎报普货", summary: "", facts: [],
      risk: "high", origin: "ai", refId: o!.id, payload: { orderId: o!.id, goods: "普通货物", to: o!.country, channel: "云途全球专线（普货）", weightG: 500, costCny: 40 },
    })!;
    store.approveReview(t.id);
    expect(store.shipments.value.length).toBe(shipBefore); // 按订单实物是带电货，拒绝
    expect(t.status).not.toBe("approved");
  });

  it("采购付款：空供应商/待定供应商 PO 被拒付", async () => {
    const store = await freshStore();
    const po: any = { id: "PO-NOSUP", supplier: "待定供应商", sku: "P-1", goods: "货", qty: 10, unitCny: 50, amountCny: 500, status: "pending_pay", grnOk: true, invoiceOk: true };
    store.pos.value.unshift(po);
    const t = store.enqueueReview({
      mod: "e6", kind: "po-payment", title: "无对象付款", summary: "", facts: [],
      risk: "hard", origin: "ai", hardGate: true, refId: "PO-NOSUP", payload: { poId: "PO-NOSUP" },
    })!;
    store.approveReview(t.id);
    expect(po.status).toBe("pending_pay");
  });

  it("费用挂账：金额串无数字（—）解析为 0 时拒绝挂账", async () => {
    const store = await freshStore();
    const r = store.recon.value.find((x) => x.id === "R-23")!; // 费用挂账 · 待确认
    r.amount = "—";
    const t = store.enqueueReview({
      mod: "e7", kind: "recon-open", title: "零额挂账", summary: "", facts: [],
      risk: "normal", origin: "ai", refId: "R-23", payload: { reconId: "R-23" },
    })!;
    const jBefore = store.journal.value.length;
    store.approveReview(t.id);
    expect(store.journal.value.length).toBe(jBefore); // 未生成 0 元凭证
    expect(r.status).toBe("待确认");
  });

  it("月结幂等：已锁月再批准被拒（不重复记月结台账）", async () => {
    const store = await freshStore();
    const rep = store.reports.value.find((x) => x.month === "2026-06")!;
    rep.closed = true;
    const t = store.enqueueReview({
      mod: "e7", kind: "month-close", title: "重复月结", summary: "", facts: [],
      risk: "normal", origin: "ai", refId: "2026-06", payload: { month: "2026-06" },
    })!;
    store.approveReview(t.id);
    expect(t.status).not.toBe("approved");
  });

  it("OCR lowFields 返回字符串（非数组）时不产生僵尸票据", async () => {
    const store = await freshStore();
    h.runJsonResult.value = {
      type: "receipt", party: "字符串低置信", no: "LF-STR-1", date: "2026-07-07",
      amount: 100, currency: "CNY", conf: 80, lowFields: "金额", suggestBundle: "",
    };
    const doc = await store.runOcr("字符串 lowFields 票");
    expect(doc).toBeTruthy(); // 不抛错、不落僵尸
    expect(Array.isArray(doc!.lowFields)).toBe(true);
    expect(store.reviewTasks.value.some((t) => t.kind === "ocr-book" && t.refId === doc!.id)).toBe(true);
  });

  it("载入：localStorage 投毒 monthlyGmvTarget=0 被拒回退默认（防 Infinity 达成率）", async () => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem("cnxh.erp.params.v1", JSON.stringify({ monthlyGmvTarget: 0, dailyActionCap: 0 }));
    const mod = await import("../useErpStore");
    const store = mod.useErpStore();
    expect(store.params.value.monthlyGmvTarget).toBe(60000); // 越界回退默认
    expect(store.params.value.dailyActionCap).toBe(60);
    expect(store.dashKpi.value.every((k) => !/Infinity|NaN/.test(String(k.d)))).toBe(true);
  });

  it("载入：旧 schema 审批卡缺 facts 时补空数组（不一读即崩）", async () => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem("cnxh.erp.seeded.v1", JSON.stringify(true));
    localStorage.setItem("cnxh.erp.reviews.v1", JSON.stringify([
      { id: "rv-old", mod: "e7", kind: "ocr-book", status: "pending", title: "旧卡", summary: "无 facts 字段", risk: "normal", createdAt: 1 },
    ]));
    const mod = await import("../useErpStore");
    const store = mod.useErpStore();
    const card = store.reviewTasks.value.find((t) => t.id === "rv-old")!;
    expect(Array.isArray(card.facts)).toBe(true); // 补齐，组件 facts.length 不崩
  });

  it("参数：百分比参数 ≥100% 或使可变成本+利润≥100% 被拒（防 Infinity 保本价）", async () => {
    const store = await freshStore();
    expect(store.setParam("platformFeePct", 95)).toBe("invalid");
    expect(store.setParam("adCostPct", 120)).toBe("invalid");
    expect(store.setParam("platformFeePct", 20)).toBe("applied");
  });

  it("调价回写：保本价无法计算时回写失败并回滚卡片（不显示已批准）", async () => {
    const store = await freshStore();
    store.params.value = { ...store.params.value, platformFeePct: 95, adCostPct: 10, returnRatePct: 5 };
    const card = store.prices.value[0];
    const before = card.currentUsd;
    const t = store.enqueueReview({
      mod: "e3", kind: "price-change", title: "无穷保本价调价", summary: "", facts: [],
      risk: "high", origin: "ai", refId: `${card.sku}@${card.platform}`, payload: { sku: card.sku, platform: card.platform, newPrice: 25 },
    })!;
    store.approveReview(t.id);
    expect(card.currentUsd).toBe(before);
    expect(t.status).not.toBe("approved");
  });

  it("参数批准回写：等待期间其它费率变化使组合≥100% 时批准被拒", async () => {
    const store = await freshStore();
    const before = store.params.value.minMarginFloorPct;
    expect(store.setParam("minMarginFloorPct", 30)).toBe("review");
    store.params.value = { ...store.params.value, platformFeePct: 50, adCostPct: 25 };
    const t = store.reviewTasks.value.find((x) => x.kind === "param-change" && x.refId === "minMarginFloorPct" && x.status === "pending")!;
    store.approveReview(t.id);
    expect(store.params.value.minMarginFloorPct).toBe(before);
    expect(t.status).not.toBe("approved");
  });

  it("选路：AI 置信不足（<80）时不自动出单，转人工渠道闸", async () => {
    const store = await freshStore();
    const o = store.orders.value.find((x) => x.id === "305-882")!; // 低值 pending 单
    const shipBefore = store.shipments.value.length;
    h.runJsonResult.value = { channel: "4PX 联邮通标快", costCny: 26.3, reason: "低置信选路", confidence: 5 };
    const res = await store.runRoute(o.id);
    expect(res).not.toBe("auto"); // 低置信不自动出单
    expect(store.shipments.value.length).toBe(shipBefore);
  });

  it("选路：AI 高置信（≥80）+ 合法渠道时自动出单", async () => {
    const store = await freshStore();
    const o = store.orders.value.find((x) => x.id === "305-882")!;
    h.runJsonResult.value = { channel: "4PX 联邮通标快", costCny: 26.3, reason: "高置信选路", confidence: 92 };
    const res = await store.runRoute(o.id);
    expect(res).toBe("auto");
    expect(o.status).toBe("shipped");
  });

  it("出单幂等：订单已有运单时不重复出单", async () => {
    const store = await freshStore();
    const o = store.orders.value[0];
    const first = store.createShipment(o.id, o.goods, o.country, "云途全球专线（普货）", 100, 30, "r", "human");
    const shipCount = store.shipments.value.length;
    const second = store.createShipment(o.id, o.goods, o.country, "云途全球专线（普货）", 100, 30, "r", "human");
    expect(second).toBe(first); // 返回同一运单
    expect(store.shipments.value.length).toBe(shipCount); // 未新增
  });

  it("调价：保本价无法计算（费率≥100%）时拒绝落价，不产生 Infinity", async () => {
    const store = await freshStore();
    // 把可变费率推到 ≥100%，使 computeTargetPrice 返回 Infinity
    store.params.value = { ...store.params.value, platformFeePct: 95, adCostPct: 10 };
    const card = store.prices.value[0];
    const before = card.currentUsd;
    store.proposePriceChange(card.sku, card.platform, 25, "测试");
    expect(Number.isFinite(card.currentUsd)).toBe(true);
    expect(card.currentUsd).toBe(before); // 未被改成 Infinity
  });

  it("参数生效：key 与卡片 refId 不符时拒绝（防脏卡改错参数）", async () => {
    const store = await freshStore();
    const before = store.params.value.autoRefundCapUsd;
    const t = store.enqueueReview({
      mod: "e9", kind: "param-change", title: "错配参数卡", summary: "", facts: [],
      risk: "high", origin: "manual", refId: "minMarginFloorPct", payload: { key: "autoRefundCapUsd", to: 9999 },
    })!;
    store.approveReview(t.id);
    expect(store.params.value.autoRefundCapUsd).toBe(before); // 未被改
  });

  it("费用挂账幂等：已差异挂账后另建一张卡批准不再重复记账", async () => {
    const store = await freshStore();
    const r23 = store.recon.value.find((x) => x.id === "R-23")!;
    expect(r23.status).toBe("待确认"); // 种子改为待确认（未入账，与无种子凭证自洽）
    const t1 = store.enqueueReview({
      mod: "e7", kind: "recon-open", title: "挂账1", summary: "", facts: [],
      risk: "normal", origin: "ai", refId: "R-23", payload: { reconId: "R-23" },
    })!;
    const before = store.journal.value.length;
    store.approveReview(t1.id);
    expect(store.journal.value.length).toBe(before + 1);
    expect(r23.status).toBe("差异挂账");
    // 另建一张同 refId 的卡（脏卡场景），批准应被幂等 guard 拒绝
    const t2 = store.enqueueReview({
      mod: "e7", kind: "recon-open", title: "挂账2", summary: "", facts: [],
      risk: "normal", origin: "ai", refId: "R-23-dup", payload: { reconId: "R-23" },
    })!;
    store.approveReview(t2.id);
    expect(store.journal.value.length).toBe(before + 1); // 未重复记账
    expect(t2.status).not.toBe("approved"); // 卡片回滚
  });
});

describe("财税守卫 · 策略引擎与精度", () => {
  it("超上限退款走硬闸（资金红线口径与付款闸一致）", async () => {
    const store = await freshStore();
    const d = store.decide("order-refund", { amountUsd: store.params.value.autoRefundCapUsd + 1 });
    expect(d.mode).toBe("review");
    expect(d.hardGate).toBe(true);
  });

  it("round2 修正 IEEE 浮点分位误差", async () => {
    const { round2 } = await import("../types");
    expect(round2(1.005)).toBe(1.01);
    expect(round2(10.075)).toBe(10.08);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(2.6749)).toBe(2.67); // 真实低于 .5 的不受影响
  });

  it("round2 修正量封顶，超大金额不被错误进位", async () => {
    const { round2 } = await import("../types");
    expect(round2(5600000000000.004)).toBe(5600000000000); // 不会被放大的 EPSILON 顶成 .01
    expect(round2(12345.675)).toBe(12345.68);
    expect(round2(131241.315)).toBe(131241.32);
  });
});
