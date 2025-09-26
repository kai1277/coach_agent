import type { Answer5, Posterior, TypeKey } from "../../../types/api";

export const TYPES: TypeKey[] = [
  "TYPE_STRATEGY",
  "TYPE_EMPATHY",
  "TYPE_EXECUTION",
  "TYPE_ANALYTICAL",
  "TYPE_STABILITY",
];

export const TYPE_LABEL: Record<TypeKey, string> = {
  TYPE_STRATEGY: "戦略ドライバー",
  TYPE_EMPATHY: "共感モデレーター",
  TYPE_EXECUTION: "実行オーガナイザー",
  TYPE_ANALYTICAL: "探究アナリスト",
  TYPE_STABILITY: "安定オーガナイザー",
};

export type Question = {
  id: string;
  text: string;
  yes: Record<TypeKey, number>; // 「YESになりやすさ」(各タイプの尤度パラメータ)
};

// ※テストは Answer5 を使って尤度合成する前提
export const ANSWER_WEIGHT: Record<Answer5, number> = {
  YES: 0.95,
  PROB_YES: 0.75,
  UNKNOWN: 0.5,
  PROB_NO: 0.25,
  NO: 0.05,
};

export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function normalize<T extends string>(m: Record<T, number>) {
  const s = sum(Object.values(m));
  const n = {} as Record<T, number>;
  const keys = Object.keys(m) as T[];
  if (s <= 0) {
    const v = 1 / keys.length;
    keys.forEach((k) => (n[k] = v));
    return n;
  }
  keys.forEach((k) => (n[k] = m[k] / s));
  return n;
}

export const entropy = (p: Record<string, number>) => {
  let h = 0;
  for (const v of Object.values(p)) if (v > 0) h -= v * Math.log2(v);
  return h;
};

const SHARPEN = 1.6;

export function likelihood(a: Answer5, yesProb: number) {
  const w = ANSWER_WEIGHT[a];
  // 基本の線形混合
  const r = clamp(w * yesProb + (1 - w) * (1 - yesProb), 1e-6, 1 - 1e-6);

  // ★シャープ化（r をロジスティック正規化で引き伸ばす）
  //   直感：r が 0.5 から離れているほど、さらに離す
  const p = Math.pow(r, SHARPEN);
  const q = Math.pow(1 - r, SHARPEN);
  const s = p / (p + q); // 正規化
  return clamp(s, 1e-6, 1 - 1e-6);
}

/**
 * 文脈とTop5から事前分布を作る。
 * strengths→type のマップは DI（引数）で渡す前提。
 */
export function priorFromContextAndTop5(
  ctx?: "仕事" | "人間関係" | "プライベート" | string | null,
  top5?: string[] | null,
  strength2type?: Record<string, TypeKey>
): Posterior {
  const base: Posterior = {
    TYPE_STRATEGY: 1,
    TYPE_EMPATHY: 1,
    TYPE_EXECUTION: 1,
    TYPE_ANALYTICAL: 1,
    TYPE_STABILITY: 1,
  };
  if (ctx === "仕事") {
    base.TYPE_STRATEGY += 0.4;
    base.TYPE_EXECUTION += 0.3;
  } else if (ctx === "人間関係") {
    base.TYPE_EMPATHY += 0.5;
    base.TYPE_STABILITY += 0.2;
  } else if (ctx === "プライベート") {
    base.TYPE_STABILITY += 0.5;
  }
  if (top5?.length && strength2type) {
    for (const s of top5) {
      const k = strength2type[s];
      if (k) base[k] += 0.35;
    }
  }
  return normalize(base);
}

/**
 * 与えた prior/posterior と回答列から posterior を再計算。
 * 各回答でのエントロピー低下量（寄与度）も返す。
 */
export function recomputePosterior(
  prior: Posterior,
  answers: { q: Question; a: Answer5 }[]
): { posterior: Posterior; deltas: number[] } {
  let p = { ...prior };
  const deltas: number[] = [];
  for (const { q, a } of answers) {
    const next: Posterior = {
      TYPE_STRATEGY: 0,
      TYPE_EMPATHY: 0,
      TYPE_EXECUTION: 0,
      TYPE_ANALYTICAL: 0,
      TYPE_STABILITY: 0,
    };
    const H0 = entropy(p);
    for (const t of TYPES) next[t] = p[t] * likelihood(a, q.yes[t]);
    const pn = normalize(next);
    const H1 = entropy(pn);
    deltas.push(Math.max(0, H0 - H1));
    p = pn;
  }
  return { posterior: p, deltas };
}

