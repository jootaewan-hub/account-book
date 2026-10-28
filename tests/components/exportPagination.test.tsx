// @vitest-environment jsdom
import type { SupabaseClient } from '@supabase/supabase-js'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { cappedDatabase } from '../cappedDatabase'
import { makeLookup } from '../../src/lib/lookup'

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }))
vi.mock('../../src/lib/supabase', () => ({ sb: () => state.client }))
const { ExportCard } = await import('../../src/components/ExportCard')
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('CSV 전체 다운로드는 서버 행 제한을 넘어 모든 행과 마지막 내역을 포함한다', async () => {
  state.client = cappedDatabase(1205, 200).client
  let exported: File | undefined
  let message = ''
  vi.stubGlobal('navigator', { canShare: () => true, share: async ({ files }: { files: File[] }) => { exported = files[0] } })
  render(<ExportCard householdId="home" today="2026-10-28" lookup={makeLookup('me', [], [], [])} toast={(s) => { message = s }} />)
  fireEvent.change(screen.getByRole('combobox', { name: '내보낼 기간' }), { target: { value: 'all' } })
  fireEvent.click(screen.getByRole('button', { name: 'CSV 파일로 받기' }))
  await waitFor(() => expect(message).toBe('1205건을 내보냈어요'))
  expect(exported).toBeTruthy()
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(exported!)
  })
  expect(text.trim().split('\n')).toHaveLength(1206)
  expect(text).toContain('물건 1205')
})
