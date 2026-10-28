-- 같은 날짜·생성 시각의 내역도 ID로 순서를 고정해 CSV 페이지 경계의 중복·누락을 막는다.
-- 반환 칸·토큰 확인·서비스 롤 전용 권한은 그대로 둔다.
create or replace function public.export_rows_v2(p_token text)
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
  order by t.occurred_on, t.created_at, t.id;
$$;
revoke execute on function public.export_rows_v2(text) from public, anon, authenticated;
grant execute on function public.export_rows_v2(text) to service_role;
