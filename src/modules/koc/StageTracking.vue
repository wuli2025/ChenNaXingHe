<script setup lang="ts">
import { computed } from "vue";
import { useKocStore } from "./useKocStore";
import type { Koc } from "./types";
import { tierLabel, exportTrackingCSV, fmtNum, shouldBoost, vmEngRate } from "./kocUtils";

const store = useKocStore();
const list = computed<Koc[]>(() => store.trackingList.value);
const threshold = computed(() => store.briefTemplate.value.boostThreshold || 20000);

function setField(id: string, field: keyof Koc, e: Event) {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  const val = el.type === "number" ? Number(el.value) : el.value;
  store.updateTrackingField(id, field, val);
}
function setVM(id: string, field: "postLink" | "views" | "likes" | "comments" | "shares", e: Event) {
  const el = e.target as HTMLInputElement;
  store.updateVM(id, field, el.type === "number" ? Number(el.value) : el.value);
}

/** 归一到 <input type="date"> 需要的 yyyy-mm-dd（兼容存量的 2026/06/14 斜杠格式），否则输入框渲染空白。 */
function toDateInput(v?: string): string {
  if (!v) return "";
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(String(v).trim());
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}
</script>

<template>
  <div class="stage">
    <div class="s-head">
      <h2>KOC Tracking</h2>
      <p>可编辑追踪表（自动持久化）。视频监测播放量达 {{ fmtNum(threshold) }} 自动建议投流。</p>
      <button class="btn" @click="exportTrackingCSV(list)">⬇️ 导出 CSV</button>
    </div>

    <div v-if="list.length === 0" class="empty">
      <div class="big">暂无追踪数据</div>
      <p>在「筛选结果」点 + Track 将通过的 KOC 加入</p>
    </div>

    <template v-else>
      <div class="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Category</th><th>KOC</th><th>Platform</th><th>Profile</th><th>Tier</th>
              <th>KSP</th><th>Script</th><th>Post Date</th><th>Post Link</th><th>Fee USD</th>
              <th>Act. Views</th><th>Act. Eng.</th><th>收货地址</th><th>品牌合作</th><th>IG</th><th>来源</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(k, i) in list" :key="k.id">
              <td class="idx">{{ i + 1 }}</td>
              <td><span class="cat">{{ k.category || "-" }}</span></td>
              <td><b>{{ k.name || k.username }}</b><div class="sub">@{{ k.username }}</div></td>
              <td>{{ k.platform === "tiktok" ? "TikTok" : k.platform }}</td>
              <td><a :href="/^https?:\/\//.test(k.url || '') ? k.url : `https://www.tiktok.com/@${k.username}`" target="_blank" rel="noopener" class="lnk">🔗</a></td>
              <td>{{ tierLabel(k) }}</td>
              <td><input class="ti" :value="k.ksp || ''" @change="setField(k.id, 'ksp', $event)" /></td>
              <td>
                <select class="ti" :value="k.script || ''" @change="setField(k.id, 'script', $event)">
                  <option value="">-</option><option value="Yes">Yes</option><option value="No">No</option>
                </select>
              </td>
              <td><input class="ti" type="date" :value="toDateInput(k.postDate)" @change="setField(k.id, 'postDate', $event)" /></td>
              <td><input class="ti" :value="k.postLink || ''" placeholder="https://" @change="setField(k.id, 'postLink', $event)" /></td>
              <td><input class="ti num" type="number" :value="k.collabFee || ''" @change="setField(k.id, 'collabFee', $event)" /></td>
              <td><input class="ti num" type="number" :value="k.actViews || ''" @change="setField(k.id, 'actViews', $event)" /></td>
              <td><input class="ti num" type="number" :value="k.actEngagement || ''" @change="setField(k.id, 'actEngagement', $event)" /></td>
              <td><input class="ti wide" :value="k.shippingAddress || ''" placeholder="Dorm / room…" @change="setField(k.id, 'shippingAddress', $event)" /></td>
              <td>
                <select class="ti" :value="k.brandCollaboration || ''" @change="setField(k.id, 'brandCollaboration', $event)">
                  <option value="">-</option><option value="Yes">Yes</option><option value="No">No</option>
                </select>
              </td>
              <td>
                <select class="ti" :value="k.hasInstagram || ''" @change="setField(k.id, 'hasInstagram', $event)">
                  <option value="">-</option><option value="Yes">Yes</option><option value="No">No</option>
                </select>
              </td>
              <td>
                <select class="ti" :value="k.recruitmentSource || ''" @change="setField(k.id, 'recruitmentSource', $event)">
                  <option value="">-</option><option value="Self Apply">Self Apply</option>
                  <option value="Outreach">Outreach</option><option value="Referral">Referral</option>
                  <option value="Agency">Agency</option>
                </select>
              </td>
              <td><button class="del" @click="store.removeFromTracking(k.id)">移除</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 视频监测 -->
      <div class="monitor">
        <div class="m-head">
          <h3>📹 合作视频监测</h3>
          <span class="sub">手动录入数据 · 播放量达 {{ fmtNum(threshold) }} 自动预警</span>
        </div>
        <div
          v-for="k in list"
          :key="'vm_' + k.id"
          class="vm-card"
          :class="{ boost: shouldBoost(store.videoMonitor.value[k.id], threshold) }"
        >
          <div class="vm-top">
            <div>
              <b>{{ k.name || k.username }}</b><span class="sub"> @{{ k.username }}</span>
              <span v-if="shouldBoost(store.videoMonitor.value[k.id], threshold)" class="boost-tag">🚀 建议开始投流</span>
            </div>
            <span class="sub">{{ store.videoMonitor.value[k.id]?.updatedAt ? "更新：" + store.videoMonitor.value[k.id]?.updatedAt : "未录入" }}</span>
          </div>
          <div class="vm-grid">
            <label><span>帖子链接</span><input :value="store.videoMonitor.value[k.id]?.postLink || k.postLink || ''" placeholder="https://" @change="setVM(k.id, 'postLink', $event)" /></label>
            <label><span>播放量</span><input type="number" :value="store.videoMonitor.value[k.id]?.views || ''" @change="setVM(k.id, 'views', $event)" /></label>
            <label><span>点赞</span><input type="number" :value="store.videoMonitor.value[k.id]?.likes || ''" @change="setVM(k.id, 'likes', $event)" /></label>
            <label><span>评论</span><input type="number" :value="store.videoMonitor.value[k.id]?.comments || ''" @change="setVM(k.id, 'comments', $event)" /></label>
            <label><span>分享</span><input type="number" :value="store.videoMonitor.value[k.id]?.shares || ''" @change="setVM(k.id, 'shares', $event)" /></label>
            <div class="vm-eng"><span>互动率</span><b>{{ vmEngRate(store.videoMonitor.value[k.id]) }}<template v-if="vmEngRate(store.videoMonitor.value[k.id]) !== '-'">%</template></b></div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stage { display: flex; flex-direction: column; gap: 14px; }
