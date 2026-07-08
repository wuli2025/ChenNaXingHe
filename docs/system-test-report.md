# ChenNaXingHe 全系统工业级测验总报告

日期：2026-07-07 · 执行：Claude 出方案与验证 + 10 个 codex CLI 子代理并行实施

## 三重门结果（全绿）

| 门 | 结果 |
|---|---|
| `vitest run`（全量） | **184 / 184 通过，0 skip**（14 个测试文件） |
| `vue-tsc --noEmit` | **零错误** |
| `vite build` | **构建成功**（仅既有 chunk 体积告警，非错误） |

测验前存量测试约 65 项 → 测验后 **184 项**，新增 12 个测试文件覆盖外壳 store / 供应商 store / XSS 渲染安全 / composables / 外贸不变量 / ERP 全链路场景 / 外壳挂载。

## 10 个 codex 子代理产出

| # | 维度 | 产出 | 结论 |
|---|---|---|---|
| C01 | 外壳状态机 | app.store.test.ts（6） | 无源码 bug |
| C02 | 供应商 store | providers.store.test.ts（14） | 无源码 bug |
| C03 | XSS 渲染安全 | markdown-security.test.ts（12） | 报 6 个"P0"→ 经验证为 happy-dom 假阳性，sanitize 实际安全 |
| C04 | composables | composables.test.ts（19） | 2 源码问题（1 已修 1 记录契约） |
| C05 | 外贸不变量 | trade/invariants.test.ts（8） | 2 源码 bug 已修 |
| C06 | ERP 全链路场景 | scenario.test.ts（1 大场景） | 跨模块一致，无 bug |
| C07 | 外壳挂载 | shell-mount.test.ts（5） | 无源码 bug |
| C08 | 安全审计 | security-audit.md | 0 P0，3 P1，2 P2 |
| C09 | Rust 后端审计 | rust-audit.md | 0 P0，1 P1，5 P2 |
| C10 | 工程健康 | build-health.md | 0 P0，4 P1，8 P2 |

## 修复清单（本轮，均带回归测试）

1. **参数投毒防护**（安全 C08-P1-02，ERP）：`params` 从 localStorage 加载时经 `sanitizeParams` 做白名单+范围钳制，越界/非法/未知键一律回落默认，篡改无法放宽自治边界。
2. **humanizeError 处理 code-only 错误**（C04）：`{ code: "ECONNREFUSED" }` 现能命中网络错误映射，不再返回 `[object Object]`。
3. **外贸 HS 归类不被残缺 AI 输出污染**（C05）：AI 漏返回 hsCode 时保留原有归类与置信度，不覆盖成 0。
4. **外贸对账不被残缺 AI 输出污染**（C05）：候选缺 target 时不用 undefined 覆盖已有匹配、不入无效审核。

## XSS "P0" 的求真过程（重点）

C03 报告 6 个 XSS 向量"未被拦截"（javascript:/onload/onclick/object/embed/data:）。此与 C08 静态审计"XSS 链路干净"冲突，且 XSS 属 P0，必须证伪或证实：

1. 诊断 happy-dom `removeAttribute` → 正常；默认 DOMPurify → 能剥离；
2. 对照发现问题触发于 happy-dom 下 DOMPurify **不可靠运行**（同配置两次结果不同、`FORBID_TAGS:['object']` 都删不掉 object，属最基础操作失效）；
3. 安装 jsdom（DOMPurify 兼容环境）实跑 → **12 个断言全部通过**。

结论：**sanitize.ts 完全正确安全**，6 个"P0"是 happy-dom 与 DOMPurify 的测试环境不兼容造成的假阳性。修复方式是给安全测试加 `@vitest-environment jsdom`（生产 Tauri Chromium webview 与 jsdom 行为一致），**不是改 sanitize**。既未盲信也未盲弃 P0，两个方向都做了实证。

## 遗留待办（非本轮 ERP 范围，列入 backlog）

**安全加固（C08）**：
- P1 postMessage 桥缺 nonce/来源窗口白名单（App.vue）——建议加一次性令牌 + `e.source` 校验。
- P1 Provider API Key 明文落盘且 desktop flavor 明文回传 renderer——建议迁 OS 凭据库。
- P2 workMode localStorage 可投毒为自动批准档；CSP 含 unsafe-inline/eval 偏宽。

**Rust 后端（C09，均在既有后端，需 cargo 环境验证）**：
- P1 kb.rs 只读子进程错误分支提前 return 未 kill/wait，可能遗留进程。
- P2 chat.rs 进程树只发 TERM 缺 KILL 兜底；server 模式 chat_attach_files 接受任意服务端路径；KB symlink 越界；持久化错误被静默吞；/ws /api/file query token 泄露面。

**工程健康（C10）**：
- P1 dist 两个 >500KB chunk（shiki cpp/wasm）；dev 端口漂移（1421 vs 1420 + strictPort:false）；CI lint/clippy 为软门槛（continue-on-error）；C10 建议把 lint/audit/bundle budget 提为硬门。
- P2 若干死代码候选、2 处 @ts-ignore、eslint no-explicit-any/no-v-html 仅 warn。

## 结论

新写的 ERP 模块 + 被牵连测到的外壳/store/lib/composables/外贸模块，**核心逻辑与安全面均达工业级**：策略红线不可绕过、审批回写完备、AI 输出全程按不可信处理、XSS 防护经真实环境实证、持久化往返无损。遗留项集中在既有应用外壳/Rust 后端的加固与工程质量门硬化，已按 P0/P1/P2 分级列入 backlog，无 P0 阻断项。
