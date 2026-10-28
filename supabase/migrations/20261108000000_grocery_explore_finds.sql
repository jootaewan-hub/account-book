-- 알아보기 가격 비교의 오늘의집·번개장터·당근(D-036 보충): 검색 결과를 출처·범위(당근은 동네 이름, 그 밖은 '')·검색어·한국 날짜마다 하루 둔다.
-- 출처마다 전역 간격 자리(fetch_gate)도 넣는다(줄이 없으면 reserve_fetch가 -1을 돌려 늘 바쁨이 된다).
-- grocery 스키마만 바꾼다(D-003). 읽고 쓰는 것은 explore-price 함수(서비스 롤)뿐이라 사용자 권한·정책은 두지 않는다.
-- 컬리·다이소는 explore_shop_searches를 그대로 쓴다(그 표의 출처 check를 바꾸지 않으려고 표를 나눴다).
create table grocery.explore_finds (
  source text not null check (source in ('ohou', 'bunjang', 'daangn')),
  scope text not null default '' check (char_length(scope) <= 20),
  query_key text not null check (char_length(query_key) between 2 and 60), -- 소문자·공백 정리한 검색어
  searched_on date not null, -- 한국 날짜
  query text not null,
  region text, -- 당근: 찾은 동네 전체 이름(예: 경기도 성남시 중원구 여수동)
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  found_at timestamptz not null default now(),
  primary key (source, scope, query_key, searched_on)
);

alter table grocery.explore_finds enable row level security;
revoke all on grocery.explore_finds from public, anon, authenticated;
grant select, insert, update, delete on grocery.explore_finds to service_role;

insert into grocery.fetch_gate (key, next_at) values ('ohou-search', '-infinity'), ('bunjang-search', '-infinity'), ('daangn-search', '-infinity')
on conflict (key) do nothing;
