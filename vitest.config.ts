import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    // DB 테스트의 beforeAll이 마이그레이션 전부를 PGlite에 적용한다(여러 파일을 함께 돌리면 10초를 넘는다)
    hookTimeout: 30000,
  },
})
