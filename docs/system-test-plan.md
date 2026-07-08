# ChenNaXingHe 全系统工业级测验方案 v1.0

> 范围：整个应用 —— 外壳（App/SideNav/ChatPanel）、12 个 Pinia store、composables、lib 工具库、
> 外贸 OS（modules/trade）、星河ERP（modules/erp）、Rust 后端（src-tauri）、构建工程。
> 组织方式：**Claude 出方案与执行验证，10 个 codex CLI 子代理并行实施**。
> codex 沙箱无法 spawn 子进程（跑不了 vitest/cargo），故分工为：codex 写测试/审计 → Claude 代执行 + 修复 + 三重门终审。
> 三重门：`vitest run 全量` + `vue-tsc --noEmit` + `vite build`，全绿才算过。

## 10 个测验任务（C01–C10）

| # | 维度 | 交付物 | 要测出什么 |
|---|---|---|---|
| C01 | 外壳状态机 | `src/stores/__tests__/app.store.test.ts` | moduleTab 切换、isNativeTab 单点真相、主题迁移（旧键 nougat）、侧栏/抽屉宽度钳制、置顶集合持久化、localStorage 损坏容错 |
| C02 | 供应商/用量 store | `src/stores/__tests__/providers.store.test.ts` | providers 状态机、增删改、用量统计口径、异常输入防御 |
| C03 | 渲染安全 | `src/lib/__tests__/markdown-security.test.ts` | XSS 全向量（script/onerror/javascript:/svg onload/iframe/data:uri/事件属性）经 renderMarkdown 后必须无害化；sanitize.ts 白名单行为 |
| C04 | composables | `src/composables/__tests__/composables.test.ts` | useToast 队列/去重、usePolling 启停与泄漏、humanizeError 各错误形状、useFileDrop active 判定 |
| C05 | 外贸 OS 不变量 | `src/modules/trade/__tests__/invariants.test.ts` | 审核四列守恒、enqueue 去重、computeWineTax 数学性质（非负/单调/逐分位一致）、驳回重跑闭环、非法 AI 输出无害 |
| C06 | ERP 全链路场景 | `src/modules/erp/__tests__/scenario.test.ts` | 「一单到底」：补货建议→PO→付款硬闸→订单→选路→票据 OCR→对账→月结→报税，跨模块状态一致性与台账完整性 |
| C07 | 外壳组件挂载 | `src/components/__tests__/shell-mount.test.ts` | SideNav 等核心外壳组件在 mock tauri + pinia 下可挂载渲染、导航交互正确 |
| C08 | 安全审计（报告） | `_scratch_codex/security-audit.md` | postMessage 桥攻击面、XSS 面、localStorage 投毒、chat.rs 命令注入面、密钥存储、CSP/Tauri capability |
| C09 | Rust 后端审计（报告） | `_scratch_codex/rust-audit.md` | chat.rs/server.rs/conv.rs/host.rs：并发安全、错误吞咽、路径穿越、spawn 参数注入、资源泄漏 |
| C10 | 工程健康（报告） | `_scratch_codex/build-health.md` | 依赖已知漏洞、bundle 体积热点、死代码、tsconfig/vite 配置风险、CI 缺口清单 |

## 执行纪律（对每个 codex 代理生效）

1. 只新建自己名下的文件，不改任何既有源码与测试；
2. 发现源码真实缺陷：写进最终报告（文件:行号 + 复现 + 期望），测试类任务把对应用例 `it.skip` 附注释，由 Claude 修复后转正；
3. 测试必须能在 happy-dom + vi.mock 下确定性运行（mock `src/tauri.ts`、`useAgentRunner`、必要时 `lib/markdown`），禁 Math.random/真实网络/真实后端；
4. Pinia store 测试先 `setActivePinia(createPinia())`；
5. 报告类任务（C08–C10）：纯只读，产出中文 Markdown 报告，每条发现带严重级（P0/P1/P2）与证据。

## 验收口径

- C01–C07 的测试由 Claude 全部代跑通过（缺陷用例修复后转正，最终 0 skip）；
- C08–C10 报告中的 P0 项必须修复或给出明确豁免理由；P1 列入待办；
- 三重门全绿；
- 最终产出《全系统工业级测验总报告》：覆盖矩阵、缺陷清单（发现→修复→回归证据）、遗留风险与豁免。
