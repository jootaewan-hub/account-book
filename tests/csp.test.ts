// 빌드한 페이지의 콘텐츠 보안 정책(src/lib/csp.ts). 장보기 grocery-app tests/csp.test.ts에서 가계부 값에 맞는 항목을 가져왔다.
import { describe, expect, it } from 'vitest'
import { CSP } from '../src/lib/csp'

const directive = (name: string) => (CSP.split('; ').find((d) => d.startsWith(`${name} `)) ?? '').split(' ').slice(1)

describe('CSP', () => {
  it("스크립트는 이 사이트 파일만(바코드 읽기 .wasm 실행 허용), 플러그인·프레임은 없음", () => {
    // 'wasm-unsafe-eval'은 이 사이트에서 받은 .wasm(zxing-wasm, P6)을 실행하기 위한 것이다. 외부 스크립트·인라인 스크립트는 여전히 막힌다
    expect(directive('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"])
    expect(directive('object-src')).toEqual(["'none'"])
    expect(directive('frame-src')).toEqual(["'none'"])
  })
  it('통신은 이 사이트와 Supabase(https·wss)만', () => {
    expect(directive('connect-src').sort()).toEqual(["'self'", 'https://*.supabase.co', 'wss://*.supabase.co'].sort())
  })
  it('이미지에 아무 https나 허용하는 값이 없고, 외부 호스트는 Supabase와 다나와 상품 사진 하나', () => {
    const img = directive('img-src')
    expect(img).not.toContain('https:')
    expect(img).not.toContain('*')
    expect(img.filter((x) => x.startsWith('https://')).sort()).toEqual(['https://*.supabase.co', 'https://img.danuri.io'])
  })
})
