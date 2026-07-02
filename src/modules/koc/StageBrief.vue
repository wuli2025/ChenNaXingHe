<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { useKocStore } from "./useKocStore";
import BriefList from "./BriefList.vue";
import type { BriefTemplate } from "./types";

const store = useKocStore();
const form = reactive<BriefTemplate>({ ...store.briefTemplate.value });
const savedHint = ref(false);
const docText = ref("");

watch(
  () => store.briefTemplate.value,
  (t) => Object.assign(form, t)
);

function save() {
  store.setBriefTemplate({ ...form });
  savedHint.value = true;
  setTimeout(() => (savedHint.value = false), 2000);
}

async function extract() {
  if (!docText.value.trim()) return;
  await store.runBriefExtract(docText.value);
}

function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    docText.value = String(ev.target?.result || "");
  };
  reader.readAsText(file, "utf-8");
  // 重置输入值：否则取消后再次选同一文件不触发 change。
  input.value = "";
}
</script>

<template>
  <div class="stage">
    <header class="s-head">
      <div class="s-badge">📋</div>
      <div class="s-meta">
        <div class="s-kicker">STEP 01 · COLLABORATION BRIEF</div>
        <h2>合作 Brief 模板</h2>
        <p>填写本次 KOC 招募的产品与内容要求；保存后将作为评分上下文、AI 评判与脚本生成的依据。</p>
      </div>
    </header>

    <section class="glass">
      <div class="grid2">
        <label class="fg">
          <span class="lab"><i>📦</i>产品名称</span>
          <input v-model="form.product" placeholder="e.g. Infinix Hot 70" />
        </label>
        <label class="fg">
          <span class="lab"><i>✨</i>核心卖点 KSP</span>
          <input v-model="form.ksp" placeholder="e.g. 颜值设计 + 45W 快充" />
        </label>
        <label class="fg">
          <span class="lab"><i>🎯</i>目标人群</span>
          <input v-model="form.audience" placeholder="e.g. 拉各斯在校大学生 18-25 岁" />
        </label>
        <label class="fg">
          <span class="lab"><i>💰</i>官方售价</span>
          <input v-model="form.price" placeholder="e.g. ₦189,700" />
        </label>
        <label class="fg">
          <span class="lab"><i>🤝</i>合作形式</span>
          <input v-model="form.collabForm" placeholder="e.g. 免费寄样留用" />
        </label>
        <label class="fg">
          <span class="lab"><i>📈</i>投流预警播放量</span>
          <input v-model.number="form.boostThreshold" type="number" placeholder="20000" />
        </label>
        <label class="fg full">
          <span class="lab"><i>📝</i>内容要求 / 脚本方向</span>
          <textarea
            v-model="form.contentReq"
            rows="6"
            placeholder="描述视频必须传达的核心信息、竞品对比策略、禁止事项等…"
          />
        </label>
      </div>
      <div class="actions">
        <span class="hint">保存后用于评分上下文与脚本生成</span>
        <transition name="fade">
          <span v-if="savedHint" class="ok-hint">✅ 已保存</span>
        </transition>
        <button class="cta" @click="save">保存 Brief 模板</button>
      </div>
    </section>

    <section class="glass">
      <div class="card-t"><i>📄</i> 上传 / 粘贴 Brief 文档 → Claude 自动抽取字段</div>
      <label class="upload">
        <span class="up-ic">⬆︎</span>
        <span class="up-tx"><b>选择文件</b>（txt / md / csv）或粘贴到下方</span>
        <input type="file" accept=".txt,.md,.csv" hidden @change="onFile" />
      </label>
      <textarea
        v-model="docText"
        rows="5"
        placeholder="或直接把 Brief 文档内容粘贴到这里…"
        class="doc-ta"
      />
      <div class="actions end">
        <button class="ghost" :disabled="store.busy.value || !docText.trim()" @click="extract">
          🤖 让 Claude 抽取并填入上表
        </button>
      </div>
    </section>

    <BriefList />
  </div>
</template>

