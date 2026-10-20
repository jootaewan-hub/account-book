-- 대안 탭의 후보 대조(D-016, 2026-10-20): 품목의 다나와 후보 상품명을 식약처 기록(회수·검사부적합·해외직구)과 이름 단어로 대조한다.
-- 규칙은 품목 대조 _alert_hits(20261020010000)와 같다: 단어는 name_tokens(20261024000000), 겹치는 단어가 절반 넘게, 농가 단위 부적합은 뺀다.
-- 화면은 기록이 있는 후보를 빼지 않고 표시를 붙여 뒤로 보낸다. security invoker라 RLS로 내 가구 품목의 후보만 보인다. grocery 스키마만(D-003).
create function grocery.candidate_alerts(p_item uuid)
returns table (product_id uuid, source text, source_id text, product_name text, maker text, registered_on date)
language sql
stable
security invoker
set search_path = ''
as $$
  with toks as materialized (
    select c.product_id, grocery.name_tokens(p.name) as tokens
      from grocery.item_candidates c
      join grocery.products p on p.id = c.product_id
     where c.item_id = p_item
     group by c.product_id, p.name
  ),
  cand as materialized (
    select a.source, a.source_id, a.product_name, a.maker, a.registered_on,
           regexp_replace(lower(a.product_name), '[^가-힣a-z0-9]', '', 'g') as pn,
           regexp_replace(lower(coalesce(a.maker, '')), '[^가-힣a-z0-9]', '', 'g') as mk
      from grocery.food_alerts a
     where ((a.source in ('I0490', 'I2620') and (a.registered_on is null or a.registered_on >= current_date - 365))
         or (a.source = 'I2715' and (a.ends_on is null or a.ends_on >= current_date)))
       and not (a.source = 'I2620' and coalesce(a.maker, '') ~ '\*|미상|불가|불명')
  )
  select distinct on (t.product_id, c.source, c.source_id)
         t.product_id, c.source, c.source_id, c.product_name, c.maker, c.registered_on
    from toks t
    join cand c
      on cardinality(t.tokens) > 0
     and exists (select 1 from unnest(t.tokens) k where strpos(c.pn, k) > 0)
     and (select count(*) from unnest(t.tokens) k where strpos(c.pn, k) > 0 or strpos(c.mk, k) > 0) * 2 > cardinality(t.tokens)
   order by t.product_id, c.source, c.source_id
$$;
revoke execute on function grocery.candidate_alerts(uuid) from public, anon;
grant execute on function grocery.candidate_alerts(uuid) to authenticated;
