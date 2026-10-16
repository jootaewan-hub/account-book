-- 11단계: 새 회원가입을 DB에서 막는다.
-- 두 사람 모두 가입을 마쳤으므로, 낯선 사람이 계정을 만들지 못하게 auth.users에 새 행이 들어오기 직전에 거절한다.
-- 로그인·비밀번호 재설정·이메일 확인은 기존 행을 고칠 뿐 새 행을 만들지 않으므로 영향이 없다.
-- 다시 가입을 받아야 할 때는 SQL Editor에서 `update private.signup_gate set open = true;` 후 가입하고, 끝나면 false로 되돌린다.

create table private.signup_gate (
  id boolean primary key default true check (id),
  open boolean not null default false
);
revoke all on private.signup_gate from public, anon, authenticated;
insert into private.signup_gate default values;

create function private.reject_new_users()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select g.open from private.signup_gate g), false) then
    return new;
  end if;
  raise exception 'signups_closed' using errcode = 'P0001';
end;
$$;
revoke execute on function private.reject_new_users() from public, anon, authenticated;
grant execute on function private.reject_new_users() to supabase_auth_admin;

create trigger reject_new_users
  before insert on auth.users
  for each row execute function private.reject_new_users();
