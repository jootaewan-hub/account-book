# 이 프로젝트에서 새로 씀(D-034 보충): 소비자24(공정거래위원회) 리콜정보 공개 목록·상세 화면을 키 없이 읽는다.
# 원본 consumer-price-safety-search는 초안이라 실행할 것이 없었다. robots는 recallInfo 경로를 막지 않는다
# (막는 것은 /ftc/, goodsinfo 목록·상세 등). 표준 라이브러리만 쓴다. 여러 분류를 볼 때는 1초씩 쉬어 부른다.
# 사용: python3 -I consumer_recall.py categories
#       python3 -I consumer_recall.py search --keyword 가습기 [--category 공산품] [--from 2026-01-01] [--to 2026-10-28] [--limit 10]
#       python3 -I consumer_recall.py detail RCLL_000000000607751 [--category 공산품]
import argparse
import datetime as dt
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request

BASE = 'https://www.consumer.go.kr/user/ftc/consumer/recallInfo'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36'
# 분류 이름: (searchCondition1, 메뉴 번호) — 2026-10-28 화면 스크립트(setConditionVal)와 사이트맵에서 옮김.
# 식품 메뉴(622)는 0201이 식품(398건), 0202가 건강기능식품(37건)이었다(2026-10-28 조회, 0202 이름은 화면 스크립트 주석과 표본으로 본 것).
# 어린이용품(0404, 메뉴 966)은 같은 날 "메시지 페이지"만 와서 뺐다. 완구 리콜은 공산품에 있다
CATEGORIES = {
    '공산품': ('0101', '621'), '식품': ('0201', '622'), '건강기능식품': ('0202', '622'), '축산물': ('0203', '623'), '의약품': ('0204', '624'),
    '의약외품': ('0205', '625'), '의료기기': ('0207', '626'), '화장품': ('0206', '627'), '생활화학제품': ('0401', '628'),
    '자동차': ('0301', '629'), '먹는물': ('0403', '630'), '위생용품': ('0208', '781'), '생활방사선제품': ('0405', '1020'),
}
KV = re.compile(r'<strong class="key">(.*?)</strong>\s*<span class="value">(.*?)</span>', re.S)


def text(s: str) -> str:
    return html.unescape(re.sub(r'\s+', ' ', re.sub(r'<br\s*/?>', ' ', re.sub(r'<[^>]+>', ' ', s)))).strip()


def post(url: str, form: dict) -> str:
    req = urllib.request.Request(url, data=urllib.parse.urlencode(form).encode(), method='POST',
                                 headers={'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', 'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(req, timeout=25) as resp:
        return resp.read().decode('utf-8', errors='replace')


def date_arg(s: str) -> str:
    dt.date.fromisoformat(s)
    return s


def search_one(name: str, keyword: str, fr: str, to: str, page: int, limit: int) -> dict:
    code, menu = CATEGORIES[name]
    url = f'{BASE}/{menu}/selectRecallInfoInternalList.do'
    page_html = post(url, {'page': page, 'row': limit, 'recallSn': '', 'searchCondition1': code, 'searchCondition2': keyword,
                           'searchCondition3Fr': fr, 'searchCondition3To': to, 'searchCondition4': '', 'imgFlag': ''})
    total = re.search(r'전체 <span class="textPrimary">([0-9,]+)</span>', page_html)
    items = []
    for block in page_html.split('<li class="structured-item">')[1:]:
        sn = re.search(r"fnDetail\('(RCLL_\d+)'\)", block)
        title = re.search(r'<p class="c-tit">\s*<span class="span">(.*?)</span>', block, re.S)
        if not sn or not title:
            continue
        fields = {text(k): text(v) for k, v in KV.findall(block)}
        items.append({'recallSn': sn.group(1), 'category': name, 'title': text(title.group(1)), **fields})
    if total is None and 'structured-item' not in page_html and '검색 결과가 없' not in page_html and '등록된 데이터가 없' not in page_html:
        raise SystemExit(f'{name}: 목록 모양을 읽지 못함(화면이 바뀌었을 수 있다)')
    return {'category': name, 'source_url': url, 'total': int(total.group(1).replace(',', '')) if total else 0, 'items': items}


def detail(sn: str, name: str) -> dict:
    code, menu = CATEGORIES[name]
    url = f'{BASE}/{menu}/selectRecallInfoInternalDetail.do'
    page_html = post(url, {'recallSn': sn, 'searchCondition1': code, 'page': 1, 'row': 10})
    start, end = page_html.find('class="productDesc"'), page_html.find('krds-tab-area')
    if start < 0 or end < start:
        raise SystemExit('상세 모양을 읽지 못함(없는 번호이거나 화면이 바뀌었다)')
    body = page_html[start:end]
    name_m = re.search(r'<h4 class="productName">(.*?)</h4>', body, re.S)
    fields = {}
    for k, v in KV.findall(body):
        fields[text(k)] = text(v)
    return {'recallSn': sn, 'productName': text(name_m.group(1)) if name_m else None, 'fields': fields,
            'page_url': f'{BASE}/{menu}/selectRecallInfoInternalDetail.do?recallSn={sn}'}


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('categories')
    s = sub.add_parser('search')
    s.add_argument('--keyword', default='')
    s.add_argument('--category', default='all', help='분류 이름 또는 all(쉼표로 여러 개)')
    s.add_argument('--from', dest='fr', type=date_arg)
    s.add_argument('--to', type=date_arg)
    s.add_argument('--page', type=int, default=1)
    s.add_argument('--limit', type=int, default=10)
    d = sub.add_parser('detail')
    d.add_argument('recall_sn')
    d.add_argument('--category', default='공산품')
    a = ap.parse_args()
    checked_at = dt.datetime.now().astimezone().isoformat(timespec='seconds')

    if a.cmd == 'categories':
        print(json.dumps(list(CATEGORIES), ensure_ascii=False))
        return
    if a.cmd == 'detail':
        if not re.fullmatch(r'RCLL_\d{6,20}', a.recall_sn):
            raise SystemExit('recallSn은 RCLL_숫자 모양만')
        if a.category not in CATEGORIES:
            raise SystemExit(f'분류는 {", ".join(CATEGORIES)} 중 하나')
        out = detail(a.recall_sn, a.category)
        print(json.dumps({'source': '소비자24 리콜정보', 'checked_at': checked_at, **out}, ensure_ascii=False, indent=2))
        return
    names = list(CATEGORIES) if a.category == 'all' else [c.strip() for c in a.category.split(',')]
    bad = [c for c in names if c not in CATEGORIES]
    if bad:
        raise SystemExit(f'모르는 분류 {bad}. 분류는 {", ".join(CATEGORIES)}')
    limit = min(50, max(1, a.limit))
    results = []
    for i, name in enumerate(names):
        if i:
            time.sleep(1)
        results.append(search_one(name, a.keyword.strip(), a.fr or '', a.to or '', max(1, a.page), limit))
    print(json.dumps({'source': '소비자24 리콜정보', 'checked_at': checked_at, 'keyword': a.keyword.strip(),
                      'results': [r for r in results if r['total'] or r['items']] if a.category == 'all' else results}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except urllib.error.URLError as e:
        sys.exit(f'소비자24 호출 실패: {e}')
