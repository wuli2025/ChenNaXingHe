<script setup lang="ts">
import { ref, computed } from "vue";
import { useKocStore } from "./useKocStore";
import type { Koc } from "./types";
import { PRESET_TAGS } from "./types";
import { fmtNum, catLabel, localPct, exportScreeningCSV } from "./kocUtils";

const emit = defineEmits<{ detail: [id: string]; brief: [id: string] }>();
const store = useKocStore();

const fStatus = ref("");
const fPlatform = ref("");
const fSearch = ref("");

const filtered = computed<Koc[]>(() =>
  store.kocData.value.filter((k) => {
    if (fStatus.value && k.status !== fStatus.value) return false;
    if (fPlatform.value && k.platform !== fPlatform.value) return false;
    if (fSearch.value && !(k.username + (k.name || "")).toLowerCase().includes(fSearch.value.toLowerCase()))
      return false;
    return true;
  })
);

const stats = computed(() => {
  const d = store.kocData.value;
  const scores = d.map((k) => k.score).filter((s): s is number => s != null);
  return {
    total: d.length,
    pass: d.filter((k) => k.status === "pass").length,
    risk: d.filter((k) => k.status === "risk").length,
    fail: d.filter((k) => k.status === "fail").length,
    avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : "-",
  };
});

function scoreColor(s?: number): string {
  if (s == null) return "var(--muted)";
  return s >= 70 ? "var(--ok)" : s >= 50 ? "var(--gold)" : "var(--vermilion)";
}
function geoLabel(k: Koc): string {
  const p = localPct(k);
  return p ? `${p}%` : k.geoLabel || "未知";
}

/* 标签编辑 */
const tagOpenId = ref<string | null>(null);
const customTag = ref("");
function addCustom(id: string) {
  store.addTag(id, customTag.value);
  customTag.value = "";
}

async function judgeAll() {
  for (const k of filtered.value) {
    if (!k.aiJudgment) await store.runAiJudge(k.id);
  }
}
function reset() {
  if (confirm("重置将重新加载种子数据，确认？")) store.resetSeed();
}
</script>

