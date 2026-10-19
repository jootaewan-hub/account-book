// 바코드로 상품 보기(P6): 카메라·사진에서 소매 바코드(EAN-13·EAN-8·UPC)를 읽는다.
// 브라우저의 BarcodeDetector가 소매 형식을 지원하면 그것을, 아니면(iPhone Safari 등) ZXing-C++ WebAssembly 포니필(barcode-detector, MIT)을 쓴다.
// 포니필의 .wasm(약 1.1MB)은 번들에 넣어 이 사이트에서만 받는다(외부 스크립트 금지, CSP script-src에 'wasm-unsafe-eval'). 읽을 때만 불러온다.
import { danawaSearchUrl } from '../../../supabase/functions/_shared/danawa'

export const RETAIL_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const
export type RetailFormat = (typeof RETAIL_FORMATS)[number]

/** GS1 검사 숫자(마지막 자리): 오른쪽에서 두 번째부터 3, 1, 3, 1… 을 곱해 더한 값을 10의 배수로 맞추는 수 */
function checkDigitOk(d: string): boolean {
  let sum = 0
  for (let i = 0; i < d.length - 1; i++) {
    const n = Number(d[d.length - 2 - i])
    sum += i % 2 === 0 ? n * 3 : n
  }
  return (10 - (sum % 10)) % 10 === Number(d[d.length - 1])
}

/** 읽은 글자를 소매 바코드 숫자로: 숫자만 남기고, UPC-A(12자리)는 앞에 0을 붙여 EAN-13으로, 검사 숫자가 틀리면 null */
export function normalizeBarcode(raw: string): string | null {
  const d = raw.replace(/\D/g, '')
  if (d.length === 12) return checkDigitOk(`0${d}`) ? `0${d}` : null
  if (d.length === 13 || d.length === 8) return checkDigitOk(d) ? d : null
  return null
}

/** 바코드 숫자로 다나와를 검색하는 주소(새 창으로 연다, 서버를 거치지 않음) */
export function danawaBarcodeUrl(code: string): string {
  return danawaSearchUrl(code)
}

export type Detected = { code: string; format: string }
export type Detector = { detect(source: ImageBitmapSource): Promise<Detected[]> }

type NativeDetected = { rawValue: string; format: string }
type NativeDetector = { detect(source: ImageBitmapSource): Promise<NativeDetected[]> }
type NativeCtor = (new (opts: { formats: string[] }) => NativeDetector) & { getSupportedFormats?: () => Promise<string[]> }

// 포니필의 .wasm을 이 사이트의 파일로(Vite가 자산으로 묶어 준다)
const WASM_URL = new URL('../../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', import.meta.url).href

let cached: Promise<Detector> | null = null

/** 읽기 도구. 처음 한 번만 만든다(브라우저 내장 또는 포니필). */
export function getDetector(): Promise<Detector> {
  cached ??= (async () => {
    const native = (globalThis as { BarcodeDetector?: NativeCtor }).BarcodeDetector
    const supported = native?.getSupportedFormats ? await native.getSupportedFormats().catch(() => []) : []
    if (native && RETAIL_FORMATS.every((f) => supported.includes(f))) return wrap(new native({ formats: [...RETAIL_FORMATS] }))
    const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill')
    prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? WASM_URL : prefix + path) } })
    return wrap(new BarcodeDetector({ formats: [...RETAIL_FORMATS] }) as unknown as NativeDetector)
  })()
  return cached
}

function wrap(d: NativeDetector): Detector {
  return {
    async detect(source) {
      const found = await d.detect(source)
      return found.map((r) => ({ code: r.rawValue, format: r.format })).filter((r) => r.code)
    },
  }
}

/** 읽은 것 중 첫 소매 바코드(정리한 숫자). 없으면 null */
export function pickRetail(found: Detected[]): string | null {
  for (const f of found) {
    const code = normalizeBarcode(f.code)
    if (code) return code
  }
  return null
}
