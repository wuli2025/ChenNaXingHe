import { defineConfig } from "vitest/config";

// 外贸 OS 单元测试：只测纯逻辑（store / 派生 / 审核回写），不编译 .vue，
// 故无需 vue 插件；happy-dom 提供 localStorage。
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    globals: true,
    // Tauri 后端与 agent runner 在单测里被 mock，不需要真实环境。
  },
});
