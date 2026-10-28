-- 알아보기 가격 비교의 몰 검색(D-036): 마켓컬리·다이소 검색 결과를 출처·검색어·한국 날짜마다 하루 둔다(같은 출처·같은 날은 캐시).
-- 출처마다 전역 간격 자리(fetch_gate 'kurly-search'·'daiso-search')도 넣는다(줄이 없으면 reserve_fetch가 -1을 돌려 늘 바쁨이 된다).
-- grocery 스키마만 바꾼다(D-003). 읽고 쓰는 것은 explore-price 함수(서비스 롤)뿐이라 사용자 권한·정책은 두지 않는다.
create table grocery.explore_shop_searches (
  source text not null check (source in ('kurly', 'daiso')),
  query_key text not null check (char_length(query_key) between 2 and 60), -- 소문자·공백 정리한 검색어
  searched_on date not null, -- 한국 날짜
  query text not null,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  found_at timestamptz not null default now(),
  primary key (source, query_key, searched_on)
);

alter table grocery.explore_shop_searches enable row level security;
revoke all on grocery.explore_shop_searches from public, anon, authenticated;
grant select, insert, update, delete on grocery.explore_shop_searches to service_role;

insert into grocery.fetch_gate (key, next_at) values ('kurly-search', '-infinity'), ('daiso-search', '-infinity')
on conflict (key) do nothing;
