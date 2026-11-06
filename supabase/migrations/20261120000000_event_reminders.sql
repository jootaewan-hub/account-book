-- 일정·기념일 알림은 기본값이 꺼짐이다. 알림을 켜는 사람과 받는 기기는 따로 정한다.
alter table public.events
  add column reminder_offset_minutes integer,
  add column reminder_recipient text,
  add column reminder_active_since timestamptz,
  add constraint events_reminder_check check (
    (reminder_offset_minutes is null and reminder_recipient is null)
    or (priority in ('high', 'must') and reminder_offset_minutes is not null
      and reminder_offset_minutes in (10, 30, 60, 1440) and reminder_recipient is not null)
  );

alter table public.anniversaries
  add column reminder_offset_minutes integer,
  add column reminder_recipient text,
  add column reminder_active_since timestamptz,
  add constraint anniversaries_reminder_check check (
    (reminder_offset_minutes is null and reminder_recipient is null)
    or (reminder_offset_minutes is not null and reminder_offset_minutes in (60, 1440, 10080)
      and reminder_recipient is not null)
  );

create function private.set_reminder_start()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  schedule_changed boolean := true;
begin
  if tg_table_name = 'events' then
    if new.priority = 'normal' then
      new.reminder_offset_minutes := null;
      new.reminder_recipient := null;
    end if;
    if tg_op = 'UPDATE' then
      schedule_changed := row(new.date, new.time, new.repeat_weeks, new.repeat_until, new.skipped_on)
        is distinct from row(old.date, old.time, old.repeat_weeks, old.repeat_until, old.skipped_on);
    end if;
  elsif tg_op = 'UPDATE' then
    schedule_changed := row(new.lunar, new.month, new.day, new.repeat_unit, new.repeat_every, new.start_year)
      is distinct from row(old.lunar, old.month, old.day, old.repeat_unit, old.repeat_every, old.start_year);
  end if;

  if new.reminder_offset_minutes is null then
    new.reminder_active_since := null;
  elsif schedule_changed or row(new.reminder_offset_minutes, new.reminder_recipient, new.household_id)
    is distinct from row(old.reminder_offset_minutes, old.reminder_recipient, old.household_id) then
    if new.reminder_recipient <> 'both' and not exists (
      select 1 from public.members m
      where m.household_id = new.household_id and m.user_id::text = new.reminder_recipient
    ) then
      raise exception '가계부에 참여한 사람만 알림을 받을 수 있어요.' using errcode = '23514';
    end if;
    new.reminder_active_since := statement_timestamp();
  else
    new.reminder_active_since := old.reminder_active_since;
  end if;
  return new;
end;
$$;
revoke execute on function private.set_reminder_start() from public, anon, authenticated;
create trigger events_set_reminder_start before insert or update on public.events
for each row execute function private.set_reminder_start();
create trigger anniversaries_set_reminder_start before insert or update on public.anniversaries
for each row execute function private.set_reminder_start();

create table public.event_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique check (
    char_length(endpoint) <= 2048
    and endpoint ~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|[a-z0-9-]+[.]push[.]apple[.]com|[a-z0-9-]+[.]notify[.]windows[.]com)/'
  ),
  p256dh text not null check (p256dh ~ '^[a-zA-Z0-9_-]{87}$'),
  auth_key text not null check (auth_key ~ '^[a-zA-Z0-9_-]{22}$')
);
create index event_push_subscriptions_user_idx on public.event_push_subscriptions (user_id);
alter table public.event_push_subscriptions enable row level security;
revoke all on public.event_push_subscriptions from public, anon, authenticated;
grant select, delete on public.event_push_subscriptions to authenticated;
grant insert (user_id, endpoint, p256dh, auth_key), update (user_id, endpoint, p256dh, auth_key)
  on public.event_push_subscriptions to authenticated;
grant select, delete on public.event_push_subscriptions to service_role;
create policy event_push_own_device on public.event_push_subscriptions
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- 발송 기록·잠금. 같은 날짜의 반복 회차도 기기마다 따로 확인한다.
create table public.event_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events (id) on delete cascade,
  anniversary_id uuid references public.anniversaries (id) on delete cascade,
  occurrence_date date not null,
  deliver_at timestamptz not null,
  subscription_id uuid not null references public.event_push_subscriptions (id) on delete cascade,
  lease_until timestamptz not null,
  done_at timestamptz,
  constraint event_push_delivery_source_check check (num_nonnulls(event_id, anniversary_id) = 1),
  constraint event_push_delivery_once unique nulls not distinct
    (event_id, anniversary_id, occurrence_date, deliver_at, subscription_id)
);
create index event_push_deliveries_anniv_idx on public.event_push_deliveries (anniversary_id);
create index event_push_deliveries_subscription_idx on public.event_push_deliveries (subscription_id);
alter table public.event_push_deliveries enable row level security;
revoke all on public.event_push_deliveries from public, anon, authenticated;
grant select, insert, update on public.event_push_deliveries to service_role;

