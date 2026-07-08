import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// 单元测试：纯逻辑（store / 派生 / 审核回写）+ 组件挂载冒烟（ERP 模块 mount.test.ts），
// 后者需要编译 .vue，故引入 vue 插件；happy-dom 提供 localStorage / DOM。
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    globals: true,
    // Tauri 后端与 agent runner 在单测里被 mock，不需要真实环境。
  },
});
