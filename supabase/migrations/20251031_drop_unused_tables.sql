-- 未使用テーブルの削除
-- evals テーブルと hitl_reviews テーブルは現在のコードで使用されていないため削除

-- evals テーブルを削除
DROP TABLE IF EXISTS public.evals CASCADE;

-- hitl_reviews テーブルと関連するインデックスを削除
DROP INDEX IF EXISTS public.idx_reviews_target;
DROP TABLE IF EXISTS public.hitl_reviews CASCADE;