-- 하루 종일 일정과 기념일은 한국 시간 오전 9시 기준. 누락된 실행은 10분 안에, 시작 전까지만 다시 시도한다.
-- 기념일은 Edge Function에서 화면과 같은 양력·음력 변환으로 날짜를 구한다. 읽은 뒤 수정된 기념일은 다음 실행에서 다시 계산한다.
create function public.claim_event_push_deliveries(p_now timestamptz, p_anniversary_dates jsonb)
returns table (
  id uuid, subscription_id uuid, lease_until timestamptz, occurrence_date date, is_anniversary boolean,
  start_at timestamptz, endpoint text, p256dh text, auth_key text
)
language sql
set search_path = ''
as $$
  with occurrences as (
    select e.id as event_id, null::uuid as anniversary_id, e.household_id, e.reminder_recipient,
      e.reminder_active_since, e.reminder_offset_minutes, d.occurs_on,
      (d.occurs_on + coalesce(e.time, time '09:00')) at time zone 'Asia/Seoul' as start_at
    from public.events e
    cross join lateral generate_series(0, 1) as n(days)
    cross join lateral (
      select ((p_now + make_interval(mins => e.reminder_offset_minutes) - interval '10 minutes')
        at time zone 'Asia/Seoul')::date + n.days as occurs_on
    ) d
    where e.reminder_offset_minutes is not null and e.priority in ('high', 'must')
      and (
        e.date = d.occurs_on
        or (e.repeat_weeks is not null and e.date < d.occurs_on
          and (e.repeat_until is null or d.occurs_on <= e.repeat_until)
          and (d.occurs_on - e.date) % (e.repeat_weeks * 7) = 0)
      )
      and not (d.occurs_on = any(e.skipped_on))

    union all

    select null::uuid, a.id, a.household_id, a.reminder_recipient,
      a.reminder_active_since, a.reminder_offset_minutes, d.occurs_on,
      (d.occurs_on + time '09:00') at time zone 'Asia/Seoul'
    from jsonb_to_recordset(p_anniversary_dates) as d(id uuid, occurs_on date, active_since timestamptz)
    join public.anniversaries a on a.id = d.id and a.reminder_active_since = d.active_since
    where a.reminder_offset_minutes is not null
  ),
  due as (
    select o.*, o.start_at - make_interval(mins => o.reminder_offset_minutes) as deliver_at
    from occurrences o
  ),
  pending as (
    select distinct d.event_id, d.anniversary_id, d.occurs_on, d.deliver_at, s.id as subscription_id, d.start_at
    from due d
    join public.members m on m.household_id = d.household_id
      and (d.reminder_recipient = 'both' or m.user_id::text = d.reminder_recipient)
    join public.event_push_subscriptions s on s.user_id = m.user_id
    left join public.event_push_deliveries prev on prev.event_id is not distinct from d.event_id
      and prev.anniversary_id is not distinct from d.anniversary_id and prev.occurrence_date = d.occurs_on
      and prev.deliver_at = d.deliver_at and prev.subscription_id = s.id
    where d.deliver_at <= p_now and d.deliver_at >= p_now - interval '10 minutes'
      and d.reminder_active_since <= d.deliver_at and d.start_at > p_now
      and prev.done_at is null and (prev.lease_until is null or prev.lease_until <= p_now)
    order by d.deliver_at, d.event_id, d.anniversary_id, s.id
    limit 30
  ),
  claimed as (
    insert into public.event_push_deliveries as delivery
      (event_id, anniversary_id, occurrence_date, deliver_at, subscription_id, lease_until)
    select p.event_id, p.anniversary_id, p.occurs_on, p.deliver_at, p.subscription_id, p_now + interval '90 seconds'
    from pending p
    on conflict on constraint event_push_delivery_once
    do update set lease_until = excluded.lease_until
      where delivery.done_at is null and delivery.lease_until <= p_now
    returning delivery.*
  )
  select c.id, c.subscription_id, c.lease_until, c.occurrence_date, c.anniversary_id is not null, p.start_at,
    s.endpoint, s.p256dh, s.auth_key
  from claimed c
  join pending p on p.event_id is not distinct from c.event_id and p.anniversary_id is not distinct from c.anniversary_id
    and p.occurs_on = c.occurrence_date and p.deliver_at = c.deliver_at and p.subscription_id = c.subscription_id
  join public.event_push_subscriptions s on s.id = c.subscription_id;
$$;
revoke execute on function public.claim_event_push_deliveries(timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.claim_event_push_deliveries(timestamptz, jsonb) to service_role;

-- 호스팅 환경에서만 설치한다. PGlite에서는 위의 알림 선택·발송 잠금 SQL을 직접 시험한다.
do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
    and exists (select 1 from pg_available_extensions where name = 'pg_net')
    and to_regclass('vault.decrypted_secrets') is not null then
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;
    perform cron.schedule('event-reminders', '* * * * *', $job$
      select net.http_post(
        url := rtrim(project.decrypted_secret, '/') || '/functions/v1/event-reminders',
        headers := jsonb_build_object('content-type', 'application/json', 'x-event-reminder-secret', secret.decrypted_secret),
        body := '{}'::jsonb,
        timeout_milliseconds := 25000
      )
      from vault.decrypted_secrets project
      cross join vault.decrypted_secrets secret
      where project.name = 'event_reminders_project_url' and secret.name = 'event_reminders_cron_secret';
    $job$);
  end if;
end;
$cron$;
