<script setup lang="ts">
/**
 * E7 · 财务中枢 —— 本系统最重的模块：票据 OCR 统一入口 → 策略分流入账 → 业务包证据链
 * → 会计凭证 → 三方对账 → 月度报表。
 *
 * 零 props。数据/动作全部来自 useErpStore（单例，状态皆为 ref，须 .value）。
 *  - 票据统一入口：粘贴任何票面文字 → store.runOcr()，识别后自动走策略分流：
 *    置信度 ≥ ocrAutoBookConf% 且票面 ≤ ocrAutoBookCapCny 元 → 自动入账（.e-auto）；
 *    低置信 / 大额 / 疑似重复票 → ocr-book 审批闸（.e-human.soft）。
 *  - 对账「AI 找匹配」→ store.runRecon()：候选生成后进 recon-open 人工闸。
 *  - 月结确认走 month-close 闸（审批中心），此处只读展示锁账状态。
 */
import { ref, computed } from "vue";
import { useErpStore } from "../useErpStore";
import { DOC_TYPE_LABEL, EICONS } from "../types";
import type { EvidenceDoc, EvidenceBundle, ReconRow } from "../types";
import TSection from "../../trade/components/TSection.vue";
import TPanel from "../../trade/components/TPanel.vue";
import TBadge from "../../trade/components/TBadge.vue";
import TConf from "../../trade/components/TConf.vue";
import TKpi from "../../trade/components/TKpi.vue";

const store = useErpStore();

/* ── KPI 派生 ── */
const lastReport = computed(() => store.reports.value[store.reports.value.length - 1]);
const bookedCount = computed(() => store.docs.value.filter((d) => d.booked).length);

/* ── 票据统一入口：粘贴 → OCR → 策略分流 ── */
const ocrText = ref("");
async function doOcr() {
  const raw = ocrText.value.trim();
  if (!raw || store.busy.value) return;
  const doc = await store.runOcr(raw);
  if (doc) ocrText.value = "";
}

/* ── 徽标映射：查重 / 业务包 / 对账状态 ── */
function dupTone(d: EvidenceDoc): "green" | "red" | "amber" {
  return d.dupCheck === "ok" ? "green" : d.dupCheck === "dup" ? "red" : "amber";
}
function dupLabel(d: EvidenceDoc): string {
  return d.dupCheck === "ok" ? "通过" : d.dupCheck === "dup" ? "重复" : "存疑";
}
function bundleTone(b: EvidenceBundle): "green" | "amber" | "red" {
  return b.status === "complete" ? "green" : b.status === "partial" ? "amber" : "red";
}
function bundleLabel(b: EvidenceBundle): string {
  return b.status === "complete" ? "证据链齐" : b.status === "partial" ? "缺件" : "冲突";
}
function reconTone(r: ReconRow): "green" | "blue" | "red" | "amber" {
  return r.status === "已匹配" ? "green" : r.status === "待确认" ? "blue" : r.status === "未达" ? "red" : "amber";
}

