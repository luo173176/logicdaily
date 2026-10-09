import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // 本项目的页面在 effect 里调用异步加载函数（`void load()`，load 内部 await IndexedDB 后再 setState）。
      // 该规则无法区分“异步回调里的 setState”和“渲染期级联 setState”，会把前者全部报成 error。
      // 真正的同步反例（深链接参数、能力检测）已改为 useState 惰性初始化，其余保留为 warning 以便复查。
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "test-results/**",
    "playwright-report/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
