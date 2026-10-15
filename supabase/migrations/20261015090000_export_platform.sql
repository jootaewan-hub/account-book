-- 구글 시트 내보내기에 플랫폼 칸과 품목의 개당·단위당 가격을 더한다.
-- 수량 10이 'x1'로 찍히던 문제도 고친다(정수 끝의 0을 지우던 것).
-- 반환 칸이 달라 기존 export_rows를 고칠 수 없으므로 export_rows_v2를 새로 만들고 export-csv가 이것을 부른다.
-- 기존 export_rows는 더 이상 쓰지 않는다(service role 전용이라 남아 있어도 밖에서 부를 수 없다).

-- 숫자를 사람이 읽는 글자로: 2 → '2', 2.50 → '2.5' (정수 끝의 0은 지우지 않는다)
create function private.num_text(n numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when n::text like '%.%' then rtrim(rtrim(n::text, '0'), '.') else n::text end;
$$;
revoke execute on function private.num_text(numeric) from public;

-- 내보내기: 플랫폼 칸을 더하고, 품목에 개당 가격·단위당 가격을 적는다
create function public.export_rows_v2(p_token text)
returns table (
  occurred_on date, occurred_at time, type text, amount bigint, title text, platform text, category text,
  scope text, source text, entered_by text, memo text, items text
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.occurred_on, t.occurred_at, t.type, t.amount, t.title, t.platform, c.name, t.scope, t.source,
    coalesce(case m.spouse_role when 'husband' then '남편' when 'wife' then '아내' end, m.display_name),
    t.memo,
    (select string_agg(
        i.name
        || case when i.quantity <> 1 then ' x' || private.num_text(i.quantity) else '' end
        || ' ' || i.amount
        || case when i.unit_price is not null and i.quantity <> 1 then ' (개당 ' || i.unit_price || ')' else '' end
        || case when i.pack_size > 0 and i.amount > 0 then
             ' (' || case when i.pack_unit in ('g', 'ml') then '100' || i.pack_unit else '1' || i.pack_unit end || '당 '
             || (select private.num_text(case when x >= 100 then round(x) else round(x, 1) end)
                 from (select i.amount / (i.quantity * i.pack_size)
                         * case when i.pack_unit in ('g', 'ml') then 100 else 1 end as x) u) || ')'
           else '' end,
        ', ' order by i.sort)
     from public.transaction_items i where i.transaction_id = t.id)
  from private.export_tokens e
  join public.transactions t on t.household_id = e.household_id
  left join public.categories c on c.id = t.category_id
  left join public.members m on m.household_id = t.household_id and m.user_id = t.created_by
  where e.token = p_token and char_length(p_token) >= 48
  order by t.occurred_on, t.created_at;
$$;
revoke execute on function public.export_rows_v2(text) from public, anon, authenticated;
grant execute on function public.export_rows_v2(text) to service_role;
