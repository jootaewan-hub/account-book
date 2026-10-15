import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages처럼 하위 경로에 배포할 때는 BASE_PATH=/account-book/ 으로 빌드한다
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
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
        background_color: '#f2f4f1',
        theme_color: '#0d6b55',
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
