import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 화면 시험(*.test.tsx)은 파일 맨 위 `// @vitest-environment jsdom`으로 브라우저 흉내(jsdom)를 켠다
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
    // DB 테스트의 beforeAll이 마이그레이션 전부를 PGlite에 적용한다(여러 파일을 함께 돌리면 10초를 넘는다)
    hookTimeout: 30000,
  },
})
