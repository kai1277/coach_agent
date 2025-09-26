import type { TypeKey } from "../../../types/api";
import type { Question } from "./inference";
// JSON をインポート（tsconfig.json で resolveJsonModule: true が必要）
import raw from "./questions.json";

type JsonQuestion = {
  id: string;
  text: string;
  yes?: Partial<Record<TypeKey, number>>;
  yesProb?: Partial<Record<TypeKey, number>>; // ← JSON側がこちらでもOK
};

const KEYS: TypeKey[] = [
  "TYPE_STRATEGY",
  "TYPE_EMPATHY",
  "TYPE_EXECUTION",
  "TYPE_ANALYTICAL",
  "TYPE_STABILITY",
];

const clampProb = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(0.99, Math.max(0.01, n));
};

function toEngineQuestion(j: JsonQuestion): Question {
  const src = (j.yes ?? j.yesProb ?? {}) as Partial<Record<TypeKey, number>>;
  const yes: Record<TypeKey, number> = {
    TYPE_STRATEGY: 0.5,
    TYPE_EMPATHY: 0.5,
    TYPE_EXECUTION: 0.5,
    TYPE_ANALYTICAL: 0.5,
    TYPE_STABILITY: 0.5,
  };
  for (const k of KEYS) {
    if (k in src) yes[k] = clampProb(src[k]);
  }
  return { id: j.id, text: j.text, yes };
}

const arr = (raw as unknown as JsonQuestion[]).map(toEngineQuestion);

// ざっくり妥当性チェック（開発中の早期検知用）
if (import.meta.env?.MODE !== "production") {
  for (const q of arr) {
    for (const k of KEYS) {
      const v = q.yes[k];
      if (!(v > 0 && v < 1)) {
        // eslint-disable-next-line no-console
        console.warn(`[questions] invalid prob: ${q.id} ${k}=${v}`);
      }
    }
  }
}

export const QUESTIONS: Question[] = arr;