.s-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.s-head h2 { font-family: var(--serif); font-size: 17px; font-weight: 600; color: var(--ink); margin: 0; }
.s-head p { font-size: 12px; color: var(--muted); margin: 0; flex: 1; }
.btn { border: 1px solid var(--border); background: var(--panel); color: var(--text-2); font-size: 12px; padding: 6px 12px; border-radius: 9px; }
.btn:hover { border-color: var(--primary); color: var(--primary); }
.tbl-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); box-shadow: var(--shadow-sm); }
table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 1600px; }
th { background: var(--bg-soft); padding: 10px 12px; text-align: left; font-weight: 600; color: var(--text-2); white-space: nowrap; border-bottom: 1px solid var(--border-soft); }
td { padding: 8px 10px; border-bottom: 1px solid var(--border-soft); vertical-align: middle; white-space: nowrap; }
tr:last-child td { border-bottom: none; }
.idx { text-align: center; color: var(--muted); }
.cat { background: var(--primary-soft); color: var(--primary-deep); padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.sub { font-size: 10.5px; color: var(--muted); }
.lnk { color: var(--primary); }
.ti { border: 1px solid var(--border); border-radius: 7px; padding: 4px 8px; font-size: 12px; background: var(--bg-soft); color: var(--text); outline: none; width: 120px; }
.ti:focus { border-color: var(--primary); }
.ti.num { width: 80px; text-align: right; }
.ti.wide { width: 170px; }
.del { border: 1px solid var(--border); background: transparent; color: var(--vermilion); font-size: 11px; padding: 3px 9px; border-radius: 7px; }
.del:hover { border-color: var(--vermilion); }
.monitor { margin-top: 8px; }
.m-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
.m-head h3 { font-family: var(--serif); font-size: 14px; font-weight: 600; color: var(--ink); margin: 0; }
.vm-card { border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; background: var(--panel); box-shadow: var(--shadow-sm); }
.vm-card.boost { border-color: var(--gold); background: linear-gradient(165deg, var(--panel), var(--vermilion-soft)); }
.vm-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.boost-tag { margin-left: 8px; background: var(--gold); color: #fff; font-size: 11px; font-weight: 600; padding: 2px 10px; border-radius: 999px; }
.vm-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.vm-grid label { display: flex; flex-direction: column; gap: 3px; }
.vm-grid label span { font-size: 11px; color: var(--text-2); }
.vm-grid input { border: 1px solid var(--border); border-radius: 7px; padding: 5px 8px; font-size: 12px; background: var(--bg-soft); color: var(--text); outline: none; }
.vm-grid input:focus { border-color: var(--primary); }
.vm-eng { display: flex; flex-direction: column; justify-content: flex-end; gap: 3px; }
.vm-eng span { font-size: 11px; color: var(--text-2); }
.vm-eng b { font-size: 18px; font-weight: 700; color: var(--ok); }
.empty { text-align: center; padding: 48px; color: var(--dim); }
.empty .big { font-family: var(--serif); font-size: 15px; margin-bottom: 6px; }
.empty p { font-size: 12px; margin: 0; }
</style>
