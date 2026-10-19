// Supabase의 auth 스키마, anon/authenticated 역할, realtime publication, storage를 PGlite에서 최소한으로 흉내 낸다.
// 가계부 db.test.ts와 장보기 DB 테스트(tests/grocery/)가 함께 쓴다.
export const SUPABASE_STUB = `
create schema auth;
create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
create role service_role nologin;
grant usage on schema public to service_role;
create role supabase_auth_admin nologin;
create publication supabase_realtime;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text not null, owner uuid default auth.uid(), created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
`
