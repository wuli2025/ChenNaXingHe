# 传音营销智能体 · 重构计划（Polaris → Chuanying）

> 把原 Polaris「本地优先 AI 工作台」精简为一个**以 Claude Code 为唯一后端大脑**的营销智能体核心，
> 顶部切换三个营销应用场景，其余能力收进「设置/更多」。更新仓库迁移到
> `https://github.com/wuli2025/ChenNaXingHe`。

## 1. 决策摘要（按用户语音指令解码）

### 保留的主干（backbone）
- **Claude Code 对话核心**：`chat.rs` / `conv.rs` / `ChatPanel.vue` —— rust 接 claude code CLI。
- **API / 供应商切换（CC 切换）**：`provider.rs` / `ProviderDock.vue` / `providers.ts`。
- **知识库（RAG 向量 + 新图谱）**：`kb.rs` + `fable/`（retrieve/index/inventory）+ `KnowledgeGraph.vue` + `WikiBrowse.vue`。
- **环境配置**：`doctor.rs` / `EnvDoctor.vue`（保留环境配置，去掉「环境部署」噪声）。
- **经验中心（专家团）**：`expert.rs` / `ExpertCenter.vue`。
- **技能中心**：`skills.rs` / `SkillCenter.vue`。
- **自动化**：`automation` / `Automation.vue`。
- **语音输入 / TTS 下载**：`voice.rs` / `VoiceSettings.vue` / `VoiceOverlay.vue`。
- **自动更新**：`updater.rs`（仓库已切到 ChenNaXingHe）。

### 删除的分支（branches removed）
- 文件中心 `FileCenter.vue` / `fileTasks.ts` / `fable::files`
- 毛主席项目：`resources/seed-kb/毛主席/**`、`persona.rs`、`consult-mao`、`mao_persona_claude.md`、`xhs-mao-pipeline`
- 媒体模块：`forge_video/capture/pptx/pptx_native/fx_safe`、`MediaOps.vue`、`DeckStudio.vue`、`WebStudio.vue`、`VideoCourseStudio.vue`、四套 *-studio skills
- 寓言计划 / 预演计划：`sense.rs`、`echo.rs`、`SenseApi.vue`、回声/做梦调度
- MCP：`McpConfigModal.vue`（只留环境配置）
- NAS：`nas.rs` / `NasManager.vue`
- 飞书 / 企业微信：`feishu.rs` / `wecom.rs` / `FeishuSettings.vue`
- 沙箱：`polaris-sandbox` / `SandboxStatus.vue`（核心化不需要）
- 左侧「项目 / 对话」侧栏与历史、对话框下方权限 UI、右侧抽屉 `RightDrawer.vue`

### 新增的三个顶层应用场景（前端复刻 + Claude Code 后端）
桌面三个单文件 web app 的**业务逻辑 / 思路 / 前端布局**复刻进来，后端从各自的
Gemini/Tavily/luckyapi 换成本应用的 Claude Code：
1. **KOC 筛选工作流**（`koc-workflow`）：Brief → 录入 KOC → 评分筛选 → Tracking + 视频监测。
2. **竞品分析 Agent**（`competitive`）：增长标杆拆解 / 危机诊断拆解 两模式。
3. **PMKT 营销策略工作流**（`pmkt`）：趋势雷达 → 人群解码 → 产品锚点 → 策略蓝图。

> 三者本质都是「传音 / Infinix 出海营销」工具，与本项目名「传音」同源 —— 这就是新软件的主线。

## 2. 新外壳（shell）布局

```
┌────────────────────────────────────────────────────────────┐
│  传音智能体   [对话] [KOC筛选] [竞品分析] [营销策略]   供应商▾  ⚙更多 │  ← 顶部切换
├───────────────────────────────┬────────────────────────────┤
│  对话 / 智能体控制台（核心）    │   看板 / 工作区（数据）       │
│  ChatPanel 复用                │   各模块自己的表格/卡片/图表   │
│  （左侧）                      │   （右侧）                   │
└───────────────────────────────┴────────────────────────────┘
```
- 顶部 tab 切换「模块」；对话框移到左边做核心；右边放看板数据。
- 删左侧项目侧栏、右抽屉、对话框下权限区。
- ⚙更多 → 设置面板：供应商/API、环境配置、知识库、经验中心、技能中心、自动化、语音/TTS、主题、更新。

## 3. 集成契约：Claude Code 即后端

新模块统一经 `src/composables/useAgentRunner.ts` 驱动 Claude Code：
- `run(opts)`：发起一轮 agent 任务，流式回 delta/tool，done 后返回全文。
- `runJson<T>(opts)`：要求结构化 JSON，自带 ```json``` 提取 + 容错修复（坏 JSON 回灌 Claude 修）。
- 每个 workflow run 用**全新会话**（隔离上下文、无污染）；模块自身状态持久化到 localStorage（保留历史/记录）。
- 真实数据：让 Claude Code 用自带 WebSearch/WebFetch 真检索（替代 Tavily/Gemini grounding），
  并对引用 URL 做校验 —— 直接服务「数据更真实」「ai 跑了什么看得见」。

## 4. 三个原应用的已知问题（用户提出）→ 重构对策
- **KOC**：只能跑一次、无记录、无上下文工程；判定是否达标不透明、AI 跑没跑看不见。
  → 持久化每次筛选 run + 每个 KOC 的事件日志；评分项标注来源（用户填/启发式/AI 评）；AI 定性判定可见可解释。
- **舆情/竞品**：爬虫没写好；回答得不行。
  → 用 Claude Code 真检索 + 多阶段（研究→估算→推理→成稿）替单次大模型塞大 JSON；引用带来源与置信度。
- **PMKT**：ai 脑子=我的脑子。
  → 方法论（证据接地、反向卖点机会分、卖点taxonomy）固化进可编辑提示词；逐步可人工修订再喂下一步。
- **任务/上下文管理**：分阶段、可被 AI 自动检查。
  → 每个 workflow 按阶段 gating，阶段产物结构化存档，提供「让 AI 复核本阶段」动作。

## 5. 执行阶段
1. ✅ 更新仓库 → ChenNaXingHe（tauri.conf.json / updater.rs / UpdatePanel.vue / docs）。
2. 新外壳 + ViewKey 精简 + 设置聚合（App.vue / stores/app.ts / 顶部导航）。
3. 共享 agent runner（useAgentRunner）。
4. 三个营销模块（PMKT / KOC / 竞品分析）。
5. 删除分支模块（前端组件 + 后端 lib.rs 模块表/命令表 + 资源）。
6. 构建校验：vue-tsc + cargo check + 冒烟。
