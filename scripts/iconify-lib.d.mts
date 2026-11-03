// iconify-lib.mjs의 타입(시험 파일이 tsc 검사를 받기 때문에 둔다)

export interface AllowedSet {
  title: string
  spdx: string
  holder: string
  home: string
  licenseRaw: string
  /** 아이콘 격자(viewBox 한 변) */
  grid: number
  /** mono: 한 색(currentColor), color: 칸마다 정한 색(기념일 그림) */
  mode: 'mono' | 'color'
  /** Icons.tsx에서 쓰는 공통 속성 이름 */
  base: 'ph' | 'emoji'
}

export const ALLOWED_SETS: Record<'ph' | 'fluent-emoji-flat', AllowedSet>

export function parseIconId(id: string | undefined): { prefix: 'ph' | 'fluent-emoji-flat'; name: string }
export function componentName(name: string): string
export function checkCollection(prefix: string, collections: unknown): unknown
export function resolveIcon(json: unknown, name: string): string
export function toJsxChildren(body: string, mode?: 'mono' | 'color'): string
export function renderComponent(args: { component: string; prefix: string; name: string; jsx: string }): string
export function creditRow(args: { component: string; prefix: string; name: string; date: string }): string
