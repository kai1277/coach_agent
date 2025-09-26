import { STRENGTHS_META } from "../constants/strengths_meta";

export type StrengthProfile = {
  perTheme: Array<{
    theme: string;
    traits: string[];
    management: string[];
  }>;
  // 重複を束ねた上位まとめ（例：3〜5点）
  summarizedTraits: string[];
  summarizedManagement: string[];
};

/**
 * Top5 から、資質別カード＋まとめ（重複を束ねて上位N）を返す
 */
export function buildStrengthProfile(
  top5: string[],
  topN = 5
): StrengthProfile {
  const perTheme = top5
    .filter((t) => !!STRENGTHS_META[t])
    .map((t) => ({ theme: t, ...STRENGTHS_META[t] }));

  // まとめ方：単純に全部集めて重複カウント→出現頻度の高いもの上位
  const allTraits = perTheme.flatMap((x) => x.traits);
  const allMgmt = perTheme.flatMap((x) => x.management);

  const pickTop = (items: string[], n: number) => {
    const freq = new Map<string, number>();
    items.forEach((s) => freq.set(s, (freq.get(s) ?? 0) + 1));
    return [...freq.entries()]
      .sort((a, b) => (b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1]))
      .slice(0, n)
      .map(([s]) => s);
  };

  return {
    perTheme,
    summarizedTraits: pickTop(allTraits, Math.min(topN, 8)),
    summarizedManagement: pickTop(allMgmt, Math.min(topN, 8)),
  };
}
