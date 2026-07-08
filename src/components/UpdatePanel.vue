<script setup lang="ts">
// 「更新」板块：显示当前版本、手动检查更新、一键更新。
// 与中央对话框(UpdateBanner)共享 useUpdater 的状态——启动自动检测，
// 这里则给用户一个随时主动检查的入口。
import { onMounted, computed } from "vue";
import { getVersion } from "@tauri-apps/api/app";
import {
  RefreshCw,
  Sparkles,
  CheckCircle2,
  LoaderCircle,
  Rocket,
} from "@lucide/vue";
import {
  currentVersion,
  updateVersion,
  updateNotes,
  updating,
  updateProgress,
  updateError,
  checking,
  upToDate,
  checkFailed,
  lastCheckedAt,
  manualCheck,
  applyUpdate,
} from "../composables/useUpdater";

onMounted(async () => {
  if (!currentVersion.value) {
    try {
      currentVersion.value = await getVersion();
    } catch {
      /* 浏览器预览态拿不到版本，忽略 */
    }
  }
});

const lastChecked = computed(() => {
  if (!lastCheckedAt.value) return "";
  const d = new Date(lastCheckedAt.value);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
});
</script>

<template>
  <div class="up-panel">
    <header class="up-header">
      <h1>更新</h1>
      <p class="up-sub">
        保持 Polaris 为最新版本
      </p>
    </header>

    <div class="up-body">
      <!-- 当前版本 -->
      <div class="ver-card">
        <img
          class="ver-logo"
          src="../assets/logo.png"
          alt="北极星"
        >
        <div class="ver-meta">
          <div class="ver-name">
            北极星 · Polaris
          </div>
          <div class="ver-num">
            当前版本 v{{ currentVersion || "—" }}
          </div>
        </div>
        <button
          class="ck-btn"
          :disabled="checking || updating"
          @click="manualCheck"
        >
          <LoaderCircle
            v-if="checking"
            :size="15"
            :stroke-width="2"
            class="spin"
          />
          <RefreshCw
            v-else
            :size="15"
            :stroke-width="2"
          />
          <span>{{ checking ? "检查中…" : "检查更新" }}</span>
        </button>
      </div>

      <!-- 状态 / 更新区 -->
      <div class="state">
        <!-- 发现新版本 -->
        <div
          v-if="updateVersion"
          class="found"
        >
          <div class="found-top">
            <span class="found-badge"><Sparkles
              :size="18"
              :stroke-width="1.7"
            /></span>
            <div>
              <div class="found-title">
                发现新版本 <b>v{{ updateVersion }}</b>
              </div>
              <div class="found-hint">
                {{ updating ? "正在下载，完成后自动重启生效" : "点「立即更新」后台下载安装，自动重启即用" }}
              </div>
            </div>
          </div>

          <div
            v-if="updateNotes && !updating"
            class="found-notes"
          >
            {{ updateNotes }}
          </div>

          <div
            v-if="updating"
            class="bar"
          >
            <div
              class="bar-fill"
              :style="{ width: updateProgress + '%' }"
            />
          </div>

          <button
            class="go-btn"
            :disabled="updating"
            @click="applyUpdate"
          >
            <LoaderCircle
              v-if="updating"
              :size="15"
              :stroke-width="2"
              class="spin"
            />
            <Rocket
              v-else
              :size="15"
              :stroke-width="1.9"
            />
            <span>{{ updating ? `更新中 ${updateProgress}%` : "立即更新" }}</span>
          </button>
        </div>

        <!-- 已是最新 -->
        <div
          v-else-if="upToDate"
          class="ok"
        >
          <CheckCircle2
            :size="18"
            :stroke-width="1.8"
          />
          <span>已是最新版本</span>
        </div>

        <!-- 自动检查失败（非静默，引导用户手动检查） -->
        <div
          v-else-if="checkFailed && !updateVersion"
          class="err"
        >
          <div>自动检查更新失败: {{ updateError || "网络或服务端异常" }}</div>
          <div style="margin-top:4px;font-size:11px;color:var(--dim)">
            可点击上方「检查更新」重试，或前往
            <a
              href="https://github.com/wuli2025/ChenNaXingHe/releases"
              target="_blank"
              style="color:var(--primary)"
            >GitHub Releases</a>
            手动下载
          </div>
        </div>

        <!-- 错误 -->
        <div
          v-else-if="updateError"
          class="err"
        >
          {{ updateError }}
        </div>

        <!-- 空闲 -->
        <div
          v-else
          class="idle"
        >
          Polaris 启动时会自动检查更新
        </div>

        <div
          v-if="lastChecked"
          class="last"
        >
          上次检查 {{ lastChecked }}
        </div>
      </div>

      <!-- 工作原理 -->
      <div class="how">
        <div class="how-title">
          更新是怎么工作的
        </div>
        <ol>
          <li>启动时自动检查 GitHub 上有没有新版本</li>
          <li>发现新版会在屏幕中央弹一个轻提示，点「立即更新」即可</li>
          <li>后台静默下载并安装，<b>自动重启</b>到新版 —— 无需手动重装</li>
        </ol>
      </div>
    </div>
  </div>
