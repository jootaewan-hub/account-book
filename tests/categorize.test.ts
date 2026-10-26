import { describe, expect, it } from 'vitest'
import { normMerchant, storeOfTx, suggestCategory, suggestCategoryNames } from '../src/lib/categorize'
import type { Category, TxItem } from '../src/lib/types'

const NAMES = ['식비', '외식', '카페', '배달', '장보기', '주방용품', '욕실·청소', '세제·소모품', '수납·정리', '가전·전자', '가구·인테리어', '생활용품',
  '뷰티·화장품', '의류·잡화', '쇼핑', '교통', '차량·주유', '통신', '관리비', '월세·주거', '대출이자', '보험', '세금·수수료', '구독', '의료', '건강·운동',
  '교육', '자녀', '문화', '여행·숙박', '선물·용돈', '경조사', '기타']
const CATS: Category[] = NAMES.map((name, i) => ({ id: `c${i}`, household_id: 'h', type: 'expense', name, sort: i + 1, archived: false }))
const pick = (text: string) => suggestCategory(text, CATS)?.name ?? null

describe('분류 제안', () => {
  it('실제 내역 이름을 세부 분류로 나눈다', () => {
    expect(pick('이클립스 뱀부타월 250g 5매 아이보리')).toBe('욕실·청소')
    expect(pick('자동센서 쓰레기통 냄새차단 10리터')).toBe('욕실·청소')
    expect(pick('12시간마다 자동살균 센서휴지통 20L')).toBe('욕실·청소') // 휴지(세제) 아님
    expect(pick('크리넥스 휴지 30롤')).toBe('세제·소모품')
    expect(pick('독일 세탁세제 1.5L (제로 세탁)')).toBe('세제·소모품')
    expect(pick('베베앙 프리미엄 엠보싱 물티슈 캡형 70매 20팩')).toBe('세제·소모품')
    expect(pick('아이리스 코리아 리빙박스 플라스틱 옷장 팬츠')).toBe('수납·정리')
    expect(pick('투명 서랍식 냉장고 계란보관함 에그트레이')).toBe('수납·정리')
    expect(pick('EFM 유무선공유기 AX3000급 iptime')).toBe('가전·전자')
    expect(pick('LED 알루미늄 고용량 4구 누전차단 멀티탭')).toBe('가전·전자')
    expect(pick('(주)신세계까사')).toBe('가구·인테리어')
    expect(pick('에스트라 아토베리어365 젠틀 포밍클렌저')).toBe('뷰티·화장품')
    expect(pick('세균없는 스텐도마 (국산 포스코 스텐 도마)')).toBe('주방용품')
    expect(pick('싱크대 안전중식도 칼정리함 칼블럭 가위걸이')).toBe('주방용품') // 중식(외식) 아님
    expect(pick('독일 식기세척기세제 미니 50개입 6인용')).toBe('세제·소모품') // 일식(외식) 아님
    expect(pick('독일 주방세제 500ml 맨손 세제')).toBe('세제·소모품') // 주방(주방용품)보다 세제
    expect(pick('연마제 없는 올스텐 접시 꽂이+그릇 꽂이 정리대 세트')).toBe('주방용품')
    expect(pick('대출이자')).toBe('대출이자')
    expect(pick('이마트에브리데이')).toBe('장보기')
    expect(pick('씨유 분당상록마을점')).toBe('식비')
    expect(pick('광동반점')).toBe('외식')
    expect(pick('벽제 설렁탕')).toBe('외식')
  })

  it('넓은 말보다 구체적인 말이 먼저다', () => {
    expect(pick('아이스크림 할인점')).toBe('식비') // 크림(뷰티) 아님
    expect(pick('원목 책상')).toBe('가구·인테리어') // 책(문화) 아님
    expect(pick('KTX 서울-부산')).toBe('교통') // kt(통신) 아님
    expect(pick('배달의민족 BBQ치킨')).toBe('배달') // 외식보다 배달
    expect(pick('스타벅스 아이스아메리카노 빵')).toBe('카페') // 식비보다 카페
    expect(pick('전기요금')).toBe('관리비') // 전기(가전) 아님
  })

  it('모르는 이름은 null, 수입은 제안하지 않고, 가구에 없는 분류는 건너뛴다', () => {
    expect(pick('홍길동')).toBeNull()
    expect(pick('')).toBeNull()
    expect(suggestCategory('대출이자', CATS, 'income')).toBeNull()
    const without = CATS.filter((c) => c.name !== '배달')
    expect(suggestCategory('배달의민족 BBQ치킨', without)?.name).toBe('외식') // 배달이 없으면 다음 규칙(치킨 → 외식)
    expect(suggestCategoryNames('배달의민족 BBQ치킨')).toEqual(['배달', '외식'])
  })
})

describe('가게 이름', () => {
  it('법인 표기와 지점 이름을 뺀다', () => {
    expect(normMerchant('(주)신세계까사')).toBe('신세계까사')
    expect(normMerchant('씨유 분당상록마을점')).toBe('씨유')
    expect(normMerchant('이마트에브리데이')).toBe('이마트에브리데이')
    expect(normMerchant('벽제 설렁탕')).toBe('벽제 설렁탕')
    expect(normMerchant('  광동반점 ')).toBe('광동반점')
  })
})

describe('어디서 샀나의 가게 이름 (D-031 보충)', () => {
  const item = (name: string): TxItem => ({ id: 'i', name, quantity: 1, unit_price: null, amount: 1000, pack_size: null, pack_unit: null, image_path: null, sort: 1 })
  it('매장 영수증·카드 문자는 내역 이름이 가게, 상품별로 나눈 줄·배송비 줄·빈 이름은 가게가 아니다', () => {
    expect(storeOfTx({ title: '이마트 분당점', items: [item('서울우유 900ml'), item('대파')] })).toBe('이마트')
    expect(storeOfTx({ title: 'GS칼텍스 분당주유소', items: [] })).toBe('GS칼텍스 분당주유소')
    expect(storeOfTx({ title: '스타벅스' })).toBe('스타벅스')
    expect(storeOfTx({ title: '홍시 (4~6입/팩)', items: [item('홍시 (4~6입/팩)')] })).toBeNull()
    // 60자로 자른 내역 이름도 상품명의 앞부분이면 같은 줄로 본다
    expect(storeOfTx({ title: '풀무원 저당 오리엔탈', items: [item('풀무원 저당 오리엔탈 드레싱 245g')] })).toBeNull()
    expect(storeOfTx({ title: '배송비', items: [] })).toBeNull()
    expect(storeOfTx({ title: '  ', items: [] })).toBeNull()
    // 저장할 때 남긴 가게 이름(D-032)이 있으면 상품명 줄도 그 가게다
    expect(storeOfTx({ title: '홍시 (4~6입/팩)', items: [item('홍시 (4~6입/팩)')], merchant: '이마트 분당점' })).toBe('이마트')
    expect(storeOfTx({ title: '이마트 분당점', items: [], merchant: '  ' })).toBe('이마트')
  })
})
