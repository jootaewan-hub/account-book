#!/usr/bin/env python3
# 대중교통 길찾기(ODsay searchPubTransPathT) 도움 스크립트. 이 프로젝트가 썼다(D-040, 원본 k-skill korean-transit-route 안내문을 따름).
# 원본은 비밀 파일을 셸로 실행(`. secrets.env`)하고 키를 curl 명령줄에 넣는다. 여기서는 파일을 글로만 읽고 키를 명령줄·출력에 내지 않는다.
# 표준 라이브러리만 쓴다.
#   python3 -I transit_route.py --from "정자역" --to "서울 중구 을지로 30" [--opt 0|4|5] [--type 0|1|2] [--max 3] [--json]
#   --from/--to에 "경도,위도"(예: 127.1114,37.3670)를 주면 주소→좌표 변환(제3자 프록시)을 거치지 않는다.
# 맥 기본 python3(3.9)에서도 돌게 타입 표기를 늦게 읽는다
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ODSAY = 'https://api.odsay.com/v1/api/searchPubTransPathT'
PROXY = os.environ.get('KSKILL_PROXY_BASE_URL', 'https://k-skill-proxy.nomadamas.org').rstrip('/')
SECRETS = Path.home() / '.config' / 'k-skill' / 'secrets.env'
UA = {'user-agent': 'k-skill/korean-transit-route (account-book copy)'}
COORD = re.compile(r'^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$')
OPTS = {'0': '추천순', '4': '최소시간', '5': '최소환승'}
TYPES = {'0': '지하철+버스', '1': '지하철만', '2': '버스만'}


def api_key() -> str:
    """환경변수 ODSAY_API_KEY, 없으면 ~/.config/k-skill/secrets.env의 ODSAY_API_KEY= 줄. 파일을 실행하지 않고 글로만 읽는다"""
    key = os.environ.get('ODSAY_API_KEY', '').strip()
    if not key and SECRETS.is_file():
        for line in SECRETS.read_text(encoding='utf-8').splitlines():
            m = re.match(r'^\s*(?:export\s+)?ODSAY_API_KEY\s*=\s*(.*?)\s*$', line)
            if m:
                key = m.group(1).strip().strip('"').strip("'")
    if not key:
        sys.exit('ODsay 키가 없다: https://lab.odsay.com 에서 Server 키를 받아(이 컴퓨터의 공인 IP 등록) '
                 f'{SECRETS} 에 ODSAY_API_KEY=<키> 한 줄로 넣는다(권한 600). 키를 대화에 붙여 넣지 않는다.')
    return key


def get_json(url: str, timeout: int = 15) -> dict:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


def place(text: str) -> tuple[float, float, str]:
    """'경도,위도'면 그대로, 아니면 프록시(카카오 로컬)로 좌표를 찾는다. 한국 범위 밖이면 멈춘다"""
    m = COORD.match(text)
    if m:
        x, y, name = float(m.group(1)), float(m.group(2)), f'좌표 {m.group(1)},{m.group(2)}'
    else:
        q = text.strip()[:100]
        if not q:
            sys.exit('출발지·도착지가 비었다')
        d = get_json(f'{PROXY}/v1/kakao-local/geocode?q={urllib.parse.quote(q)}', timeout=10)
        docs = d.get('documents') or []
        if not docs:
            sys.exit(f'"{q}"의 좌표를 찾지 못했다. 더 구체적인 주소·장소명이나 "경도,위도"로 다시 준다')
        doc = docs[0]
        x, y = float(doc['x']), float(doc['y'])
        name = doc.get('place_name') or doc.get('address_name') or q
    if not (124 <= x <= 132 and 33 <= y <= 39):
        hint = ' 위도,경도로 준 것 같다. 경도,위도 순서로 다시 준다' if 124 <= y <= 132 and 33 <= x <= 39 else ' 경도,위도 순서인지 확인한다'
        sys.exit(f'{name}: 한국 범위 밖 좌표({x},{y})다.{hint}')
    return x, y, name


