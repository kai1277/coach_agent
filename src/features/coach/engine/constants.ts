import type { TypeKey } from "../../../types/api";
import type { Question } from "./inference";

// Strength → Type の公式マップ（単一の出所）
export const STRENGTH2TYPE: Record<string, TypeKey> = {
  // 戦略
  戦略性: "TYPE_STRATEGY",
  着想: "TYPE_STRATEGY",
  未来志向: "TYPE_STRATEGY",
  自己確信: "TYPE_STRATEGY",
  指令性: "TYPE_STRATEGY",
  最上志向: "TYPE_STRATEGY",
  競争性: "TYPE_STRATEGY",
  // 共感
  共感性: "TYPE_EMPATHY",
  包含: "TYPE_EMPATHY",
  個別化: "TYPE_EMPATHY",
  調和性: "TYPE_EMPATHY",
  コミュニケーション: "TYPE_EMPATHY",
  親密性: "TYPE_EMPATHY",
  社交性: "TYPE_EMPATHY",
  // 実行
  達成欲: "TYPE_EXECUTION",
  規律性: "TYPE_EXECUTION",
  責任感: "TYPE_EXECUTION",
  目標志向: "TYPE_EXECUTION",
  活発性: "TYPE_EXECUTION",
  アレンジ: "TYPE_EXECUTION",
  回復志向: "TYPE_EXECUTION",
  // 探究
  分析思考: "TYPE_ANALYTICAL",
  学習欲: "TYPE_ANALYTICAL",
  収集心: "TYPE_ANALYTICAL",
  内省: "TYPE_ANALYTICAL",
  原点思考: "TYPE_ANALYTICAL",
  慎重さ: "TYPE_ANALYTICAL",
  // 安定
  適応性: "TYPE_STABILITY",
  公平性: "TYPE_STABILITY",
  ポジティブ: "TYPE_STABILITY",
  信念: "TYPE_STABILITY",
  運命思考: "TYPE_STABILITY",
};

// 質問バンク（単一の出所）
export const QUESTIONS: Question[] = [
  {
    id: "Q1",
    text: "曖昧な状況でも方向性を決めて前に進めますか？",
    yes: {
      TYPE_STRATEGY: 0.85,
      TYPE_EMPATHY: 0.5,
      TYPE_EXECUTION: 0.6,
      TYPE_ANALYTICAL: 0.55,
      TYPE_STABILITY: 0.45,
    },
  },
  {
    id: "Q2",
    text: "相手の感情の変化に素早く気づき、配慮した行動を取りますか？",
    yes: {
      TYPE_STRATEGY: 0.45,
      TYPE_EMPATHY: 0.9,
      TYPE_EXECUTION: 0.5,
      TYPE_ANALYTICAL: 0.5,
      TYPE_STABILITY: 0.6,
    },
  },
  {
    id: "Q3",
    text: "締切やルーチンを守るのは苦になりませんか？",
    yes: {
      TYPE_STRATEGY: 0.55,
      TYPE_EMPATHY: 0.5,
      TYPE_EXECUTION: 0.9,
      TYPE_ANALYTICAL: 0.55,
      TYPE_STABILITY: 0.65,
    },
  },
  {
    id: "Q4",
    text: "意思決定の前に根拠やデータを集めて検討する方ですか？",
    yes: {
      TYPE_STRATEGY: 0.65,
      TYPE_EMPATHY: 0.45,
      TYPE_EXECUTION: 0.55,
      TYPE_ANALYTICAL: 0.9,
      TYPE_STABILITY: 0.6,
    },
  },
  {
    id: "Q5",
    text: "安定した関係や環境を維持することを重視しますか？",
    yes: {
      TYPE_STRATEGY: 0.45,
      TYPE_EMPATHY: 0.7,
      TYPE_EXECUTION: 0.6,
      TYPE_ANALYTICAL: 0.55,
      TYPE_STABILITY: 0.9,
    },
  },
  {
    id: "Q6",
    text: "新しい発想や切り口を出すのが得意だと感じますか？",
    yes: {
      TYPE_STRATEGY: 0.85,
      TYPE_EMPATHY: 0.5,
      TYPE_EXECUTION: 0.5,
      TYPE_ANALYTICAL: 0.65,
      TYPE_STABILITY: 0.45,
    },
  },
  {
    id: "Q7",
    text: "衝突が起きたとき、まず関係修復を優先しますか？",
    yes: {
      TYPE_STRATEGY: 0.5,
      TYPE_EMPATHY: 0.85,
      TYPE_EXECUTION: 0.5,
      TYPE_ANALYTICAL: 0.45,
      TYPE_STABILITY: 0.7,
    },
  },
  {
    id: "Q8",
    text: "タスクを細かく分解して着実に進めるのが得意ですか？",
    yes: {
      TYPE_STRATEGY: 0.6,
      TYPE_EMPATHY: 0.45,
      TYPE_EXECUTION: 0.9,
      TYPE_ANALYTICAL: 0.55,
      TYPE_STABILITY: 0.65,
    },
  },
  {
    id: "Q9",
    text: "まず仮説を立て、検証しながら考えを更新しますか？",
    yes: {
      TYPE_STRATEGY: 0.8,
      TYPE_EMPATHY: 0.45,
      TYPE_EXECUTION: 0.55,
      TYPE_ANALYTICAL: 0.85,
      TYPE_STABILITY: 0.55,
    },
  },
  {
    id: "Q10",
    text: "変化よりも一貫性や予測可能性を好みますか？",
    yes: {
      TYPE_STRATEGY: 0.45,
      TYPE_EMPATHY: 0.55,
      TYPE_EXECUTION: 0.6,
      TYPE_ANALYTICAL: 0.55,
      TYPE_STABILITY: 0.9,
    },
  },
  {
    id: "Q11",
    text: "相手の文脈を言い換えて要約するのが得意ですか？",
    yes: {
      TYPE_STRATEGY: 0.65,
      TYPE_EMPATHY: 0.8,
      TYPE_EXECUTION: 0.5,
      TYPE_ANALYTICAL: 0.6,
      TYPE_STABILITY: 0.55,
    },
  },
  {
    id: "Q12",
    text: "目標から逆算して重要度順に物事を並べられますか？",
    yes: {
      TYPE_STRATEGY: 0.9,
      TYPE_EMPATHY: 0.45,
      TYPE_EXECUTION: 0.7,
      TYPE_ANALYTICAL: 0.65,
      TYPE_STABILITY: 0.6,
    },
  },
];
