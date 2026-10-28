// 알아보기 탭(D-035) 시험용 공공데이터포털 응답. 모양은 기상청 단기예보 조회서비스·에어코리아 활용가이드의 JSON 예시를 따른다(값은 시험용).
type FcstRow = [category: string, date: string, time: string, value: string]

export function kmaFcst(rows: FcstRow[], base = { date: '20261028', time: '0200' }): string {
  return JSON.stringify({
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' },
      body: {
        dataType: 'JSON',
        items: { item: rows.map(([category, fcstDate, fcstTime, fcstValue]) => ({ baseDate: base.date, baseTime: base.time, category, fcstDate, fcstTime, fcstValue, nx: 62, ny: 124 })) },
        pageNo: 1, numOfRows: 1000, totalCount: rows.length,
      },
    },
  })
}

export function kmaNcst(values: Record<string, string>, base = { date: '20261028', time: '1000' }): string {
  return JSON.stringify({
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' },
      body: { dataType: 'JSON', items: { item: Object.entries(values).map(([category, obsrValue]) => ({ baseDate: base.date, baseTime: base.time, category, nx: 62, ny: 124, obsrValue })) } },
    },
  })
}

export const FCST_ROWS: FcstRow[] = [
  ['TMN', '20261028', '0600', '6.0'], ['TMX', '20261028', '1500', '17.0'],
  ['SKY', '20261028', '0900', '1'], ['SKY', '20261028', '1200', '3'], ['SKY', '20261028', '1500', '3'],
  ['POP', '20261028', '0900', '0'], ['POP', '20261028', '1200', '20'], ['POP', '20261028', '1500', '30'],
  ['PTY', '20261028', '0900', '0'], ['PTY', '20261028', '1200', '0'], ['PTY', '20261028', '1500', '0'],
  ['TMN', '20261029', '0600', '8.0'], ['TMX', '20261029', '1500', '14.0'],
  ['SKY', '20261029', '0900', '4'], ['SKY', '20261029', '1200', '4'],
  ['POP', '20261029', '0900', '60'], ['POP', '20261029', '1200', '80'],
  ['PTY', '20261029', '0900', '1'], ['PTY', '20261029', '1200', '1'], ['PTY', '20261029', '1500', '4'],
]

export const NCST = { T1H: '12.3', REH: '55', RN1: '0', PTY: '0', WSD: '1.2' }

export const NOT_REGISTERED = JSON.stringify({
  OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', returnAuthMsg: '등록되지 않은 서비스키', returnReasonCode: '30' } },
})

export const NEARBY = JSON.stringify({
  response: { header: { resultCode: '00', resultMsg: 'NORMAL_CODE' }, body: { totalCount: 2, items: [
    { stationName: '정자동', addr: '경기 성남시 분당구 정자일로 80', tm: 1.4 },
    { stationName: '수내동', addr: '경기 성남시 분당구 수내로', tm: 2.9 },
  ], pageNo: 1, numOfRows: 10 } },
})

export function measure(over: Record<string, string> = {}): string {
  return JSON.stringify({
    response: { header: { resultCode: '00', resultMsg: 'NORMAL_CODE' }, body: { totalCount: 24, items: [{
      dataTime: '2026-10-28 11:00', pm10Value: '35', pm25Value: '18', pm10Grade1h: '2', pm25Grade1h: '2', pm10Grade: '2', pm25Grade: '1', ...over,
    }], pageNo: 1, numOfRows: 1 } },
  })
}
