// Flat config (ESLint 9). 先以「不阻断」的宽松规则起步:
// 目标是先建立 lint 基线 + pre-commit 钩子, 存量告警清干净后再在 CI 收成硬门槛。
import js from "@eslint/js";
import ts from "typescript-eslint";
import vue from "eslint-plugin-vue";

export default ts.config(
  {
    ignores: [
      "dist/**",
      "src-tauri/**",
      "node_modules/**",
      "**/*.d.ts",
      "coverage/**",
      "public/**", // 静态产物, 不参与源码 lint
      "_scratch_*",
      "vitest.config.ts.timestamp-*",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: { parser: ts.parser },
    },
  },
  {
    // Node 环境脚本: 允许 process 等全局变量
    files: ["scripts/**/*.mjs", "tools/**/*.mjs", "*.config.js", "*.config.ts"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
        fetch: "readonly",
        WebSocket: "readonly",
        AbortController: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
      },
    },
  },
  {
    rules: {
      // 起步阶段降噪: 存量代码里这些先降级为 warn / off, 逐步收紧。
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "vue/multi-word-component-names": "off",
      "vue/no-v-html": "warn", // 提醒 v-html 处必须过 sanitize.ts
    },
  }
);