</template>

<style scoped>
.up-panel {
  height: 100%;
  overflow-y: auto;
  background: var(--bg);
  padding: 28px 32px 40px;
}
.up-header {
  margin-bottom: 22px;
}
.up-header h1 {
  margin: 0;
  font-family: var(--serif);
  font-size: 22px;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: 2px;
}
.up-sub {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--muted);
}
.up-body {
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ver-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  /* 玻璃卡片:渐变底 + 白玻璃描边 + 发丝投影 */
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 14px;
  box-shadow: var(--card-shadow);
}
.ver-logo {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  object-fit: contain;
  flex-shrink: 0;
}
.ver-meta {
  flex: 1;
  min-width: 0;
}
.ver-name {
  font-family: var(--serif);
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: 1px;
}
.ver-num {
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted);
}
.ck-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  /* 次级玻璃按钮 */
  border: 1px solid var(--card-border);
  border-radius: 10px;
  background: var(--card-bg);
  color: var(--text);
  font-size: 12.5px;
  font-weight: 500;
  flex-shrink: 0;
  transition: transform 0.12s var(--ease, ease), box-shadow 0.12s var(--ease, ease);
}
.ck-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
  transform: translateY(-1px);
  box-shadow: var(--shadow);
}
.ck-btn:active:not(:disabled) {
  transform: translateY(0) scale(0.98);
}
.ck-btn:disabled {
  opacity: 0.65;
  cursor: default;
}

.state {
  padding: 4px 2px;
}
.found {
  padding: 16px;
  background: var(--primary-soft);
  border: 1px solid color-mix(in srgb, var(--primary) 28%, transparent);
  border-radius: 14px;
  /* 主色 tint 保留,只补玻璃投影提层次 */
  box-shadow: var(--card-shadow);
}
.found-top {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.found-badge {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--panel);
  color: var(--primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.found-title {
  font-size: 14px;
  color: var(--text);
  font-weight: 500;
}
.found-title b {
  color: var(--primary);
}
.found-hint {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--muted);
}
.found-notes {
  margin-top: 12px;
  max-height: 120px;
  overflow-y: auto;
  padding: 10px 12px;
  background: var(--panel);
  border-radius: 10px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-2);
  white-space: pre-wrap;
}
.bar {
  margin-top: 14px;
  height: 6px;
  border-radius: 3px;
  background: var(--panel);
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  background: var(--primary);
  border-radius: 3px;
  transition: width 0.2s ease;
}
.go-btn {
  margin-top: 14px;
  width: 100%;
  padding: 11px 0;
  border: none;
  border-radius: 11px;
  background: var(--btn-solid-bg);
  color: var(--btn-solid-text);
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: 1px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  /* 玻璃三件套:顶部镜面高光 + 底部收边 + 柔和投影 */
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.32), inset 0 -1px 0 rgba(0, 0, 0, 0.14),
    0 6px 16px -6px rgba(28, 48, 69, 0.55);
  transition: background 0.15s var(--ease, ease), transform 0.12s var(--ease, ease);
}
.go-btn:hover:not(:disabled) {
  background: var(--primary);
}
.go-btn:active:not(:disabled) {
  transform: scale(0.98);
}
.go-btn:disabled {
  opacity: 0.85;
  cursor: default;
}
.ok {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--primary);
  font-weight: 500;
}
.err {
  font-size: 12.5px;
  color: var(--vermilion);
  line-height: 1.6;
}
.idle {
  font-size: 12.5px;
  color: var(--muted);
}
.last {
  margin-top: 8px;
  font-size: 11px;
  color: var(--dim);
}

.how {
  margin-top: 4px;
  padding: 16px 18px;
  /* 玻璃卡片:与上方版本卡统一材质 */
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 14px;
  box-shadow: var(--card-shadow);
}
.how-title {
  font-family: var(--serif);
  font-size: 12.5px;
  letter-spacing: 1.5px;
  color: var(--text-2);
  margin-bottom: 8px;
}
.how ol {
  margin: 0;
  padding-left: 18px;
}
.how li {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.9;
}
.how li b {
  color: var(--text-2);
}
.spin {
  animation: up-spin 0.9s linear infinite;
}
@keyframes up-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
