-- 일정이 누구 것인지(D-044): 함께(우리 둘)·남편·아내(가계부 내역의 scope와 같은 값, 자녀도 받는다). 이 칸 전의 일정은 함께.
-- 표 권한은 표 단위(20261015150000_events)라 새 칸에 따로 grant할 것이 없다.
alter table public.events
  add column scope text not null default 'shared' check (scope in ('shared', 'husband', 'wife', 'child'));
