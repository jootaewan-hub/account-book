import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { CSP } from './src/lib/csp.ts'

// GitHub Pages처럼 하위 경로에 배포할 때는 BASE_PATH=/account-book/ 으로 빌드한다
const base = process.env.BASE_PATH ?? '/'

// 설정 화면에 보이는 앱 버전: 커밋 앞 7자리 · 빌드 시각(한국 시간)
const builtAt = new Date(Date.now() + 9 * 3600_000).toISOString().slice(5, 16).replace('T', ' ')
const appVersion = `${(process.env.GITHUB_SHA ?? 'local').slice(0, 7)} · ${builtAt}`

// 빌드한 페이지에만 콘텐츠 보안 정책(CSP)을 넣는다(src/lib/csp.ts). GitHub Pages는 응답 헤더를 못 바꿔서 meta 태그로 넣는다.
// 개발 서버는 인라인 스크립트(HMR)를 써서 뺀다.

export default defineConfig({
  base,
  // 개발 서버 포트. 5173은 이 컴퓨터에서 다른 앱의 서비스 워커가 잡고 있어 5188을 쓴다(scripts/screenshots.mjs 기본 주소와 같다)
  server: { port: 5188, strictPort: true },
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    react(),
    {
      // 설정 '앱' 카드의 업데이트 확인이 캐시 없이 읽는 최신 버전(src/lib/appUpdate.ts). __APP_VERSION__과 같은 값이다.
      // json은 아래 globPatterns에 없어 서비스 워커가 미리 받지 않는다(늘 서버에서 읽는다). 개발 서버도 같은 값을 준다(화면 캡처용).
      name: 'app-version-file',
      configureServer(server) {
        server.middlewares.use(`${base}version.json`, (_req, res) => {
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ version: appVersion }))
        })
      },
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: appVersion }) })
      },
    },
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
        // 안드로이드에서 앱 아이콘을 길게 누르면 보이는 바로가기. 주소로 여는 탭은 장보기뿐이다(App.tsx initialTab)
        shortcuts: [{ name: '장보기', short_name: '장보기', url: `${base}?tab=grocery`, icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }] }],
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        // 가계부 데이터(Supabase)는 캐시하지 않는다. 앱 파일만 캐시.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 바코드 읽기 .wasm(약 1.1MB)도 앱 파일처럼 캐시한다
      },
    }),
  ],
})