def route(key: str, sx: float, sy: float, ex: float, ey: float, opt: str, kind: str) -> dict:
    qs = urllib.parse.urlencode({'apiKey': key, 'SX': sx, 'SY': sy, 'EX': ex, 'EY': ey, 'OPT': opt, 'SearchPathType': kind})
    try:
        return get_json(f'{ODSAY}?{qs}')
    except urllib.error.HTTPError as e:
        sys.exit(f'ODsay HTTP {e.code}')
    except urllib.error.URLError as e:
        sys.exit(f'ODsay 연결 실패: {e.reason}')


def hide(text: str, key: str) -> str:
    return text.replace(key, '***') if key else text


def step(s: dict) -> str | None:
    t, mins = s.get('trafficType'), s.get('sectionTime')
    if t == 3:
        return f'  도보 {mins}분' if mins else None
    lanes = s.get('lane') or []
    if t == 1:
        line = lanes[0].get('name', '지하철') if lanes else '지하철'
        exit_no = f', {s["endExitNo"]}번 출구' if s.get('endExitNo') else ''
        return f'  {line} {s.get("startName")} → {s.get("endName")} ({s.get("stationCount")}정거장, {mins}분{exit_no})'
    if t == 2:
        buses = ', '.join(dict.fromkeys(str(l.get('busNo')) for l in lanes if l.get('busNo'))) or '버스'
        return f'  버스 {buses}: {s.get("startName")} → {s.get("endName")} ({s.get("stationCount")}정류장, {mins}분)'
    return None


def summarize(data: dict, max_paths: int) -> list[dict]:
    out = []
    for p in (data.get('result') or {}).get('path', [])[:max_paths]:
        info = p.get('info') or {}
        out.append({
            'minutes': info.get('totalTime'),
            'fare_won': info.get('payment'),
            'transfers': max(0, (info.get('busTransitCount') or 0) + (info.get('subwayTransitCount') or 0) - 1),
            'walk_m': info.get('totalWalk'),
            'steps': [x for x in (step(s) for s in p.get('subPath') or []) if x],
        })
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description='ODsay 대중교통 길찾기(도어투도어)')
    ap.add_argument('--from', dest='src', required=True, help='출발지 주소·장소명 또는 "경도,위도"')
    ap.add_argument('--to', dest='dst', required=True, help='도착지 주소·장소명 또는 "경도,위도"')
    ap.add_argument('--opt', choices=sorted(OPTS), default='0', help='0 추천순, 4 최소시간, 5 최소환승')
    ap.add_argument('--type', dest='kind', choices=sorted(TYPES), default='0', help='0 지하철+버스, 1 지하철만, 2 버스만')
    ap.add_argument('--max', type=int, default=3, help='보일 경로 수(1~5)')
    ap.add_argument('--json', action='store_true', help='정리한 JSON으로 출력')
    a = ap.parse_args()
    key = api_key()
    sx, sy, sname = place(a.src)
    ex, ey, ename = place(a.dst)
    data = route(key, sx, sy, ex, ey, a.opt, a.kind)
    if 'error' in data:
        err = data['error']
        msg = err.get('msg') if isinstance(err, dict) else err if isinstance(err, str) else json.dumps(err, ensure_ascii=False)
        sys.exit(hide(f'ODsay 오류: {msg} (키 미등록·IP 등록 누락·하루 한도 초과일 수 있다)', key))
    paths = summarize(data, max(1, min(5, a.max)))
    if a.json:
        print(hide(json.dumps({'from': sname, 'to': ename, 'opt': OPTS[a.opt], 'type': TYPES[a.kind], 'paths': paths}, ensure_ascii=False, indent=1), key))
        return
    if not paths:
        print(f'{sname} → {ename}: 대중교통 경로 없음(가까운 거리이거나 대중교통이 없는 구간일 수 있다)')
        return
    lines = [f'{sname} → {ename} ({OPTS[a.opt]}, {TYPES[a.kind]}) · 출처 ODsay']
    for i, p in enumerate(paths, 1):
        fare = f'{p["fare_won"]:,}원' if isinstance(p['fare_won'], int) else '요금 정보 없음'
        lines.append(f'경로 {i}: {p["minutes"]}분 · {fare} · 환승 {p["transfers"]}회 · 도보 {p["walk_m"]}m')
        lines.extend(p['steps'])
    print(hide('\n'.join(lines), key))


if __name__ == '__main__':
    main()
