// 영수증·캡처 사진을 Claude에 보내기 전에 줄인다.
// Claude는 이미지를 28px 칸 단위로 세고(⌈w/28⌉×⌈h/28⌉ 토큰) 한도를 넘으면 서버에서 줄이므로,
// 그 한도 안으로 미리 줄여 업로드 크기와 비용을 아낀다.
export const MAX_IMAGE_TOKENS = 4784
export const MAX_SIDE = 2400

export function imageTokens(w: number, h: number): number {
  return Math.ceil(w / 28) * Math.ceil(h / 28)
}

/** 비율을 유지하면서 토큰 한도와 긴 변 한도 안에 들어가는 크기 */
export function fitImage(w: number, h: number, maxTokens = MAX_IMAGE_TOKENS, maxSide = MAX_SIDE): { w: number; h: number } {
  let s = Math.min(1, maxSide / Math.max(w, h), Math.sqrt((maxTokens * 28 * 28) / (w * h)))
  let fw = Math.max(1, Math.floor(w * s))
  let fh = Math.max(1, Math.floor(h * s))
  while (imageTokens(fw, fh) > maxTokens) {
    s *= 0.98
    fw = Math.max(1, Math.floor(w * s))
    fh = Math.max(1, Math.floor(h * s))
  }
  return { w: fw, h: fh }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error ?? new Error('read_failed'))
    r.readAsDataURL(blob)
  })
}

export interface PreparedImage {
  media_type: 'image/jpeg'
  data: string // base64
  width: number
  height: number
  blob: Blob
  preview: string // blob URL
}

/** 사진 파일 → 줄인 JPEG(base64). 사진의 회전 정보는 브라우저가 반영해서 그린다. */
export async function fileToJpeg(file: File): Promise<PreparedImage> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const { w, h } = fitImage(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas_unavailable')
    ctx.fillStyle = '#fff' // 투명 PNG 캡처의 배경
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), 'image/jpeg', 0.85))
    return { media_type: 'image/jpeg', data: await blobToBase64(blob), width: w, height: h, blob, preview: URL.createObjectURL(blob) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** 상품 사진 영역을 정사각형으로 넓힌다(쇼핑몰 썸네일은 대개 정사각형). 이미지 밖으로 나가지 않게 맞춘다 */
export function squareBox(b: Box, width: number, height: number, pad = 0.04): Box {
  const cx = (b.left + b.right) / 2
  const cy = (b.top + b.bottom) / 2
  const side = Math.min(Math.max(b.right - b.left, b.bottom - b.top) * (1 + pad * 2), width, height)
  const left = Math.min(Math.max(0, cx - side / 2), width - side)
  const top = Math.min(Math.max(0, cy - side / 2), height - side)
  return { left: Math.round(left), top: Math.round(top), right: Math.round(left + side), bottom: Math.round(top + side) }
}

/** 이미지(blob)에서 상품 사진을 잘라 작은 정사각형 JPEG로 만든다 */
export async function cropImage(src: Blob, box: Box, size = 240): Promise<Blob> {
  const url = URL.createObjectURL(src)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const sq = squareBox(box, img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas_unavailable')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, size, size)
    ctx.drawImage(img, sq.left, sq.top, sq.right - sq.left, sq.bottom - sq.top, 0, 0, size, size)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), 'image/jpeg', 0.85))
  } finally {
    URL.revokeObjectURL(url)
  }
}
