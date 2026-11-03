// iconify-lib.mjs의 타입(시험 파일이 tsc 검사를 받기 때문에 둔다)

export interface AllowedSet {
  title: string
  spdx: string
  holder: string
  home: string
  licenseRaw: string
  /** 아이콘 격자(viewBox 한 변) */
  grid: number
}

export const ALLOWED_SETS: Record<'ph', AllowedSet>

export function parseIconId(id: string | undefined): { prefix: 'ph'; name: string }
export function componentName(name: string): string
export function checkCollection(prefix: string, collections: unknown): unknown
export function resolveIcon(json: unknown, name: string): string
export function toJsxChildren(body: string): string
export function renderComponent(args: { component: string; prefix: string; name: string; jsx: string }): string
export function creditRow(args: { component: string; prefix: string; name: string; date: string }): string
