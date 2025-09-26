// シンプルな質問エンジン検証シミュレータ
import { QUESTIONS } from "./questions";
import {
  priorFromContextAndTop5,
  pickNextQuestion,
  recomputePosterior,
  TYPES,
  type Question,
} from "./inference";
import { STRENGTH2TYPE } from "./constants";
import type { Answer5, TypeKey } from "../../../types/api";

export type SimConfig = {
  nUsers: number; // 例: 1000
  threshold: number; // 例: 0.85〜0.9
  maxQuestions: number; // 例: 8
  minQuestions?: number; // 例: 0〜2
  noise?: number; // 誤答ノイズ（0〜0.5）例: 0.05
  context?: "仕事" | "人間関係" | "プライベート" | null;
  strengths_top5?: string[] | null; // prior 用（未指定でOK）
};

type RunStats = {
  avgQuestions: number;
  avgConfidence: number;
  stopByThreshold: number;
  stopByMax: number;
  typeHitRate: number; // 予測トップ=真タイプの割合（参考値）
  igPerQuestion: Array<{ id: string; text: string; avgIG: number }>;
  confusion: Record<TypeKey, Record<TypeKey, number>>; // true x predicted
};

function sampleAnswer(yesProb: number, noise: number): Answer5 {
  // ground truth が YES/NO を作る簡易モデル → 5段階に写像
  const r = Math.random();
  const baseYes = r < yesProb ? 1 : 0;
  // ノイズでゆらす
  const p = baseYes ? 0.9 - noise : 0.1 + noise;
  if (p >= 0.8) return "YES";
  if (p >= 0.6) return "PROB_YES";
  if (p >= 0.4) return "UNKNOWN";
  if (p >= 0.2) return "PROB_NO";
  return "NO";
}

function argmax<T extends string>(m: Record<T, number>): T {
  return (Object.keys(m) as T[]).reduce((a, b) => (m[a] >= m[b] ? a : b));
}

export function runSimulation(config: SimConfig): RunStats {
  const {
    nUsers,
    threshold,
    maxQuestions,
    minQuestions = 0,
    noise = 0.05,
    context = null,
    strengths_top5 = null,
  } = config;

  // 情報利得の集計
  const igAcc: Record<string, { text: string; sum: number; cnt: number }> = {};
  QUESTIONS.forEach((q) => (igAcc[q.id] = { text: q.text, sum: 0, cnt: 0 }));

  // 混同行列 初期化
  const zeroRow = {
    TYPE_STRATEGY: 0,
    TYPE_EMPATHY: 0,
    TYPE_EXECUTION: 0,
    TYPE_ANALYTICAL: 0,
    TYPE_STABILITY: 0,
  };
  const confusion: RunStats["confusion"] = {
    TYPE_STRATEGY: { ...zeroRow },
    TYPE_EMPATHY: { ...zeroRow },
    TYPE_EXECUTION: { ...zeroRow },
    TYPE_ANALYTICAL: { ...zeroRow },
    TYPE_STABILITY: { ...zeroRow },
  };

  let totalQ = 0;
  let totalConf = 0;
  let byTh = 0;
  let byMax = 0;
  let hit = 0;

  for (let u = 0; u < nUsers; u++) {
    // 真タイプを一様サンプル（必要なら分布を変えてOK）
    const trueType = TYPES[Math.floor(Math.random() * TYPES.length)];
    const prior = priorFromContextAndTop5(
      context,
      strengths_top5,
      STRENGTH2TYPE
    );

    // 進行
    let asked = 0;
    let post = { ...prior };
    const answeredIds = new Set<string>();
    const qa: { q: Question; a: Answer5 }[] = [];

    while (true) {
      // 必ず1問は聞く
      const { question } = pickNextQuestion(post, QUESTIONS, answeredIds);
      const q =
        question ??
        QUESTIONS.find((x) => !answeredIds.has(x.id)) ??
        QUESTIONS[0];

      // ground truth に基づいて回答を生成
      const yesProb = q.yes[trueType];
      const a = sampleAnswer(yesProb, noise);
      qa.push({ q, a });
      asked += 1;
      answeredIds.add(q.id);

      // posterior 更新 + IG 計算
      const priorH = entropy(post);
      const { posterior, deltas } = recomputePosterior(post, [{ q, a }]);
      post = posterior;
      const ig = Math.max(0, priorH - entropy(post));
      igAcc[q.id].sum += ig;
      igAcc[q.id].cnt += 1;

      // 停止条件
      const top = argmax(post);
      const conf = post[top];
      const canStop =
        asked >= Math.max(1, minQuestions) &&
        (conf >= threshold || asked >= maxQuestions);
      if (canStop) {
        totalQ += asked;
        totalConf += conf;
        if (conf >= threshold) byTh += 1;
        else byMax += 1;
        confusion[trueType][top] += 1;
        if (top === trueType) hit += 1;
        break;
      }
    }
  }

  const igPerQuestion = Object.entries(igAcc)
    .map(([id, v]) => ({
      id,
      text: v.text,
      avgIG: v.cnt ? v.sum / v.cnt : 0,
    }))
    .sort((a, b) => b.avgIG - a.avgIG);

  return {
    avgQuestions: totalQ / nUsers,
    avgConfidence: totalConf / nUsers,
    stopByThreshold: byTh / nUsers,
    stopByMax: byMax / nUsers,
    typeHitRate: hit / nUsers,
    igPerQuestion,
    confusion,
  };
}

// 既存 inference.ts から拝借
function entropy(p: Record<string, number>) {
  let h = 0;
  for (const v of Object.values(p)) if (v > 0) h -= v * Math.log2(v);
  return h;
}
