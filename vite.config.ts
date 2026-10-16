import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages처럼 하위 경로에 배포할 때는 BASE_PATH=/account-book/ 으로 빌드한다
const base = process.env.BASE_PATH ?? '/'

// 설정 화면에 보이는 앱 버전: 커밋 앞 7자리 · 빌드 시각(한국 시간)
const builtAt = new Date(Date.now() + 9 * 3600_000).toISOString().slice(5, 16).replace('T', ' ')
const appVersion = `${(process.env.GITHUB_SHA ?? 'local').slice(0, 7)} · ${builtAt}`

// 빌드한 페이지에만 콘텐츠 보안 정책(CSP)을 넣는다: 스크립트는 이 사이트 파일만, 통신은 Supabase로만.
// GitHub Pages는 응답 헤더를 못 바꿔서 meta 태그로 넣는다. 개발 서버는 인라인 스크립트(HMR)를 써서 뺀다.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    react(),
    {
      name: 'csp-meta',
      apply: 'build',
      transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '우리집 가계부',
        short_name: '가계부',
        description: '둘이 같이 쓰는 가계부',
        lang: 'ko',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        // 가계부 데이터(Supabase)는 캐시하지 않는다. 앱 파일만 캐시.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
})