<style scoped>
.stage {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ── header ───────────────────────────────────────────── */
.s-head {
  display: flex;
  align-items: center;
  gap: 14px;
}
.s-badge {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-size: 22px;
  background: linear-gradient(
    155deg,
    color-mix(in srgb, var(--primary) 16%, var(--panel)),
    var(--panel)
  );
  border: 1px solid var(--hairline);
  box-shadow: var(--shadow), inset 0 1px 0 rgba(255, 255, 255, 0.6);
}
.s-kicker {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.6px;
  margin-bottom: 2px;
  background: linear-gradient(90deg, var(--primary), var(--gold));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.s-head h2 {
  font-family: var(--serif);
  font-size: 19px;
  font-weight: 600;
  color: var(--ink);
  margin: 0;
  line-height: 1.2;
}
.s-head p {
  font-size: 12px;
  color: var(--muted);
  margin: 3px 0 0;
  max-width: 620px;
  line-height: 1.6;
}

/* ── 琉璃玻璃卡片 (Liquid Glass) ──────────────────────── */
.glass {
  position: relative;
  overflow: hidden;
  border-radius: 18px;
  padding: 22px;
  border: 1px solid var(--hairline);
  background: linear-gradient(
    160deg,
    color-mix(in srgb, var(--panel) 88%, transparent),
    color-mix(in srgb, var(--panel) 62%, transparent)
  );
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  box-shadow: var(--shadow-lg), inset 0 1px 0 rgba(255, 255, 255, 0.55);
}
/* 顶部一缕高光描边 —— 玻璃的镜面感 */
.glass::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--primary) 45%, transparent),
    color-mix(in srgb, var(--gold) 55%, transparent),
    transparent
  );
}

/* ── form ─────────────────────────────────────────────── */
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.fg {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.fg.full {
  grid-column: 1 / -1;
}
.lab {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-2);
}
.lab i {
  width: 21px;
  height: 21px;
  flex-shrink: 0;
  border-radius: 7px;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-style: normal;
  background: color-mix(in srgb, var(--primary) 9%, var(--panel));
  border: 1px solid var(--hairline);
}
.fg input,
.fg textarea,
.doc-ta {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 11px;
  padding: 9px 12px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.65;
  color: var(--text);
  background: color-mix(in srgb, var(--bg-soft) 68%, transparent);
  outline: none;
  resize: vertical;
  box-shadow: inset 0 1px 1.5px rgba(20, 20, 25, 0.03);
  transition: border-color 0.16s, box-shadow 0.16s, background 0.16s;
}
.fg input::placeholder,
.doc-ta::placeholder {
  color: var(--dim);
}
.fg input:focus,
.fg textarea:focus,
.doc-ta:focus {
  border-color: var(--primary);
  background: var(--panel);
  box-shadow: 0 0 0 3px var(--primary-soft);
}
.fg input[type="number"]::-webkit-inner-spin-button,
.fg input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* ── actions ──────────────────────────────────────────── */
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}
.actions.end {
  justify-content: flex-end;
}
.actions .hint {
  font-size: 11.5px;
  color: var(--dim);
  margin-right: auto;
}
.ok-hint {
  font-size: 12px;
  font-weight: 600;
  color: var(--ok);
}
.cta {
  border: 0;
  border-radius: 11px;
  padding: 9px 20px;
  font-size: 13px;
  font-weight: 600;
  background: var(--btn-solid-bg);
  color: var(--btn-solid-text);
  box-shadow: 0 6px 16px rgba(20, 20, 25, 0.14);
  transition: transform 0.14s, box-shadow 0.14s;
}
.cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 22px rgba(20, 20, 25, 0.18);
}
.cta:active {
  transform: translateY(0);
}
.ghost {
  border: 1px solid var(--border);
  border-radius: 11px;
  padding: 8px 16px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-2);
  background: color-mix(in srgb, var(--panel) 70%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.ghost:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}
.ghost:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── 上传文档卡 ───────────────────────────────────────── */
.card-t {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 14px;
}
.card-t i {
  font-style: normal;
}
.upload {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  border: 1.5px dashed var(--border-strong);
  border-radius: 12px;
  padding: 13px 16px;
  font-size: 12.5px;
  color: var(--text-2);
  cursor: pointer;
  background: color-mix(in srgb, var(--bg-soft) 45%, transparent);
  transition: border-color 0.16s, background 0.16s, color 0.16s;
}
.upload:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-soft);
}
.up-ic {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 9px;
  display: grid;
  place-items: center;
  font-size: 15px;
  background: var(--panel);
  border: 1px solid var(--hairline);
  box-shadow: var(--shadow-sm);
}
.up-tx b {
  font-weight: 600;
  color: var(--text);
}
.doc-ta {
  margin: 12px 0 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 720px) {
  .grid2 {
    grid-template-columns: 1fr;
  }
  .glass {
    padding: 18px;
  }
}
</style>
