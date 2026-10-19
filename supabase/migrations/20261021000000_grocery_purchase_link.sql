-- 장 본 것 → 가계부 내역(D-011, 통합 설계 6-1): 장보기 품목이 어느 가계부 내역이 됐는지 남기고, 연결은 함수 두 개로 한다.
-- grocery 스키마만 바꾼다(D-003). 가계부 public 표는 참조만 하고, 가계부 내역 쓰기는 가계부 함수 public.add_transaction_with_items를 부른다.

-- 연결 칸. 같은 가구의 내역만 가리키도록 (내역 id, 가구)로 참조한다(가계부 transactions에 unique (id, household_id)가 있다).
-- 가계부에서 내역을 지우면 연결만 풀린다(D-007처럼 장보기 데이터가 가계부의 삭제를 막지 않게).
alter table grocery.items add column transaction_id uuid;
alter table grocery.items
  add constraint items_transaction_fkey foreign key (transaction_id, household_id)
    references public.transactions (id, household_id) on delete set null (transaction_id);
-- 가계부에 넣은 품목은 산 것이다(체크를 풀려면 가계부에서 내역을 먼저 지운다)
alter table grocery.items add constraint items_linked_bought check (transaction_id is null or bought_at is not null);
create index items_transaction_idx on grocery.items (transaction_id) where transaction_id is not null;

-- 연결은 아래 함수(security invoker)가 하므로 로그인 사용자에게 칸 권한을 준다.
-- 한 번 연결된 품목을 다른 내역으로 바꾸는 것은 트리거가 막는다(두 번 넣기 방지). 연결 풀기(null)는 가계부 내역 삭제로 일어난다.
grant update (transaction_id) on grocery.items to authenticated;

create function grocery.keep_purchase_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.transaction_id is not null and new.transaction_id is not null and new.transaction_id <> old.transaction_id then
    raise exception 'already_linked' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger items_keep_purchase_link
  before update of transaction_id on grocery.items
  for each row execute function grocery.keep_purchase_link();
revoke execute on function grocery.keep_purchase_link() from public, anon, authenticated;

-- 장보기 품목들을 가계부 내역 하나에 연결한다. p_links = [{"item_id": uuid, "paid": 원 또는 null}].
-- 안 산 품목은 산 것으로 바꾼다: 산 날은 내역 날짜(한국 시간 정오), 산 사람은 부른 사람. 이미 산 품목은 그 기록을 둔다.
-- 내역이 안 보이면(남의 가구, 없는 id) tx_not_found, 이미 다른 내역에 연결된 품목은 already_linked,
-- 안 보이거나 내역과 가구가 다른 품목은 item_not_found. 연결한 품목 수를 돌려준다.
create function grocery.link_purchase(p_tx uuid, p_links jsonb)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  tx record;
  l record;
  n int := 0;
begin
  select id, household_id, occurred_on into tx from public.transactions where id = p_tx;
  if not found then
    raise exception 'tx_not_found' using errcode = 'P0001';
  end if;
  for l in
    select (e->>'item_id')::uuid as item_id, nullif(e->>'paid', '')::bigint as paid
    from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) as e
  loop
    if l.paid is not null and l.paid <= 0 then
      raise exception 'invalid_paid' using errcode = 'P0001';
    end if;
    if exists (select 1 from grocery.items where id = l.item_id and transaction_id is not null) then
      raise exception 'already_linked' using errcode = 'P0001';
    end if;
    update grocery.items
      set transaction_id = tx.id,
          bought_at = coalesce(bought_at, (tx.occurred_on + time '12:00') at time zone 'Asia/Seoul'),
          bought_by = coalesce(bought_by, (select auth.uid())),
          paid = l.paid
      where id = l.item_id and household_id = tx.household_id;
    if not found then
      raise exception 'item_not_found' using errcode = 'P0001';
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- 장보기에서 "가계부에 넣기": 내역마다 가계부 함수로 내역(+품목 줄)을 만들고 장보기 품목을 연결한다.
-- p_entries = [{"tx": 가계부 내역 jsonb, "items": 가계부 품목 줄 jsonb 배열, "links": link_purchase의 p_links}].
-- 한 번의 호출이 한 트랜잭션이라 중간에 실패하면 앞에서 만든 내역도 남지 않는다. 만든 내역 id를 순서대로 돌려준다.
create function grocery.record_purchase(p_household_id uuid, p_entries jsonb)
returns uuid[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  e jsonb;
  tx_id uuid;
  ids uuid[] := '{}';
begin
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'no_entries' using errcode = 'P0001';
  end if;
  for e in select value from jsonb_array_elements(p_entries) loop
    if jsonb_array_length(coalesce(e->'links', '[]'::jsonb)) = 0 then
      raise exception 'no_links' using errcode = 'P0001';
    end if;
    tx_id := public.add_transaction_with_items(p_household_id, e->'tx', coalesce(e->'items', '[]'::jsonb));
    perform grocery.link_purchase(tx_id, e->'links');
    ids := ids || tx_id;
  end loop;
  return ids;
end;
$$;

revoke execute on function grocery.link_purchase(uuid, jsonb) from public, anon;
grant execute on function grocery.link_purchase(uuid, jsonb) to authenticated;
revoke execute on function grocery.record_purchase(uuid, jsonb) from public, anon;
grant execute on function grocery.record_purchase(uuid, jsonb) to authenticated;
