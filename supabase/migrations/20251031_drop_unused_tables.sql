-- 未使用テーブルの削除
-- evals, hitl_reviews, evidence_snippets テーブルは現在のコードで使用されていないため削除

-- evals テーブルを削除
DROP TABLE IF EXISTS public.evals CASCADE;

-- hitl_reviews テーブルと関連するインデックスを削除
DROP INDEX IF EXISTS public.idx_reviews_target;
DROP TABLE IF EXISTS public.hitl_reviews CASCADE;

-- evidence_snippets テーブルと関連するインデックスを削除
DROP INDEX IF EXISTS public.evidence_snippets_embed_idx;
DROP TABLE IF EXISTS public.evidence_snippets CASCADE;
