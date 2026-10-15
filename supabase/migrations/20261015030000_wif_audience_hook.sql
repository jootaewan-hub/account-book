-- Anthropic Workload Identity Federation은 교환할 토큰의 aud에 https://api.anthropic.com이 있어야 받는다.
-- Supabase 로그인 토큰의 aud("authenticated")는 그대로 두고 Anthropic 주소를 배열로 덧붙인다.
-- 대시보드 Authentication > Auth Hooks > Customize Access Token (JWT) Claims에서 이 함수를 지정해야 동작한다.
create function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  aud jsonb := event->'claims'->'aud';
begin
  if jsonb_typeof(aud) = 'string' then
    aud := jsonb_build_array(aud);
  elsif aud is null or jsonb_typeof(aud) <> 'array' then
    aud := '[]'::jsonb;
  end if;
  if not aud ? 'https://api.anthropic.com' then
    aud := aud || jsonb_build_array('https://api.anthropic.com');
  end if;
  return jsonb_set(event, '{claims,aud}', aud);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
