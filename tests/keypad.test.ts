import { describe, expect, it } from 'vitest'
import { isSaveShortcut, isTextField, keypadKey, pressKey } from '../src/lib/keypad'

describe('금액 키패드', () => {
  it('숫자를 뒤에 붙이고, 앞의 0은 빼며, 10자리에서 멈춘다', () => {
    expect(pressKey('', '1')).toBe('1')
    expect(pressKey('1', '00')).toBe('100')
    expect(pressKey('', '0')).toBe('')
    expect(pressKey('', '00')).toBe('')
    expect(pressKey('123456789', '0')).toBe('1234567890')
    expect(pressKey('1234567890', '1')).toBe('1234567890')
    expect(pressKey('123456789', '00')).toBe('123456789')
  })
  it('⌫는 마지막 자리를 지우고, 빈 값에서는 그대로다', () => {
    expect(pressKey('2000', '⌫')).toBe('200')
    expect(pressKey('', '⌫')).toBe('')
  })
})

describe('키보드로 금액 넣기', () => {
  it('숫자 키(숫자 패드 포함)와 Backspace만 키패드 키로 바꾼다', () => {
    expect(keypadKey({ key: '7' })).toBe('7')
    expect(keypadKey({ key: '0' })).toBe('0')
    expect(keypadKey({ key: 'Backspace' })).toBe('⌫')
    expect(keypadKey({ key: 'a' })).toBeNull()
    expect(keypadKey({ key: 'Enter' })).toBeNull()
    expect(keypadKey({ key: ' ' })).toBeNull()
    expect(keypadKey({ key: 'Delete' })).toBeNull()
  })
  it('단축키(⌘R, Ctrl+1, Alt)와 한글 조합 중에는 끼어들지 않는다', () => {
    expect(keypadKey({ key: '1', metaKey: true })).toBeNull()
    expect(keypadKey({ key: '1', ctrlKey: true })).toBeNull()
    expect(keypadKey({ key: '1', altKey: true })).toBeNull()
    expect(keypadKey({ key: '1', isComposing: true })).toBeNull()
    expect(keypadKey({ key: 'Process', keyCode: 229 })).toBeNull()
    expect(keypadKey({ key: 'Backspace', keyCode: 229 })).toBeNull()
  })
  it('⌘+Enter, Ctrl+Enter는 저장이고, 그냥 Enter나 조합 중 Enter는 아니다', () => {
    expect(isSaveShortcut({ key: 'Enter', metaKey: true })).toBe(true)
    expect(isSaveShortcut({ key: 'Enter', ctrlKey: true })).toBe(true)
    expect(isSaveShortcut({ key: 'Enter' })).toBe(false)
    expect(isSaveShortcut({ key: 'Enter', metaKey: true, isComposing: true })).toBe(false)
    expect(isSaveShortcut({ key: 's', metaKey: true })).toBe(false)
  })
  it('글자 칸(입력칸, 고르기, 여러 줄, 직접 편집)에 커서가 있으면 금액으로 받지 않는다', () => {
    expect(isTextField({ tagName: 'INPUT' })).toBe(true)
    expect(isTextField({ tagName: 'SELECT' })).toBe(true)
    expect(isTextField({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTextField({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(isTextField({ tagName: 'BUTTON' })).toBe(false)
    expect(isTextField({ tagName: 'DIV' })).toBe(false)
    expect(isTextField(null)).toBe(false)
  })
})
