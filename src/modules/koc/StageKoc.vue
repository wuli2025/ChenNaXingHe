<script setup lang="ts">
import { reactive, ref, computed } from "vue";
import { useKocStore } from "./useKocStore";
import type { Koc, CollectCriteria } from "./types";
import { TIER_FOLLOWERS } from "./types";
import { parseCSV, rowToKoc, uid, fmtNum } from "./kocUtils";

const store = useKocStore();
type Mode = "input" | "collect";
const mode = ref<Mode>("collect");

/* ── 手动录入 ── */
const showForm = ref(false);
const f = reactive({
  name: "",
  username: "",
  url: "",
  platform: "tiktok" as Koc["platform"],
  category: "",
  tier: "",
  city: "",
  ksp: "",
  whatsapp: "",
  collabFee: 0,
  risks: "",
});
function addManual() {
  if (!f.username.trim()) return alert("请填写账号名");
  if (!f.name.trim()) return alert("请填写 KOC 姓名");
  const koc: Koc = {
    id: uid("man"),
    platform: f.platform,
    name: f.name.trim(),
    username: f.username.trim().replace(/^@/, ""),
    url: f.url.trim() || `https://www.tiktok.com/@${f.username.trim().replace(/^@/, "")}`,
    city: f.city,
    tier: f.tier,
    category: f.category,
    ksp: f.ksp,
    whatsapp: f.whatsapp.trim(),
    collabFee: Number(f.collabFee) || 0,
    followers: TIER_FOLLOWERS[f.tier] || 0,
    avgViews: 0,
    engagementRate: 0,
    manualRisks: f.risks.split(",").map((s) => s.trim()).filter(Boolean),
    tags: [],
    source_type: "manual",
    addedAt: new Date().toISOString(),
    events: [{ id: uid("ev"), kind: "created", title: "手动录入", at: Date.now() }],
  };
  store.addKoc(koc);
  showForm.value = false;
  Object.assign(f, { name: "", username: "", url: "", category: "", tier: "", city: "", ksp: "", whatsapp: "", collabFee: 0, risks: "" });
}

/* ── CSV 导入（表头别名映射） ── */
const csvPreview = ref<ReturnType<typeof parseCSV> | null>(null);
function onCsv(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    csvPreview.value = parseCSV(String(ev.target?.result || ""));
  };
  reader.readAsText(file, "utf-8");
  // 重置输入值：否则取消后再次选同一文件不触发 change。
  input.value = "";
}
function importCsv() {
  if (!csvPreview.value) return;
  const kocs = csvPreview.value.rows.map(rowToKoc).filter((k): k is Koc => !!k);
  store.addManyKoc(kocs);
  store.log("ok", `📋 CSV 导入 ${kocs.length} 条 KOC`);
  csvPreview.value = null;
}

/* ── Claude 采集 ── */
const cr = reactive<CollectCriteria>({
  keywords: [],
  minFollowers: 5000,
  minViews: 1000,
  minEng: 3,
  category: "",
  lang: "",
  geo: "",
  geoRate: "50",
  limit: 20,
});
const kwInput = ref("campus life, student tech review");
function syncKw() {
  cr.keywords = kwInput.value.split(/[,，\n]+/).map((s) => s.trim()).filter(Boolean);
}
const SUGGEST = ["campus life", "student tech review", "smartphone unboxing", "university vlog", "tech lifestyle"];
function addKw(s: string) {
  syncKw();
  if (!cr.keywords.some((k) => k.toLowerCase() === s.toLowerCase())) cr.keywords.push(s);
  kwInput.value = cr.keywords.join(", ");
}
async function collect() {
  syncKw();
  await store.runCollect(cr);
}

const total = computed(() => store.kocData.value.length);
</script>

