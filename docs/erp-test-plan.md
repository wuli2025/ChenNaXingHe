# 星河无头ERP · 工业级测试方案 v1.0

> 适用范围：`src/modules/erp/`（无头核心 + 策略引擎 + 审批流水线 + 10 模块视图 + 审批中心）
> 运行方式：`node node_modules/vitest/vitest.mjs run src/modules/erp`（happy-dom，agent runner 全 mock）
> 质量门：**任何提交必须 T1–T6 全绿**；T7 为发版前人工验收。

## 设计原则

1. **红线优先**：资金/税务/价格红线的测试密度最高——这些地方出错是真金白银的损失。
2. **不变量思维**：不仅测「输入 X 得到 Y」，更测「无论输入什么，Z 永远成立」（模糊/属性测试）。
3. **AI 不可信假设**：所有 AI 返回（runJson mock）按对抗输入设计——非法枚举、负数、超界、缺字段。
4. **回写完备**：每一种审批 kind 的「批准」「驳回」两条路径都必须有断言，不允许空转。

## 七层测试体系

### T1 策略引擎边界矩阵（`store.test.ts` 已建 + `invariants.test.ts` 扩展）

对 `decide(kind, opts)` 做全 kind × 边界值矩阵：

| 维度 | 边界点 | 期望 |
|---|---|---|
| 强制人工清单 | po-payment / tax-filing / export-rebate × 任意金额（含 0.01） | 恒 review + hardGate |
| 通用金额上限 | autoAmountCapUsd ±1 | 上=review 下=auto |
| 退款专属上限 | autoRefundCapUsd ±1 | 同上 |
| 高值件专属阈值 | highValueShipmentUsd ±1；且值域 (500, 800) 不被通用上限短路 | 专属规则优先 |
| 调价带宽 | ±priceAutoBandPct 边界、正负两侧 | 超幅 review |
| OCR 双闸 | conf 阈值 ±1 × 金额上限 ±1（含 EUR/USD 折算口径） | 任一破界即 review |
| 日频上限 | 第 dailyActionCap+1 次自动动作 | 转 review |

### T2 回写完备性（`store.test.ts` 已建 + `writebacks.test.ts` 扩展）

14 种 ReviewKind × {批准, 驳回} = 28 条路径逐一断言业务对象终态 + 台账记录：
- 批准必须落 `executedActions`（by=human），驳回不得落；
- 驳回不得留下「卡死状态」（如订单永久 refunding、Listing 永久 pending_review）；
- 链路接通类（replenish-po→自动入付款硬闸）必须断言下游闸生成。

### T3 核心不变量（模糊/属性测试，`invariants.test.ts`）

用固定种子伪随机批量输入（≥200 轮/条），验证永真式：
- **INV-1 硬闸不可逾越**：任意参数组合下（把每个参数随机改到极端），HUMAN_ONLY_ACTIONS 的 decide 结果恒为 review+hardGate。
- **INV-2 保本硬底线**：任意拟价（含负数、0、NaN 防御）经 applyPriceInternal/批准路径落地后，`currentUsd ≥ floorPrice(card)`。
- **INV-3 台账守恒**：任意操作序列后 `autonomyStats.total === auto + human`，且 autoRate ∈ [0,100]。
- **INV-4 审批列完备**：任意时刻四列任务数之和 = reviewTasks 总数（无任务凭空消失/重复）。
- **INV-5 非法 AI 输出无害**：runJson mock 返回缺字段/错类型/非法枚举时，业务状态不被污染（金额 NaN 不入账、价格 NaN 不生效）。

### T4 持久化往返（`persistence.test.ts`）

- **round-trip**：写入每类业务对象 → 读 localStorage 原文 → resetModules 重建 store → 深比较关键字段无损。
- **种子幂等**：首载 seeded 落盘后二次载入不重播种子、不产生重复审批卡。
- **损坏容错**：localStorage 中写入非法 JSON / 错误形状 → load() 不抛、回退种子。
- **参数合并**：老版本参数缺新字段时与 DEFAULT_PARAMS 合并不丢默认值。

### T5 组件挂载与交互（`mount.test.ts` 已建 + `interaction.test.ts` 扩展）

- 10 模块 + 审批中心挂载渲染非空（已建）；
- **审批安全交互**：批注框按 Enter 不得触发批准/驳回；驳回按钮在批注为空时禁用；已批准卡片无「重开」按钮、已驳回卡片有；
- 硬闸卡片渲染「🔒 强制人工」标记；facts 的 warn 行有告警样式。

### T6 编译与构建门（CI 命令）

```
npx vue-tsc --noEmit        # 类型零错误
npx vite build              # 生产构建通过
node node_modules/vitest/vitest.mjs run   # 全量测试
```

### T7 发版前人工验收清单（Tauri 真机）

1. `npm run tauri:dev`（注意：正式打包需在 ASCII 路径下构建）；
2. 侧栏「星河 ERP」→ 审批中心开箱 6 张卡（含 2 硬闸置顶）；
3. 批准付款硬闸 → E6 该 PO 变「已付」+ 台账出现人工记录；
4. 驳回 Listing 发布卡（填批注）→ 右坞可见 AI 带批注自动重跑 → 新提案刷新同一张卡；
5. E7 粘贴一段真实发票文字 → OCR 识别 → 按置信度正确分流；
6. E9 把自动调价带宽从 8 改 12（红线参数）→ 出现确认卡 → 批准后 E3 生效；
7. 断网/后端不可用时所有 AI 按钮报错清晰、不吞异常、界面不死。

## 多代理执行分工（本方案的执行者）

| 代理 | 交付物 | 约束 |
|---|---|---|
| Codex-A 对抗测试员 | `__tests__/invariants.test.ts`（T1 矩阵扩展 + T3 全部不变量） | 只新增测试文件；发现源码 bug 写入报告不改源码 |
| Codex-B 回写审计员 | `__tests__/writebacks.test.ts`（T2 全 28 路径） | 同上 |
| Codex-C 持久化与交互测试员 | `__tests__/persistence.test.ts` + `__tests__/interaction.test.ts`（T4+T5） | 同上 |
| Claude 主控 | 汇总报告、修复确认 bug、T6 终审 | — |
