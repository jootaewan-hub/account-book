# 레시피: 계약 폴더 (v1, 낡음)

이 폴더의 `recipe.schema.json`, `db-draft.sql`, `examples/`는 설계 승인 전(2026-11-18)의 **v1**이다. 예시의 영상 길이(780초)도 어림값이라 낡았다. 다시 만들지 않고 남겨 둔 것이다.

지금 기준은 다음이다.

- 계약 v2: `supabase/functions/_shared/recipeContract.ts`
- DB: `supabase/migrations/*_recipe_*.sql` 셋(`recipe_init`, `recipe_import`, `recipe_pantry`)
- 결정: `docs/grocery/tracking/decisions/index.md`의 D-057(구조)과 D-056~D-063