<template>
  <div class="stage">
    <div class="s-head">
      <h2>筛选结果</h2>
      <p>8 维加权评分 + AI 定性评判并列。每个指标标注来源（用户填 / 启发式 / AI）。</p>
    </div>

    <!-- 统计行 -->
    <div class="stats">
      <div class="stat"><div class="lab">总计</div><div class="val">{{ stats.total }}</div></div>
      <div class="stat"><div class="lab">通过初筛</div><div class="val ok">{{ stats.pass }}</div></div>
      <div class="stat"><div class="lab">风险标记</div><div class="val warn">{{ stats.risk }}</div></div>
      <div class="stat"><div class="lab">不通过</div><div class="val bad">{{ stats.fail }}</div></div>
      <div class="stat"><div class="lab">平均评分</div><div class="val">{{ stats.avg }}</div></div>
    </div>

    <!-- 过滤栏 -->
    <div class="filters">
      <select v-model="fStatus">
        <option value="">全部状态</option>
        <option value="pass">通过</option>
        <option value="risk">风险</option>
        <option value="fail">不通过</option>
      </select>
      <select v-model="fPlatform">
        <option value="">全部平台</option>
        <option value="tiktok">TikTok</option>
        <option value="instagram">Instagram</option>
      </select>
      <input v-model="fSearch" placeholder="搜索账号…" />
      <button class="btn" @click="exportScreeningCSV(store.kocData.value)">⬇️ 导出 CSV</button>
      <button class="btn" :disabled="store.busy.value" @click="judgeAll">🤖 批量 AI 评判</button>
      <button class="btn danger" @click="reset">🔄 重置数据</button>
    </div>

    <!-- 15 列筛选表 -->
    <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>姓名 / 账号</th>
            <th>联系</th>
            <th>标签</th>
            <th>城市 / 学校</th>
            <th>粉丝量</th>
            <th>均播放</th>
            <th>互动率</th>
            <th>本地受众</th>
            <th>垂类</th>
            <th>品牌契合</th>
            <th>真实性</th>
            <th>综合评分</th>
            <th>入库等级</th>
            <th>AI 评判</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="k in filtered" :key="k.id">
            <td>
              <b>{{ k.name || k.username }}</b>
              <div class="sub">@{{ k.username }}</div>
              <a v-if="k.url && /^https?:\/\//.test(k.url)" :href="k.url" target="_blank" rel="noopener" class="lnk">主页 ↗</a>
            </td>
            <td class="contact">
              <a v-if="k.whatsapp" :href="`https://wa.me/${k.whatsapp.replace(/\D/g, '')}`" target="_blank">📱 {{ k.whatsapp }}</a>
              <span v-else class="dim">-</span>
            </td>
            <td class="tags-cell">
              <span v-for="t in k.tags || []" :key="t" class="tag">
                {{ t }}<span class="rm" @click="store.removeTag(k.id, t)">×</span>
              </span>
              <span class="tag add" @click="tagOpenId = tagOpenId === k.id ? null : k.id">+ 标签</span>
              <div v-if="tagOpenId === k.id" class="tag-pop" @click.stop>
                <div class="preset">
                  <span
                    v-for="t in PRESET_TAGS"
                    :key="t"
                    class="p-tag"
                    :class="{ on: (k.tags || []).includes(t) }"
                    @click="store.toggleTag(k.id, t)"
                  >{{ t }}</span>
                </div>
                <div class="custom">
                  <input v-model="customTag" placeholder="自定义…" @keydown.enter="addCustom(k.id)" />
                  <button @click="addCustom(k.id)">加</button>
                </div>
              </div>
            </td>
            <td>
              <div>{{ k.city || "-" }}</div>
              <div class="sub">{{ k.school || "" }}</div>
            </td>
            <td>{{ fmtNum(k.followers) }}</td>
            <td>{{ fmtNum(k.avgViews) }}</td>
            <td>{{ k.engagementRate != null ? k.engagementRate.toFixed(1) + "%" : "-" }}</td>
            <td>{{ geoLabel(k) }}</td>
            <td class="ell">{{ catLabel(k.category || k.styleTag) }}</td>
            <td>{{ k.scoring?.contentBrandFit?.value.toFixed(1) ?? "-" }}</td>
            <td>{{ k.scoring?.accountAuthenticity?.value.toFixed(1) ?? "-" }}</td>
            <td>
              <div class="score-bar">
                <div class="track"><div class="fill" :style="{ width: (k.score || 0) + '%', background: scoreColor(k.score) }" /></div>
                <span class="num" :style="{ color: scoreColor(k.score) }">{{ k.score }}</span>
              </div>
            </td>
            <td><span class="badge" :class="'st-' + (k.status || 'risk')">{{ k.entryGrade || k.verdict }}</span></td>
            <td>
              <span v-if="k.aiJudgment" class="ai-badge" :title="k.aiJudgment.reasoning">{{ k.aiJudgment.verdict }}</span>
              <button v-else class="ai-run" :disabled="store.busy.value" @click="store.runAiJudge(k.id)">跑 AI</button>
            </td>
            <td>
              <div class="ops">
                <button class="op" @click="emit('detail', k.id)">{{ k.videoScript ? "📝 详情" : "详情" }}</button>
                <button v-if="k.status !== 'fail'" class="op" @click="emit('brief', k.id)">Brief</button>
                <button v-if="k.status !== 'fail'" class="op go" @click="store.addToTracking(k.id)">+ Track</button>
                <button class="op" :disabled="store.busy.value" @click="store.runScript(k.id)">🤖 脚本</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="filtered.length === 0" class="empty">
      <div class="big">暂无筛选数据</div>
      <button class="btn primary" @click="store.resetSeed()">🔄 加载种子数据</button>
    </div>
  </div>
</template>

