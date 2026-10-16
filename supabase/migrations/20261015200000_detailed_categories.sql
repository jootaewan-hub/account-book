-- 분류를 세분한다. '생활용품'에 몰리던 것을 주방·욕실·세제·수납·가전·가구·뷰티·의류로 나누고,
-- 배달·차량·주거·세금·교육·건강·여행·선물을 더한다. 이름으로 분류를 제안하는 규칙(src/lib/categorize.ts)과 이름을 맞춘다.
-- 이미 있는 가구에는 없는 분류만 넣고, 순서(sort)는 전부 새 순서로 맞춘다. 사용자가 만든 다른 분류는 그대로 둔다.
-- (CTE 안의 insert 결과는 바깥 update에 보이지 않지만, 새로 넣은 행은 이미 새 순서라 update는 원래 있던 행만 맞추면 된다)
with new_categories(type, name, sort) as (values
  ('expense', '식비', 1), ('expense', '외식', 2), ('expense', '카페', 3), ('expense', '배달', 4), ('expense', '장보기', 5),
  ('expense', '주방용품', 6), ('expense', '욕실·청소', 7), ('expense', '세제·소모품', 8), ('expense', '수납·정리', 9),
  ('expense', '가전·전자', 10), ('expense', '가구·인테리어', 11), ('expense', '생활용품', 12),
  ('expense', '뷰티·화장품', 13), ('expense', '의류·잡화', 14), ('expense', '쇼핑', 15),
  ('expense', '교통', 16), ('expense', '차량·주유', 17), ('expense', '통신', 18),
  ('expense', '관리비', 19), ('expense', '월세·주거', 20), ('expense', '대출이자', 21), ('expense', '보험', 22), ('expense', '세금·수수료', 23),
  ('expense', '구독', 24), ('expense', '의료', 25), ('expense', '건강·운동', 26), ('expense', '교육', 27), ('expense', '자녀', 28),
  ('expense', '문화', 29), ('expense', '여행·숙박', 30), ('expense', '선물·용돈', 31), ('expense', '경조사', 32), ('expense', '기타', 33),
  ('income', '월급', 1), ('income', '부수입', 2), ('income', '용돈', 3), ('income', '이자·배당', 4), ('income', '환급·캐시백', 5), ('income', '기타', 6)
), added as (
  insert into public.categories (household_id, type, name, sort)
  select h.id, n.type, n.name, n.sort from public.households h cross join new_categories n
  on conflict (household_id, type, name) do nothing
  returning id
)
update public.categories c set sort = n.sort
from new_categories n where c.type = n.type and c.name = n.name;

-- 새로 만드는 가구의 기본 분류도 같은 목록으로
create or replace function public.create_household(p_display_name text, p_spouse_role text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  hh uuid;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_spouse_role is null or p_spouse_role not in ('husband', 'wife') then
    raise exception 'invalid_role' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.members where user_id = uid) then
    raise exception 'already_in_household' using errcode = 'P0001';
  end if;

  insert into public.households default values returning id into hh;
  insert into public.members (household_id, user_id, display_name, role, spouse_role)
    values (hh, uid, btrim(p_display_name), 'owner', p_spouse_role);

  insert into public.categories (household_id, type, name, sort)
  select hh, 'expense', n, o::int
  from unnest(array['식비','외식','카페','배달','장보기',
                    '주방용품','욕실·청소','세제·소모품','수납·정리','가전·전자','가구·인테리어','생활용품',
                    '뷰티·화장품','의류·잡화','쇼핑',
                    '교통','차량·주유','통신',
                    '관리비','월세·주거','대출이자','보험','세금·수수료',
                    '구독','의료','건강·운동','교육','자녀',
                    '문화','여행·숙박','선물·용돈','경조사','기타']) with ordinality as t(n, o);
  insert into public.categories (household_id, type, name, sort)
  select hh, 'income', n, o::int
  from unnest(array['월급','부수입','용돈','이자·배당','환급·캐시백','기타']) with ordinality as t(n, o);

  insert into public.payment_methods (household_id, name, kind, owner, sort) values
    (hh, '생활비 통장', 'account', 'shared', 1),
    (hh, '현금', 'cash', 'entered_by', 2);

  return hh;
end;
$$;
