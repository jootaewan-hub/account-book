// 빌드한 페이지에 넣는 콘텐츠 보안 정책: 스크립트는 이 사이트 파일만, 통신은 Supabase로만.
// 상품 이미지 호스트는 정확한 호스트 이름으로 하나씩 더한다(지금: 다나와 img.danuri.io, 장보기 후보·품목 상세의 상품 사진).
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://img.danuri.io",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')
