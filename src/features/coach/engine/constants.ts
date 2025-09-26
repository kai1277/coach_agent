import type { TypeKey } from "../../../types/api";

// ▼ 質問バンクは JSON 由来に切替（questions.ts で型付け）
export { QUESTIONS } from "./questions";

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
