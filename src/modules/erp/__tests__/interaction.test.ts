/**
 * T5 审批中心安全交互测试：真实挂载 ApprovalBoard，用 DOM 断言和原生事件驱动。
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";

vi.mock("../../../composables/useAgentRunner", () => ({
  useAgentRunner: () => ({
    running: { value: false },
    run: async () => ({ raw: "MOCK" }),
    runJson: async () => ({ data: {}, raw: "{}" }),
  }),
}));

/* lib/markdown 里的异步增强（shiki/katex）在测试环境不需要 */
vi.mock("../../../lib/markdown", () => ({
  renderMarkdown: (t: string) => `<p>${t}</p>`,
  mdVersion: { value: 0 },
}));

type MountedApp = { app: App<Element>; host: HTMLElement };
const mounted: MountedApp[] = [];

afterEach(() => {
  while (mounted.length) {
    const item = mounted.pop()!;
    item.app.unmount();
    item.host.remove();
  }
  document.body.innerHTML = "";
});

async function mountBoard() {
  vi.resetModules();
  localStorage.clear();
  const storeMod = await import("../useErpStore");
  const board = await import("../review/ApprovalBoard.vue");
  const store = storeMod.useErpStore();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp(board.default);
  app.config.warnHandler = () => {};
  app.mount(host);
  mounted.push({ app, host });
  await nextTick();
  return { host, store };
}

function findCard(host: HTMLElement, title: string): HTMLElement {
  const card = Array.from(host.querySelectorAll<HTMLElement>(".card"))
    .find((el) => el.textContent?.includes(title));
  expect(card, `card not found: ${title}`).toBeTruthy();
  return card!;
}

function buttonByText(scope: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(scope.querySelectorAll<HTMLButtonElement>("button"))
    .find((el) => el.textContent?.includes(text));
  expect(button, `button not found: ${text}`).toBeTruthy();
  return button!;
}

function cardHasButton(scope: HTMLElement, text: string): boolean {
  return Array.from(scope.querySelectorAll<HTMLButtonElement>("button"))
    .some((el) => el.textContent?.includes(text));
}

async function click(el: Element) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await nextTick();
}

async function typeNote(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await nextTick();
}

function pendingTask(store: any, kind?: string) {
  const task = store.reviewTasks.value.find((t: any) => t.status === "pending" && (!kind || t.kind === kind));
  expect(task, `pending task not found${kind ? `: ${kind}` : ""}`).toBeTruthy();
  return task;
}

describe("审批中心交互 · T5", () => {
  it("批注 input 派发 Enter keydown 不会批准或驳回 pending 卡片", async () => {
    const { host, store } = await mountBoard();
    const task = pendingTask(store);
    const card = findCard(host, task.title);

    await click(card);
    const input = card.querySelector<HTMLInputElement>("input.note");
    expect(input).toBeTruthy();
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    await nextTick();

    expect(task.status).toBe("pending");
    expect(task.decidedAt).toBeUndefined();
    expect(store.executedActions.value.length).toBe(0);
  });

  it("批注为空时驳回按钮 disabled，输入文字后可用", async () => {
    const { host, store } = await mountBoard();
    const task = pendingTask(store);
    const card = findCard(host, task.title);

    await click(card);
    const reject = buttonByText(card, "驳回");
    expect(reject.disabled).toBe(true);

    const input = card.querySelector<HTMLInputElement>("input.note");
    expect(input).toBeTruthy();
    await typeNote(input!, "凭证不完整，先补材料");

    expect(reject.disabled).toBe(false);
  });

  it("批准卡无重开按钮；驳回卡有重开按钮且点击后回 pending", async () => {
    const { host, store } = await mountBoard();

    const approveTask = pendingTask(store, "month-close");
    let approveCard = findCard(host, approveTask.title);
    await click(approveCard);
    await click(buttonByText(approveCard, "批准执行"));
    expect(approveTask.status).toBe("approved");

    approveCard = findCard(host, approveTask.title);
    await click(approveCard);
    expect(cardHasButton(approveCard, "重开")).toBe(false);

    const rejectTask = pendingTask(store, "po-payment");
    let rejectCard = findCard(host, rejectTask.title);
    await click(rejectCard);
    const input = rejectCard.querySelector<HTMLInputElement>("input.note");
    expect(input).toBeTruthy();
    await typeNote(input!, "三单未齐，暂缓付款");
    await click(buttonByText(rejectCard, "驳回"));
    expect(rejectTask.status).toBe("rejected");

    rejectCard = findCard(host, rejectTask.title);
    await click(rejectCard);
    const reopen = buttonByText(rejectCard, "重开");
    await click(reopen);

    expect(rejectTask.status).toBe("pending");
  });

  it("硬闸卡片渲染强制人工标记文本", async () => {
    const { host, store } = await mountBoard();
    const hardGate = store.reviewTasks.value.find((t: any) => t.hardGate);
    expect(hardGate).toBeTruthy();

    const card = findCard(host, hardGate.title);
    const marker = card.querySelector<HTMLElement>(".e-human");

    expect(marker?.textContent).toContain("强制人工");
  });
});
