import { defineConfig } from 'vitest/config'

// 自動生成の計測（npm run bench）だけを実行する設定。通常の npm test には含めない（時間がかかるため）
export default defineConfig({
  test: {
    include: ['src/**/*.benchrun.ts'],
    testTimeout: 30 * 60 * 1000,
  },
})
