-- 5단계: '자녀'를 누구를 위한 지출(용도)과 분류 양쪽에 추가한다.

-- 용도: 공동 / 남편 / 아내 / 자녀
alter table public.transactions drop constraint transactions_scope_check;
alter table public.transactions
  add constraint transactions_scope_check check (scope in ('shared', 'husband', 'wife', 'child'));
alter table public.recurring drop constraint recurring_scope_check;
alter table public.recurring
  add constraint recurring_scope_check check (scope in ('shared', 'husband', 'wife', 'child'));

-- 분류: 이미 있는 가구에 '자녀' 지출 분류 추가
insert into public.categories (household_id, type, name, sort)
select h.id, 'expense', '자녀', 16 from public.households h
on conflict (household_id, type, name) do nothing;

-- 새로 만드는 가구의 기본 분류에도 '자녀'
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
  from unnest(array['식비','외식','카페','장보기','생활용품','교통','통신','보험',
                    '관리비','구독','의료','문화','쇼핑','경조사','자녀','기타']) with ordinality as t(n, o);
  insert into public.categories (household_id, type, name, sort)
  select hh, 'income', n, o::int
  from unnest(array['월급','부수입','용돈','기타']) with ordinality as t(n, o);

  insert into public.payment_methods (household_id, name, kind, owner, sort) values
    (hh, '생활비 통장', 'account', 'shared', 1),
    (hh, '현금', 'cash', 'entered_by', 2);

  return hh;
end;
$$;