<template>
  <div class="stage">
    <div class="s-head">
      <h2>筛选 KOC</h2>
      <p>手动录入 / CSV 导入，或让 Claude 真实采集候选账号（左侧控制台实时显示 AI 在跑什么）。</p>
    </div>

    <div class="seg">
      <button :class="{ on: mode === 'collect' }" @click="mode = 'collect'">🤖 Claude 采集</button>
      <button :class="{ on: mode === 'input' }" @click="mode = 'input'">✏️ 手动 / CSV</button>
      <span class="count">已录入 {{ total }} 条</span>
    </div>

    <!-- Claude 采集 -->
    <div v-if="mode === 'collect'" class="card">
      <div class="card-t">设置采集条件</div>
      <label class="fg full">
        <span>搜索关键词（逗号分隔）</span>
        <input v-model="kwInput" @blur="syncKw" placeholder="campus life, vlog, student tech review" />
      </label>
      <div class="suggest">
        <span class="lab">快速添加：</span>
        <span v-for="s in SUGGEST" :key="s" class="chip" @click="addKw(s)">{{ s }}</span>
      </div>
      <div class="grid3">
        <label class="fg"><span>最低粉丝量</span><input v-model.number="cr.minFollowers" type="number" /></label>
        <label class="fg"><span>最低均播放量</span><input v-model.number="cr.minViews" type="number" /></label>
        <label class="fg"><span>最低互动率 %</span><input v-model.number="cr.minEng" type="number" step="0.5" /></label>
        <label class="fg"><span>内容垂类</span>
          <select v-model="cr.category">
            <option value="">不限</option>
            <option value="tech">科技 / 数码</option>
            <option value="campus">校园 / 学生</option>
            <option value="lifestyle">生活方式</option>
            <option value="mixed">混合</option>
          </select>
        </label>
        <label class="fg"><span>内容语言</span>
          <select v-model="cr.lang">
            <option value="">不限</option>
            <option value="English">英语</option>
            <option value="Yoruba">约鲁巴语</option>
            <option value="mixed">混合</option>
          </select>
        </label>
        <label class="fg"><span>受众城市</span>
          <select v-model="cr.geo">
            <option value="">不限</option>
            <option value="Lagos">Lagos</option>
            <option value="Ibadan">Ibadan</option>
            <option value="Abuja">Abuja</option>
            <option value="Nairobi">Nairobi</option>
            <option value="Accra">Accra</option>
          </select>
        </label>
        <label class="fg"><span>目标采集数量</span>
          <select v-model.number="cr.limit">
            <option :value="10">10 个</option>
            <option :value="20">20 个</option>
            <option :value="50">50 个</option>
          </select>
        </label>
      </div>
      <div class="actions">
        <button class="btn primary" :disabled="store.busy.value" @click="collect">
          {{ store.busy.value ? "采集中…" : "🚀 开始 Claude 采集" }}
        </button>
        <span v-if="store.runStatus.value" class="status">{{ store.runStatus.value }}</span>
      </div>
    </div>

    <!-- 手动 / CSV -->
    <div v-else class="card">
      <div class="card-t">数据输入</div>
      <div class="actions">
        <button class="btn" @click="showForm = !showForm">✏️ {{ showForm ? "收起" : "手动录入" }}</button>
        <label class="btn file">📋 导入 CSV<input type="file" accept=".csv" hidden @change="onCsv" /></label>
      </div>

      <div v-if="showForm" class="form">
        <div class="grid3">
          <label class="fg"><span>KOC 姓名 *</span><input v-model="f.name" /></label>
          <label class="fg"><span>账号 handle *</span><input v-model="f.username" placeholder="@handle" /></label>
          <label class="fg"><span>主页链接</span><input v-model="f.url" /></label>
          <label class="fg"><span>平台</span>
            <select v-model="f.platform">
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
              <option value="youtube">YouTube</option>
            </select>
          </label>
          <label class="fg"><span>垂类</span>
            <select v-model="f.category">
              <option value="">请选择</option>
              <option value="campus">校园</option>
              <option value="tech">科技</option>
              <option value="lifestyle">生活方式</option>
              <option value="fashion">时尚</option>
              <option value="food">美食</option>
            </select>
          </label>
          <label class="fg"><span>粉丝量级</span>
            <select v-model="f.tier">
              <option value="">请选择</option>
              <option value="1k-5k">1K–5K</option>
              <option value="5k-10k">5K–10K</option>
              <option value="10k-30k">10K–30K</option>
              <option value="30k-100k">30K–100K</option>
              <option value="100k-300k">100K–300K</option>
              <option value="300k+">300K+</option>
            </select>
          </label>
          <label class="fg"><span>城市</span><input v-model="f.city" /></label>
          <label class="fg"><span>KSP</span><input v-model="f.ksp" /></label>
          <label class="fg"><span>WhatsApp</span><input v-model="f.whatsapp" /></label>
          <label class="fg"><span>合作费 USD</span><input v-model.number="f.collabFee" type="number" /></label>
          <label class="fg full"><span>备注 / 风险（逗号分隔）</span><input v-model="f.risks" /></label>
        </div>
        <div class="actions">
          <button class="btn primary" @click="addManual">✅ 添加并评分</button>
        </div>
      </div>

      <div v-if="csvPreview" class="preview">
        <div class="card-t">CSV 预览（前 5 行）</div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th v-for="h in csvPreview.headers" :key="h">{{ h }}</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in csvPreview.rows.slice(0, 5)" :key="i">
                <td v-for="h in csvPreview.headers" :key="h">{{ r[h] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="actions">
          <button class="btn primary" @click="importCsv">导入 {{ csvPreview.rows.length }} 条</button>
          <button class="btn" @click="csvPreview = null">取消</button>
        </div>
      </div>
    </div>

    <!-- 已录入预览 -->
    <div class="card">
      <div class="card-t">已录入 KOC（{{ total }}）</div>
      <div v-if="total === 0" class="empty">暂无数据 · 采集或录入后显示在「筛选结果」</div>
      <div v-else class="tbl-wrap">
        <table>
          <thead><tr><th>账号</th><th>平台</th><th>粉丝</th><th>均播放</th><th>互动率</th><th>结论</th><th></th></tr></thead>
          <tbody>
            <tr v-for="k in store.kocData.value" :key="k.id">
              <td><b>{{ k.name || k.username }}</b><div class="sub">@{{ k.username }}</div></td>
              <td>{{ k.platform }}</td>
              <td>{{ fmtNum(k.followers) }}</td>
              <td>{{ fmtNum(k.avgViews) }}</td>
              <td>{{ k.engagementRate != null ? k.engagementRate.toFixed(1) + "%" : "-" }}</td>
              <td><span class="badge" :class="'st-' + (k.status || 'risk')">{{ k.entryGrade || k.verdict }}</span></td>
              <td><button class="del" @click="store.removeKoc(k.id)">删除</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stage { display: flex; flex-direction: column; gap: 16px; }
.s-head h2 { font-family: var(--serif); font-size: 17px; font-weight: 600; color: var(--ink); margin: 0 0 4px; }
.s-head p { font-size: 12px; color: var(--muted); margin: 0; }
.seg { display: flex; align-items: center; gap: 4px; background: var(--bg-soft); border: 1px solid var(--border-soft); border-radius: 10px; padding: 3px; width: fit-content; }
.seg button { border: none; background: transparent; color: var(--text-2); font-size: 12.5px; padding: 6px 14px; border-radius: 7px; }
.seg button.on { background: var(--primary); color: #fff; font-weight: 500; }
.seg .count { font-size: 11px; color: var(--muted); padding: 0 10px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 18px; box-shadow: var(--shadow-sm); }
.card-t { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 12px; }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.fg { display: flex; flex-direction: column; gap: 4px; }
.fg.full { grid-column: 1 / -1; }
.fg > span { font-size: 11.5px; color: var(--text-2); font-weight: 500; }
.fg input, .fg select { border: 1px solid var(--border); border-radius: 9px; padding: 7px 10px; font-size: 13px; background: var(--bg-soft); color: var(--text); outline: none; }
.fg input:focus, .fg select:focus { border-color: var(--primary); }
.suggest { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 8px 0 12px; }
.suggest .lab { font-size: 11px; color: var(--muted); }
.chip { cursor: pointer; font-size: 11px; background: var(--primary-soft); color: var(--primary-deep); border-radius: 999px; padding: 3px 10px; }
.chip:hover { background: var(--primary); color: #fff; }
.actions { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.btn { border: 1px solid var(--border); background: var(--panel); color: var(--text-2); font-size: 12.5px; padding: 7px 14px; border-radius: 9px; }
.btn:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.primary { background: var(--btn-solid-bg); color: var(--btn-solid-text); border-color: transparent; }
.btn.file { cursor: pointer; }
.status { font-size: 12px; color: var(--text-2); }
.form { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border-soft); }
.preview { margin-top: 14px; }
.tbl-wrap { overflow-x: auto; border: 1px solid var(--border-soft); border-radius: 10px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { background: var(--bg-soft); padding: 8px 10px; text-align: left; font-weight: 600; color: var(--text-2); white-space: nowrap; border-bottom: 1px solid var(--border-soft); }
td { padding: 8px 10px; border-bottom: 1px solid var(--border-soft); }
tr:last-child td { border-bottom: none; }
.sub { font-size: 10.5px; color: var(--muted); }
.badge { font-size: 10.5px; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
.st-pass { background: var(--ok-soft); color: var(--ok); }
.st-risk { background: var(--vermilion-soft); color: var(--gold); }
.st-fail { background: var(--vermilion-soft); color: var(--vermilion); }
.del { border: 1px solid var(--border); background: transparent; color: var(--vermilion); font-size: 11px; padding: 3px 9px; border-radius: 7px; }
.del:hover { border-color: var(--vermilion); }
.empty { text-align: center; padding: 28px; color: var(--dim); font-size: 12.5px; }
</style>
