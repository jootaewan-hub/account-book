-- 일정의 기간·중요도(D-054).
-- end_on: 여러 날 이어지는 일정의 끝나는 날(그날 포함). 하루 일정은 null. 시작보다 앞일 수 없고 1년(366일)을 넘지 않는다
--         (끝 날짜를 잘못 적어 달력 칸마다 이름이 깔리는 것을 막는다).
-- priority: 보통(normal)·중요(high)·꼭(must). effect: 중요·꼭 일정을 달력에서 구별하는 표시(테두리·채움·숨쉬기·점과 별·굵은 글자).
--           두 칸 모두 일정마다 두어 배우자 화면에도 같게 보인다. 보통 일정은 effect를 쓰지 않는다.
-- 이 칸 전의 일정과 사진·문자로 넣는 일정(extract-entries의 event 경로)은 기본값(하루, 보통, 테두리)이다.
-- 표 권한은 표 단위(20261015150000_events)라 새 칸에 따로 grant할 것이 없다.
alter table public.events
  add column end_on date,
  add column priority text not null default 'normal' check (priority in ('normal', 'high', 'must')),
  add column effect text not null default 'outline' check (effect in ('outline', 'fill', 'breathe', 'mark', 'bold')),
  add constraint events_range_check check (end_on is null or (end_on >= date and end_on <= date + 366));