<style scoped>
.stage { display: flex; flex-direction: column; gap: 14px; }
.s-head h2 { font-family: var(--serif); font-size: 17px; font-weight: 600; color: var(--ink); margin: 0 0 4px; }
.s-head p { font-size: 12px; color: var(--muted); margin: 0; }
.stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
.stat { background: var(--panel); border: 1px solid var(--border-soft); border-radius: 12px; padding: 12px 14px; box-shadow: var(--shadow-sm); }
.stat .lab { font-size: 11px; color: var(--muted); }
.stat .val { font-family: var(--mono); font-size: 24px; font-weight: 700; color: var(--ink); margin-top: 2px; }
.val.ok { color: var(--ok); }
.val.warn { color: var(--gold); }
.val.bad { color: var(--vermilion); }
.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.filters select, .filters input { border: 1px solid var(--border); border-radius: 9px; padding: 6px 10px; font-size: 12px; background: var(--bg-soft); color: var(--text); outline: none; }
.filters input { min-width: 150px; }
.btn { border: 1px solid var(--border); background: var(--panel); color: var(--text-2); font-size: 12px; padding: 6px 12px; border-radius: 9px; }
.btn:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.primary { background: var(--btn-solid-bg); color: var(--btn-solid-text); border-color: transparent; }
.btn.danger { color: var(--vermilion); }
.btn.danger:hover { border-color: var(--vermilion); color: var(--vermilion); }
.tbl-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); box-shadow: var(--shadow-sm); }
table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 1280px; }
th { background: var(--bg-soft); padding: 10px 12px; text-align: left; font-weight: 600; color: var(--text-2); white-space: nowrap; border-bottom: 1px solid var(--border-soft); position: sticky; top: 0; }
td { padding: 10px 12px; border-bottom: 1px solid var(--border-soft); vertical-align: middle; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: var(--panel-hover); }
.sub { font-size: 10.5px; color: var(--muted); }
.lnk { font-size: 10.5px; color: var(--primary); }
.contact a { font-size: 11px; color: var(--ok); }
.dim { color: var(--dim); }
.ell { max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tags-cell { min-width: 150px; position: relative; }
.tag { display: inline-flex; align-items: center; gap: 2px; background: var(--bg-soft); border: 1px solid var(--border-soft); border-radius: 999px; padding: 2px 8px; font-size: 11px; margin: 1px; }
.tag .rm { cursor: pointer; color: var(--muted); }
.tag.add { cursor: pointer; background: var(--primary-soft); color: var(--primary-deep); font-weight: 600; }
.tag-pop { position: absolute; z-index: 30; top: 100%; left: 0; margin-top: 4px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 10px; box-shadow: var(--shadow-lg); min-width: 230px; }
.preset { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.p-tag { cursor: pointer; padding: 3px 10px; border-radius: 999px; font-size: 11px; border: 1px solid var(--border); color: var(--text-2); }
.p-tag.on { background: var(--primary-soft); color: var(--primary-deep); border-color: var(--primary); }
.custom { display: flex; gap: 6px; }
.custom input { flex: 1; border: 1px solid var(--border); border-radius: 7px; padding: 5px 8px; font-size: 12px; background: var(--bg-soft); color: var(--text); }
.custom button { border: 1px solid var(--border); background: var(--panel); border-radius: 7px; padding: 0 12px; font-size: 12px; color: var(--text-2); }
.score-bar { display: flex; align-items: center; gap: 6px; }
.track { width: 56px; height: 5px; background: var(--border); border-radius: 3px; overflow: hidden; }
.fill { height: 100%; border-radius: 3px; }
.num { font-family: var(--mono); font-size: 11px; font-weight: 700; min-width: 24px; }
.badge { font-size: 10.5px; padding: 2px 8px; border-radius: 999px; font-weight: 600; white-space: nowrap; }
.st-pass { background: var(--ok-soft); color: var(--ok); }
.st-risk { background: var(--vermilion-soft); color: var(--gold); }
.st-fail { background: var(--vermilion-soft); color: var(--vermilion); }
.ai-badge { display: inline-block; font-size: 11px; font-weight: 700; color: var(--primary-deep); background: var(--primary-soft); padding: 2px 9px; border-radius: 999px; cursor: help; }
.ai-run { border: 1px solid var(--border); background: transparent; color: var(--primary); font-size: 11px; padding: 3px 9px; border-radius: 7px; }
.ai-run:disabled { opacity: 0.5; }
.ops { display: flex; gap: 4px; flex-wrap: wrap; }
.op { border: 1px solid var(--border); background: var(--panel); color: var(--text-2); font-size: 11px; padding: 3px 9px; border-radius: 7px; white-space: nowrap; }
.op:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.op:disabled { opacity: 0.5; cursor: not-allowed; }
.op.go { color: var(--ok); border-color: var(--ok-soft); }
.empty { text-align: center; padding: 40px; color: var(--dim); }
.empty .big { font-family: var(--serif); font-size: 15px; margin-bottom: 12px; }
</style>
