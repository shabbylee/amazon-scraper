import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // 集成测试用 supertest 起真实 HTTP server，scrape-api 里还含真实退避 sleep。
    // 默认 5s 在高负载 / 冷启动下会有 test 在读响应时被重置（偶发 ECONNRESET）。
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // threads 池中并行加载原生模块（better-sqlite3）与 HTTP server 会互相干扰，
    // 换成进程隔离换取稳定性。
    pool: 'forks',
  },
});
