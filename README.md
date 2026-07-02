<div align="center">

# 陈娜星河 · ChenNaXingHe

### 本地优先的跨境电商 AI 工作台

**跑在你自己电脑上** · 墨蓝水墨风 · Tauri 2 + Vue 3 + Rust

</div>

---

## ✨ 这是什么

陈娜星河（ChenNaXingHe）是一个**跑在你自己电脑上**的跨境电商 AI 工作台。它把 Claude Code 的对话能力、可检索的本地知识库、可插拔的技能系统、多家 API 供应商的一键切换，以及一整套跨境电商业务模块（KOC 招募、竞品分析、营销策略、外贸 OS 等），收进同一个墨蓝水墨风的桌面应用里。

你的对话、知识、生成的成品，全部安放在本地的「工作文件夹」中——数据始终是你的。

> 首次使用会引导你安顿好工作文件夹（默认 `~/ChenNaXingHe`），所有数据、知识库、技能、模型都落在这个独立目录下。

---

## 🧩 核心能力

| 模块 | 能力 |
|------|------|
| ① 对话核心 | spawn `claude` CLI（沙箱或宿主），stream-json 流式渲染，四档权限 |
| ② 维基知识库 | 文件扫描 / 关键词加权评分搜索 / 双链图谱 / 拖拽入库 |
| ③ 技能系统 | 技能=prompt 注入；catalog 预置 + 用户自建 + 外部导入（git/url/zip）|
| ④ API 供应商坞 | 多供应商一键切换（写 `~/.claude/settings.json`）+ 用量看板 |
| ⑤ 跨境电商模块 | KOC 招募、竞品分析、营销策略、外贸 OS 等原生业务模块，直连 Claude Code |
| ⑥ 文件转换 | 任意格式拖拽 → 转 Markdown 入库 / 作对话附件（`convert.rs`）|
| ⑦ 启动体验 | 品牌启动页 + 首次工作文件夹引导 |

---

## ⚙️ 前置依赖

| 工具 | 用途 |
|------|------|
| Node 20+ | 前端构建 (`npm`) |
| Rust 1.80+ | Tauri 后端 |
| Docker Desktop | 沙箱镜像构建 / 运行（可选）|
| `claude` CLI | 对话核心调用（沙箱内自动装；宿主由「环境医生」一键装，或手动 `npm i -g @anthropic-ai/claude-code --registry=https://registry.npmmirror.com`，国内可装）|

## 🚀 开发模式

```powershell
# 把 cargo 加进 PATH
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

npm install          # 首次
npm run tauri:dev
```

Vite 端口固定 1420/1421。若被占用先清端口：

```powershell
Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess | ForEach-Object {
    Stop-Process -Id $_ -Force
  }
```

> 注意：Tauri 打包（`build.rs`）对含中文的工作路径敏感，构建时请把仓库放在纯 ASCII 路径下。

## 📦 打包安装版

```powershell
npm run tauri:build
```

产物在 `src-tauri/target/release/`：
- `ChenNaXingHe.exe` — 免安装可执行文件
- `bundle/nsis/ChenNaXingHe_<ver>_x64-setup.exe` — NSIS 安装包（开始菜单 + 桌面图标，可在控制面板卸载）

## 🔄 自动更新

应用内置 Tauri updater，更新通道独立托管在本仓库的 GitHub Release：

- 端点：`https://github.com/wuli2025/ChenNaXingHe/releases/latest/download/latest.json`
- 发版：打 `v*` 标签触发 `.github/workflows/release.yml`，在 Windows + macOS 上并行构建并用**本项目专属**的更新私钥签名（存于本仓库 Actions secret，与任何其他项目无关）。
- 下载走 `gh-proxy` / `ghfast` 国内镜像 + 直连 GitHub 兜底，字节做 minisign 验签，签名不过自动跳源。

## 📁 文件结构

```
ChenNaXingHe/
├── src/                      # Vue 3 前端
│   ├── App.vue               # 布局 + 启动流程(splash/onboarding)
│   ├── components/           # SideNav / ChatPanel / WikiBrowse / ...
│   ├── modules/              # 跨境电商业务模块（koc / competitive / pmkt / trade ...）
│   ├── stores/               # Pinia: app / providers / skills / artifacts
│   └── composables/          # useFileDrop 等
├── src-tauri/                # Rust 后端
│   ├── src/chat.rs           # ① 对话核心
│   ├── src/kb.rs             # ② 维基知识库
│   ├── src/skills.rs         # ③ 技能系统
│   ├── src/provider.rs       # ④ 供应商坞 + 用量
│   ├── src/updater.rs        # 自动更新（本仓库独立通道）
│   └── src/templates/        # Dockerfile + KB 骨架 + 技能模板
├── docs/                     # 规划 PRD + 发版手册
└── README.md                 # 本文
```

## 已知限制

- 索引只在内存，进程重启重扫
- 进程池 / 排队 / 优先级未实现（对话发出即调起一个 claude 进程）
- 浏览器模式（`npm run dev`）只能预览 UI，后端调用走 stub
</content>
</invoke>
