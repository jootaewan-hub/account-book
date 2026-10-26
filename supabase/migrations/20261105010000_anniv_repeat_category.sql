-- 기념일 반복·카테고리(D-033).
-- 1) 반복: 해마다만 있던 것을 'N개월마다'·'N년마다'로. 기준은 start_year년 month월 day일이고, 매달 반복의 day는 시작 달 기준
--    (기존 day 검사가 month로 날 수를 본다). 해마다(1년)는 시작 해 없이도 되고, 그 밖은 시작 해가 있어야 한다. 매달 반복은 양력만.
-- 2) 카테고리: 고정 종류(생일·우리 둘·추모·그 밖) 대신 사람이 적는 말. kind 칸과 그 검사는 옛 화면을 위해 그대로 두고,
--    앱이 카테고리 말로 kind를 정해 쓴다(아이콘·색). 기존 행은 kind로 카테고리를 채운다: 생일 → 생일, 우리 둘 → 기념일, 추모 → 추모, 그 밖 → 없음.
alter table public.anniversaries
  add column category text check (category is null or char_length(btrim(category)) between 1 and 12),
  add column repeat_unit text not null default 'year' check (repeat_unit in ('month', 'year')),
  add column repeat_every smallint not null default 1 check (repeat_every between 1 and 100),
  add column start_year smallint check (start_year between 1900 and 2200);

alter table public.anniversaries add constraint anniversaries_repeat_check check (
  (repeat_unit = 'year' and (repeat_every = 1 or start_year is not null))
  or (repeat_unit = 'month' and start_year is not null and not lunar)
);

update public.anniversaries
set category = case kind when 'birthday' then '생일' when 'couple' then '기념일' when 'memorial' then '추모' end
where category is null and kind in ('birthday', 'couple', 'memorial');
