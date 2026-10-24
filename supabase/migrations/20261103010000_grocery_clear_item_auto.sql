-- 옛 자동 맞춤 지우기(D-026, 설계 docs/superpowers/specs/2026-10-23-product-match-design.md). grocery 스키마만 바꾼다(D-003).
-- 20261103000000_grocery_product_facts.sql에서 나눴다(2026-10-24): Supabase MCP의 apply_migration·execute_sql이 delete가 든 문장마다
-- 사용자 확인 단계에서 "Invalid or expired requestState"로 실패해 앞 파일만 먼저 적용했다. 이 함수가 없는 동안 food-info는 지우기를 건너뛴다(PGRST202).
--
-- 새 맞춤으로도 맞는 것이 없을 때 이전 버전이 자동으로 맞춘 줄을 남기지 않는다(된장의 "취나물_된장" 같은 것).
--    사람이 고른 줄(chosen_by 있음)과 auto 표시가 없는 줄은 건드리지 않는다. 버전은 nutrition·details jsonb의 v(없으면 1). 서비스 롤만 부른다.
create function grocery.clear_item_auto(p_item uuid, p_version int)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  it record;
begin
  select household_id, grocery.name_key(name, spec) as k into it from grocery.items where id = p_item;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  delete from grocery.item_nutrition n
   where n.household_id = it.household_id and n.name_key = it.k and n.chosen_by is null
     and coalesce((n.nutrition ->> 'auto')::boolean, false)
     and coalesce((n.nutrition ->> 'v')::int, 1) < p_version;
  delete from grocery.item_ingredients g
   where g.household_id = it.household_id and g.name_key = it.k and g.chosen_by is null
     and coalesce((g.details ->> 'auto')::boolean, false)
     and coalesce((g.details ->> 'v')::int, 1) < p_version;
end;
$$;
revoke execute on function grocery.clear_item_auto(uuid, int) from public, anon, authenticated;
grant execute on function grocery.clear_item_auto(uuid, int) to service_role;