/**
 * 未回答の中から、期待エントロピー低下（情報利得）が最大の質問を返す。
 * 同率は id 昇順でタイブレーク。候補が無ければ question は null。
 */
export function pickNextQuestion(
  posterior: Posterior,
  questions: Question[],
  answeredIds: Set<string>
): { question: Question | null; expectedGain: number } {
  // 数値異常に備えて軽く正規化しておく
  const p: Posterior = normalize({ ...posterior });
  const H = entropy(p);

  let best: Question | null = null;
  let bestGain = -1;

  for (const q of questions) {
    if (answeredIds.has(q.id)) continue;

    // 回答 a の周辺確率 P(a)
    const pa: Record<Answer5, number> = {
      YES: 0,
      PROB_YES: 0,
      UNKNOWN: 0,
      PROB_NO: 0,
      NO: 0,
    };
    (Object.keys(pa) as Answer5[]).forEach((a) => {
      const s = TYPES.reduce(
        (acc, t) => acc + p[t] * likelihood(a, q.yes[t]),
        0
      );
      // 数値安定化
      pa[a] = Number.isFinite(s) ? clamp(s, 1e-6, 1 - 1e-6) : 0.2;
    });

    // 期待エントロピー E_a[ H( p(t|a) ) ]
    let expH = 0;
    (Object.keys(pa) as Answer5[]).forEach((a) => {
      const tmp: Posterior = {
        TYPE_STRATEGY: 0,
        TYPE_EMPATHY: 0,
        TYPE_EXECUTION: 0,
        TYPE_ANALYTICAL: 0,
        TYPE_STABILITY: 0,
      };
      for (const t of TYPES) {
        const v = p[t] * likelihood(a, q.yes[t]);
        tmp[t] = Number.isFinite(v) ? v : 0;
      }
      const postA = normalize(tmp);
      expH += pa[a] * entropy(postA);
    });

    const gain = H - expH;

    // タイブレーク：gain 同値（±1e-9）なら id 昇順
    if (
      gain > bestGain + 1e-9 ||
      (Math.abs(gain - bestGain) <= 1e-9 && (!best || q.id < best.id))
    ) {
      best = q;
      bestGain = gain;
    }
  }

  // ✅ フォールバック：ループで選べなかった場合でも、未回答の最小 id を返す
  if (!best) {
    const candidates = questions
      .filter((q) => !answeredIds.has(q.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (candidates.length > 0) {
      best = candidates[0];
      // 情報利得は不明のため 0 とする（テストは id が defined かを見るだけ）
      return { question: best, expectedGain: 0 };
    }
  }

  return { question: best, expectedGain: Math.max(0, bestGain) };
}

export function nextStepsByType(t: TypeKey): string[] {
  switch (t) {
    case "TYPE_STRATEGY":
      return [
        "上司/関係者の「成功条件」を1枚に要約して擦り合わせる",
        "3つの選択肢（A/B/C）で意思決定の比較表を作る",
        "次の会議アジェンダを目的→判断基準→論点の順に並べる",
      ];
    case "TYPE_EMPATHY":
      return [
        "相手の期待/不安の仮説を3つ書き出して確認する",
        "1on1で「過去/現在/未来」の3視点で聴く",
        "関係者マップを作り影響度×関心で整理する",
      ];
    case "TYPE_EXECUTION":
      return [
        "今週のタスクを15分単位でブロックし、翌朝に確認する",
        "着手30分で「最小アウトプット」を作って共有する",
        "障害になっている外部依存を1件ずつ潰すリストを作る",
      ];
    case "TYPE_ANALYTICAL":
      return [
        "事実/解釈/判断を分離してメモを書く",
        "データ/根拠の不足箇所を3点洗い出す",
        "仮説を1つに絞り検証条件を明文化する",
      ];
    case "TYPE_STABILITY":
    default:
      return [
        "役割/責任/決定権の境界を文書化し共有する",
        "定例の目的・期待アウトプットをテンプレ化する",
        "変化点がある案件は事前に関係者へブリーフィングする",
      ];
  }
}
