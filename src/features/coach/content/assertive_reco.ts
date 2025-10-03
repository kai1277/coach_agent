import type { TypeKey } from "../../../types/api";

const TYPE_JA_LABEL: Record<TypeKey, string> = {
  TYPE_STRATEGY: "戦略タイプ",
  TYPE_EMPATHY: "共感タイプ",
  TYPE_EXECUTION: "実行タイプ",
  TYPE_ANALYTICAL: "探究タイプ",
  TYPE_STABILITY: "安定タイプ",
};

type Ctx = {
  strengths?: string[]; // Top5（任意）
  confidence?: number; // 確信度（0..1）任意
};

function pickPrefix(conf?: number): string {
  if (typeof conf !== "number") return "あなたは";
  if (conf >= 0.9) return "あなたは間違いなく";
  if (conf >= 0.8) return "あなたはかなりの確度で";
  if (conf >= 0.7) return "あなたはおそらく";
  return "あなたは";
}

export function buildAssertiveReco(
  top: TypeKey,
  ctx: Ctx = {}
): { headline: string; bullets: string[] } {
  const label = TYPE_JA_LABEL[top];
  const prefix = pickPrefix(ctx.confidence);
  const s = (ctx.strengths ?? []).slice(0, 2).join("・"); // 最多2つだけ軽く添える

  const withTag = (txt: string) => (s ? `${txt}（Top: ${s}）` : txt); // 軽い“根拠感”を付与（表示トーンは控えめ）

  switch (top) {
    case "TYPE_STRATEGY":
      return {
        headline: `${prefix}${label}。まず“優先順位”をあなたが決めてください。`,
        bullets: [
          withTag("会議の冒頭で“この30分で決めること”を明確化する"),
          "選択肢を3つだけ提示し、即断即決の型で前に進める",
          "翌日の朝一に“最短ルートの小さな一歩”を自分で設定・実行する",
        ],
      };
    case "TYPE_EMPATHY":
      return {
        headline: `${prefix}${label}。まず“相手の状態”をあなたが見取り図にします。`,
        bullets: [
          withTag("1on1の最初に“最近の調子を10点満点で言うと?”から始める"),
          "共感で終わらず“では一緒に何を変える?”まで踏み込む",
          "相手の成功条件を言語化し、次回までの1歩を“相手の言葉”で記録する",
        ],
      };
    case "TYPE_EXECUTION":
      return {
        headline: `${prefix}${label}。まず“やることを小さく刻み”今日動きます。`,
        bullets: [
          withTag("目標を“30分で終わるタスク”に分解し、その場で割り当てる"),
          "カレンダーに時間確保→終わったらスクショで報告、までをセット",
          "完了定義(DoD)を明確化し、迷いを残さない",
        ],
      };
    case "TYPE_ANALYTICAL":
      return {
        headline: `${prefix}${label}。まず“判断基準”を仮決めして、検証していきます。`,
        bullets: [
          withTag("KPI/制約/リスクを1枚に可視化（NotionでOK）"),
          "“次の打ち手が変わる分岐”を2つだけ定義して、必要なデータを集める",
          "関係者と“根拠の出所”をすり合わせ、合意を取る",
        ],
      };
    case "TYPE_STABILITY":
      return {
        headline: `${prefix}${label}。まず“再現可能な型”を先に決めます。`,
        bullets: [
          withTag("週次のリズムを固定：1on1→ふりかえり→次の一歩の3点セット"),
          "変更は月1でまとめて行い、日々のルールは揺らさない",
          "属人化ポイントを発見したら“手順書化”して自分以外でも回る状態へ",
        ],
      };
    default:
      return {
        headline: `${prefix}タイプ推定中。まずは“次の一歩”を1つだけ決めます。`,
        bullets: [
          withTag("今週の終了時点で“できている状態”を1文で書き出す"),
          "30分タスクに分割し、最初の1つに今すぐ着手",
          "翌週の1on1で“やった/やってない”を事実で確認",
        ],
      };
  }
}
