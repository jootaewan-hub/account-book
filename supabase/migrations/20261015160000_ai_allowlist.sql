-- 10단계: AI(Claude) 사용을 허용한 가구로만 제한한다.
-- 회원가입이 열려 있으면 누구나 계정을 만들 수 있고, WIF 식별자는 공개 저장소에 있다.
-- 로그인 토큰에 Anthropic 대상(aud)이 붙으면 그 토큰으로 Anthropic 토큰을 바꿔 받을 수 있으므로,
-- 허용 목록에 있는 가구의 구성원 토큰에만 aud를 붙인다. (Edge Function도 aud가 없으면 AI를 부르지 않는다)

create table private.ai_households (
  household_id uuid primary key references public.households (id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on private.ai_households from public, anon, authenticated;

-- 이 마이그레이션을 적용하는 시점에 있던 가구만 허용한다. 새로 생기는 가구는 직접 넣어야 한다.
insert into private.ai_households (household_id) select id from public.households;

-- 허용 목록(private)을 읽어야 해서 SECURITY DEFINER로 바꾼다. 실행은 supabase_auth_admin만 한다.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  aud jsonb := event->'claims'->'aud';
  allowed boolean;
begin
  if jsonb_typeof(aud) = 'string' then
    aud := jsonb_build_array(aud);
  elsif aud is null or jsonb_typeof(aud) <> 'array' then
    aud := '[]'::jsonb;
  end if;
  select exists (
    select 1 from public.members m
    join private.ai_households a on a.household_id = m.household_id
    where m.user_id = (event->>'user_id')::uuid
  ) into allowed;
  if allowed then
    if not aud ? 'https://api.anthropic.com' then
      aud := aud || jsonb_build_array('https://api.anthropic.com');
    end if;
  else
    aud := aud - 'https://api.anthropic.com';
  end if;
  return jsonb_set(event, '{claims,aud}', aud);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