/* ── 金额格式：币种符号 + 千分位，带小数时固定两位（默认 toLocaleString 会把 .5 显示成一位） ── */
function money(currency: EvidenceDoc["currency"], amount: number): string {
  const sym = currency === "CNY" ? "¥" : currency === "USD" ? "$" : "€";
  return sym + amount.toLocaleString(undefined, { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

/* ── 对账：非「已匹配」行让 AI 找匹配候选（候选生成后进 recon-open 闸） ── */
async function aiMatch(r: ReconRow) {
  if (store.busy.value) return;
  await store.runRecon(r.id);
}
</script>

<template>
  <div class="e7-finance t-view-anim">
    <!-- 分流说明：这一模块哪些自动、哪些进闸 -->
    <div class="e-gates">
      <span class="e-auto">自动</span>
      <span>OCR 识别 · 置信度 ≥ <b>{{ store.params.value.ocrAutoBookConf }}%</b> 且票面 ≤
        <b>¥{{ store.params.value.ocrAutoBookCapCny.toLocaleString() }}</b> 自动入账并生成凭证</span>
      <span class="e-human soft">需审批</span>
      <span>低置信 / 大额 / 疑似重复票进入账确认闸</span>
      <span class="e-human soft">需审批</span>
      <span>月结锁账须老板在审批中心确认</span>
    </div>

    <!-- 财务 KPI -->
    <div class="t-grid t-g4">
      <TKpi
        :value="String(store.unbookedDocs.value.length)"
        label="未入账票据"
        :delta="`已入账 ${bookedCount} 张`"
        :up="store.unbookedDocs.value.length === 0"
        acc="amber"
        :icon="EICONS.finance"
      />
      <TKpi
        :value="String(store.journal.value.length)"
        label="会计凭证"
        delta="复式分录 · 自动/人工留痕"
        acc="blue"
        :icon="EICONS.listing"
      />
      <TKpi
        :value="String(store.openRecon.value.length)"
        label="未达 + 待确认账项"
        :delta="store.openRecon.value.length ? '阻塞月结闭环' : '对账已闭合'"
        :up="store.openRecon.value.length === 0"
        acc="red"
        :icon="EICONS.review"
      />
      <TKpi
        :value="lastReport ? '¥' + (lastReport.netProfitCny / 1000).toFixed(1) + 'k' : '—'"
        label="本月净利"
        :delta="lastReport ? `${lastReport.month} · 净利率 ${lastReport.marginPct}%` : '暂无报表'"
        :up="true"
        acc="gold"
        :icon="EICONS.pricing"
      />
    </div>

    <!-- ① 票据统一入口 -->
    <TSection
      title="票据统一入口"
      sub="发票 / 结算邮件 / 银行回单 · 粘贴即识别 · 策略分流入账"
    />
    <TPanel pad>
      <textarea
        v-model="ocrText"
        class="ocr-input"
        rows="4"
        placeholder="粘贴任何票面文字：增值税发票、平台结算邮件、银行回单、物流账单、报关单内容……AI 财务官会识别票种、抽取字段并给出置信度。"
      />
      <div class="t-row ocr-actions">
        <span class="t-muted ocr-hint">
          识别后自动走策略分流：高置信小额<b>自动入账</b>生成凭证；低置信 / 大额 / 疑似重复进<b>入账确认闸</b>，人工核准后才落账。
        </span>
        <button
          class="t-btn primary"
          :disabled="store.busy.value || !ocrText.trim()"
          @click="doOcr"
        >
          识别并入账
        </button>
      </div>
    </TPanel>

    <!-- ② 票据台账 -->
    <TSection
      title="票据台账"
      sub="OCR 结构化 · 查重验真 · 入账状态 · 业务包归属"
    >
      <template #actions>
        <span class="t-pill">共 {{ store.docs.value.length }} 张</span>
        <span class="t-pill">未入账 {{ store.unbookedDocs.value.length }}</span>
      </template>
    </TSection>
    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>类型</th><th>对手方</th><th>票号</th><th>日期</th>
            <th class="num">
              金额
            </th><th class="num">
              税额
            </th>
            <th style="width: 130px">
              置信度
            </th><th>查重</th><th>入账</th><th>业务包</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="d in store.docs.value"
            :key="d.id"
          >
            <td><b>{{ DOC_TYPE_LABEL[d.type] }}</b></td>
            <td>{{ d.party }}</td>
            <td class="t-mono">
              {{ d.no }}
            </td>
            <td class="t-mono">
              {{ d.date }}
            </td>
            <td class="num t-mono">
              {{ money(d.currency, d.amount) }}
            </td>
            <td class="num t-mono">
              {{ d.taxAmount !== undefined ? "¥" + d.taxAmount.toLocaleString() : "—" }}
            </td>
            <td><TConf :value="d.conf" /></td>
            <td>
              <TBadge :tone="dupTone(d)">
                {{ dupLabel(d) }}
              </TBadge>
            </td>
            <td>
              <TBadge
                v-if="d.booked"
                tone="green"
              >
                ✓ 已入账
              </TBadge>
              <TBadge
                v-else
                tone="amber"
              >
                未入账
              </TBadge>
            </td>
            <td class="t-mono t-muted">
              {{ d.bundleId || "—" }}
            </td>
          </tr>
          <tr v-if="!store.docs.value.length">
            <td
              colspan="10"
              class="t-muted empty-cell"
            >
              暂无票据 —— 在上方统一入口粘贴票面文字即可开始。
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>

    <!-- ③ 业务包：多票聚成一笔业务的完整证据链 -->
    <TSection
      title="业务包 · 证据链勾稽"
      sub="同一笔业务的发票 / 回单 / 报关单聚合，支撑对账与出口退税"
    />
    <div class="t-grid t-g2">
      <TPanel
        v-for="b in store.bundles.value"
        :key="b.id"
        pad
      >
        <div class="t-row bundle-head">
          <b class="bundle-title">{{ b.title }}</b>
          <TBadge :tone="bundleTone(b)">
            {{ bundleLabel(b) }}
          </TBadge>
        </div>
        <div class="t-muted bundle-meta">
          包含票据 {{ b.docIds.length }} 张 · <span class="t-mono">{{ b.id }}</span>
        </div>
        <p
          v-if="b.note"
          class="bundle-note"
        >
          {{ b.note }}
        </p>
      </TPanel>
    </div>
    <div class="t-note info">
      <b>业务包是什么：</b>一笔业务往往对应多张票据（发票 + 付款回单 + 报关单…），聚成业务包后 AI 逐张勾稽金额与对手方，
      <b>证据链齐</b>的包可直接支撑三方对账与出口退税资料包（E8）。
    </div>

    <!-- ④ 会计凭证 -->
    <TSection
      title="会计凭证"
      sub="票据入账自动生成复式分录 · auto/human 留痕"
    />
    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>日期</th><th>摘要</th><th>借方</th><th>贷方</th><th class="num">
              金额 ¥
            </th><th>来源</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="j in store.journal.value"
            :key="j.id"
          >
            <td class="t-mono">
              {{ j.date }}
            </td>
            <td>{{ j.summary }}</td>
            <td>{{ j.debit }}</td>
            <td>{{ j.credit }}</td>
            <td class="num t-mono">
              {{ j.amountCny.toLocaleString() }}
            </td>
            <td>
              <span
                v-if="j.by === 'auto'"
                class="e-auto"
              >自动</span>
              <span
                v-else
                class="e-human soft"
              >人工</span>
            </td>
          </tr>
          <tr v-if="!store.journal.value.length">
            <td
              colspan="6"
              class="t-muted empty-cell"
            >
              暂无凭证 —— 票据入账后自动生成。
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>

    <!-- ⑤ 三方对账：平台结算 ↔ 回款服务商 ↔ 银行流水 -->
    <TSection
      title="三方对账"
      sub="平台结算 ↔ 回款商 ↔ 银行流水 · AI 找候选，人工确认回写"
    >
      <template #actions>
        <span class="t-pill">未闭合 {{ store.openRecon.value.length }}</span>
      </template>
    </TSection>
    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>账项</th><th class="num">
              金额
            </th><th>环节</th><th>候选匹配</th>
            <th style="width: 130px">
              置信度
            </th><th>状态</th><th style="text-align: right">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in store.recon.value"
            :key="r.id"
          >
            <td><b>{{ r.item }}</b></td>
            <td class="num t-mono">
              {{ r.amount }}
            </td>
            <td class="t-muted">
              {{ r.side }}
            </td>
            <td :class="{ 't-muted': r.conf === 0 }">
              {{ r.match }}
            </td>
            <td>
              <TConf
                v-if="r.conf > 0"
                :value="r.conf"
              />
              <TBadge
                v-else
                tone="red"
              >
                无候选
              </TBadge>
            </td>
            <td>
              <TBadge :tone="reconTone(r)">
                {{ r.status }}
              </TBadge>
            </td>
            <td style="text-align: right">
              <button
                v-if="r.status !== '已匹配'"
                class="t-btn sm gold"
                :disabled="store.busy.value"
                @click="aiMatch(r)"
              >
                AI 找匹配
              </button>
              <span
                v-else
                class="t-muted done-dash"
              >已闭合</span>
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>

    <!-- ⑥ 月度报表 -->
    <TSection
      title="月度报表"
      sub="GMV / 净利 / 现金 · 月结经审批闸锁账后不可改"
    />
    <TPanel>
      <table class="t-table">
        <thead>
          <tr>
            <th>月份</th><th class="num">
              GMV $
            </th><th class="num">
              净利 ¥
            </th><th class="num">
              净利率
            </th><th class="num">
              现金 ¥
            </th><th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="rep in store.reports.value"
            :key="rep.month"
          >
            <td class="t-mono">
              <b>{{ rep.month }}</b>
            </td>
            <td class="num t-mono">
              {{ rep.gmvUsd.toLocaleString() }}
            </td>
            <td class="num t-mono">
              {{ rep.netProfitCny.toLocaleString() }}
            </td>
            <td class="num t-mono">
              {{ rep.marginPct }}%
            </td>
            <td class="num t-mono">
              {{ rep.cashCny.toLocaleString() }}
            </td>
            <td>
              <TBadge
                v-if="rep.closed"
                tone="green"
              >
                已锁账
              </TBadge>
              <TBadge
                v-else
                tone="amber"
              >
                未锁
              </TBadge>
            </td>
          </tr>
        </tbody>
      </table>
    </TPanel>
  </div>
</template>

<style scoped>
/* 票据入口 textarea：贴合面板风格 */
.ocr-input {
  width: 100%;
  resize: vertical;
  font-size: 12.5px;
  line-height: 1.7;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-strong);
  background: var(--bg-soft);
  color: var(--text);
  font-family: inherit;
}
.ocr-input:focus { outline: none; border-color: var(--primary); }
.ocr-actions { margin-top: 10px; align-items: center; gap: 12px; }
.ocr-hint { font-size: 11.5px; flex: 1; line-height: 1.6; }
/* 业务包卡片 */
.bundle-head { align-items: center; gap: 10px; margin-bottom: 6px; }
.bundle-title { font-size: 13px; }
.bundle-meta { font-size: 11px; }
.bundle-note { font-size: 12px; line-height: 1.65; color: var(--text-2); margin: 8px 0 0; }
.empty-cell { text-align: center; padding: 22px; }
.done-dash { font-size: 11px; }
</style>
