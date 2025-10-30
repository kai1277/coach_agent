-- casebook_cards: YAMLの全内容を保持するための拡張
ALTER TABLE public.casebook_cards
  ADD COLUMN IF NOT EXISTS strength           text,
  ADD COLUMN IF NOT EXISTS domain             text,
  ADD COLUMN IF NOT EXISTS summary_json       jsonb,
  ADD COLUMN IF NOT EXISTS signals_json       jsonb,
  ADD COLUMN IF NOT EXISTS probes_json        jsonb,
  ADD COLUMN IF NOT EXISTS management_json    jsonb,
  ADD COLUMN IF NOT EXISTS pairing_json       jsonb,
  ADD COLUMN IF NOT EXISTS examples_json      jsonb,
  ADD COLUMN IF NOT EXISTS notes_json         jsonb,
  ADD COLUMN IF NOT EXISTS raw_json           jsonb;

-- 代表的な索引用（任意：必要に応じて）
CREATE INDEX IF NOT EXISTS casebook_cards_domain_idx      ON public.casebook_cards (domain);
CREATE INDEX IF NOT EXISTS casebook_cards_tags_gin        ON public.casebook_cards USING gin (tags);
CREATE INDEX IF NOT EXISTS casebook_cards_summary_gin     ON public.casebook_cards USING gin (summary_json);
CREATE INDEX IF NOT EXISTS casebook_cards_management_gin  ON public.casebook_cards USING gin (management_json);
CREATE INDEX IF NOT EXISTS casebook_cards_pairing_gin     ON public.casebook_cards USING gin (pairing_json);
CREATE INDEX IF NOT EXISTS casebook_cards_raw_json_gin    ON public.casebook_cards USING gin (raw_json);

-- すでに embedding の ivfflat を張っていなければ（必要に応じて lists はお好みで）
-- CREATE INDEX IF NOT EXISTS casebook_cards_embedding_ivf ON public.casebook_cards USING ivfflat (embedding vector_ops) WITH (lists = 100);

-- 更新日時の自動更新（入っていなければ）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at_casebook_cards'
  ) THEN
    CREATE OR REPLACE FUNCTION public.set_updated_at_casebook_cards()
    RETURNS trigger AS $f$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $f$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_casebook_cards_updated_at ON public.casebook_cards;
    CREATE TRIGGER trg_casebook_cards_updated_at
      BEFORE UPDATE ON public.casebook_cards
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_casebook_cards();
  END IF;
END$$;