-- 레시피 등록 보조 함수 json_text_array(JSON 글자 배열 → text[]).
-- 등록 함수 import_recipe 자체는 delete 문장이 있어 20261122040000_recipe_import_fn.sql에 따로 둔다
-- (Supabase MCP apply_migration이 delete 문장이 든 SQL을 거절한다. 그 파일은 SQL 편집기에서 적용한다).
--
-- 경계: recipe 스키마만 만들고 바꾼다(tests/recipes/boundary.test.ts).
-- JSON 글자 배열 → text[](순서 유지). 없거나 JSON null이면 빈 배열, 배열이 아니면 22023.
create function recipe.json_text_array(p jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(t.v order by t.n), '{}'::text[])
    from jsonb_array_elements_text(coalesce(nullif(p, 'null'::jsonb), '[]'::jsonb)) with ordinality as t(v, n);
$$;
revoke execute on function recipe.json_text_array(jsonb) from public, anon, authenticated;
