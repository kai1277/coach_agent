export const STRENGTH_THEMES = [
  "達成欲",
  "活発性",
  "適応性",
  "分析思考",
  "アレンジ",
  "信念",
  "指令性",
  "コミュニケーション",
  "競争性",
  "共感性",
  "公平性",
  "原点思考",
  "未来志向",
  "調和性",
  "着想",
  "包含",
  "個別化",
  "収集心",
  "成長促進",
  "内省",
  "親密性",
  "学習欲",
  "最上志向",
  "ポジティブ",
  "規律性",
  "回復志向",
  "責任感",
  "自我",
  "自己確信",
  "戦略性",
  "社交性",
  "慎重さ",
  "運命思考",
  "目標志向",
] as const;

export type StrengthTheme = (typeof STRENGTH_THEMES)[number];

export function isStrengthTheme(x: unknown): x is StrengthTheme {
  return (
    typeof x === "string" && (STRENGTH_THEMES as readonly string[]).includes(x)
  );
}
