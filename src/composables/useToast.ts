// 全局统一 toast 队列(模块级单例)。任何组件/store/全局错误兜底都从这里报给用户,
// 取代此前 copy-toast / message ref / banner ref / alert 各自为政的四套通知。
import { ref } from "vue";

export type ToastKind = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  /** ms;error 默认更久 */
  duration: number;
}

const items = ref<ToastItem[]>([]);
let seq = 0;

function push(kind: ToastKind, text: string, duration?: number) {
  const raw = (text || "").trim();
  if (!raw) return;
  // 先截断成最终展示形态, 再用它去重: 否则 >240 字的错误(入队时被截断存储)会因为
  // 「已存的截断串 !== 新来的完整串」而绕过去重、每次都堆一条。两侧都用同一 normalized 形态比。
  const t = raw.length > 240 ? raw.slice(0, 240) + "…" : raw;
  // 相同文案在屏不重复堆叠(高频错误轰炸保护)
  if (items.value.some((i) => i.text === t && i.kind === kind)) return;
  const item: ToastItem = {
    id: ++seq,
    kind,
    text: t,
    duration: duration ?? (kind === "error" ? 6000 : 2600),
  };
  items.value.push(item);
  // 最多同屏 4 条,旧的先走
  if (items.value.length > 4) items.value.shift();
  setTimeout(() => dismiss(item.id), item.duration);
}

function dismiss(id: number) {
  const i = items.value.findIndex((t) => t.id === id);
  if (i >= 0) items.value.splice(i, 1);
}

export const toast = {
  success: (text: string, duration?: number) => push("success", text, duration),
  error: (text: string, duration?: number) => push("error", text, duration),
  info: (text: string, duration?: number) => push("info", text, duration),
};

/** ToastHost 渲染用 */
export function useToastQueue() {
  return { items, dismiss };
}
