-- 용도(누구를 위한 지출)와 결제수단 주인을 사람 id 대신 남편/아내/공동으로 단순화한다.
-- 배우자가 아직 가입하지 않아도 "아내" 지출, "아내 카드"를 기록할 수 있게 하기 위함.

-- 멤버마다 남편/아내 역할
alter table public.members
  add column spouse_role text check (spouse_role in ('husband', 'wife'));
alter table public.members
  add constraint members_household_spouse_role_key unique (household_id, spouse_role);
grant update (spouse_role) on public.members to authenticated;  -- 본인 행만 (members_update_self)

comment on column public.households.share_ratio is '공동 지출 중 남편이 부담하는 비율 (나머지는 아내)';

-- 내역: scope = shared | husband | wife
alter table public.transactions drop column scope_user_id;  -- 관련 check·FK·인덱스도 함께 삭제됨
alter table public.transactions drop constraint transactions_scope_check;
update public.transactions set scope = 'shared' where scope not in ('shared', 'husband', 'wife');
alter table public.transactions
  add constraint transactions_scope_check check (scope in ('shared', 'husband', 'wife'));

-- 결제수단: owner = husband | wife | shared | entered_by(입력한 사람)
alter table public.payment_methods add column owner text;
update public.payment_methods pm
set owner = case pm.owner_type
  when 'shared' then 'shared'
  when 'entered_by' then 'entered_by'
  else coalesce((select m.spouse_role from public.members m where m.user_id = pm.owner_user_id), 'entered_by')
end;
alter table public.payment_methods alter column owner set not null;
alter table public.payment_methods
  add constraint payment_methods_owner_check check (owner in ('husband', 'wife', 'shared', 'entered_by'));
alter table public.payment_methods drop column owner_user_id, drop column owner_type;
create index payment_methods_household_idx on public.payment_methods (household_id);

-- 가구 만들기: 만드는 사람이 남편/아내를 고른다
drop function public.create_household(text);
create function public.create_household(p_display_name text, p_spouse_role text)
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
                    '관리비','구독','의료','문화','쇼핑','경조사','기타']) with ordinality as t(n, o);
  insert into public.categories (household_id, type, name, sort)
  select hh, 'income', n, o::int
  from unnest(array['월급','부수입','용돈','기타']) with ordinality as t(n, o);

  insert into public.payment_methods (household_id, name, kind, owner, sort) values
    (hh, '생활비 통장', 'account', 'shared', 1),
    (hh, '현금', 'cash', 'entered_by', 2);

  return hh;
end;
$$;

-- 참여: 만든 사람의 반대 역할을 자동으로 받는다
create or replace function public.join_household(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  hh uuid;
  other_role text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if exists (select 1 from public.members where user_id = uid) then
    raise exception 'already_in_household' using errcode = 'P0001';
  end if;

  select id into hh from public.households
  where invite_code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'))
  for update;
  if hh is null then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  if (select count(*) from public.members where household_id = hh) >= 2 then
    raise exception 'household_full' using errcode = 'P0001';
  end if;

  select spouse_role into other_role from public.members where household_id = hh limit 1;
  insert into public.members (household_id, user_id, display_name, role, spouse_role)
    values (hh, uid, btrim(p_display_name), 'partner',
            case other_role when 'husband' then 'wife' when 'wife' then 'husband' end);
  return hh;
end;
$$;

revoke execute on function public.create_household(text, text) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
revoke execute on function public.join_household(text, text) from public, anon;
grant execute on function public.join_household(text, text) to authenticated;
