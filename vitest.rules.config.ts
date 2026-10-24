import { defineConfig } from 'vitest/config'

/** 資料庫與 Storage 規則測試：由 npm run test:rules 在模擬器啟動後執行 */
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
})
