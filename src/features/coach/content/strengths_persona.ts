import type { StrengthProfile } from "../../../types/api";

export type PersonaEntry = { traits: string[]; management: string[] };

// 34資質ごとの短文テンプレ（必要に応じて追記・調整OK）
export const STRENGTH_PERSONA: Record<string, PersonaEntry> = {
  活発性: {
    traits: ["新しいテーマに素早く着手する", "常に動き続けたい"],
    management: ["短いスプリントで回す", "新規起動の役割を連続的に与える"],
  },
  競争性: {
    traits: ["相対的な勝ち負けで燃える", "順位や比較が動機になる"],
    management: ["ランキングやKPIで勝負どころを明確化", "競合比較の場に置く"],
  },
  コミュニケーション: {
    traits: ["言語化と場づくりが得意", "間合い（1:多／少／1on1）がある"],
    management: ["得意な場にアサイン", "発言ガードレール（レビュー）を用意"],
  },
  最上志向: {
    traits: ["自分基準の“最良”を追う", "納得ラインが重要"],
    management: ["開始時に納得ラインを合意", "中断・撤退条件も事前合意"],
  },
  社交性: {
    traits: ["初対面でも関係を築く", "場を温める"],
    management: ["初期関係構築・フロント役に置く"],
  },
  指令性: {
    traits: ["自分の意思で場を動かす", "指示ドライブが強い"],
    management: ["裁量がある領域を与える", "権限設計を明確にする"],
  },
  自己確信: {
    traits: ["自分の軸への確信が強い"],
    management: ["目的整合だけ揃え任せる"],
  },
  自我: {
    traits: ["意義や承認を強く求める", "譲れない線がある"],
    management: ["存在意義が直に伝わるミッションを付与", "承認の仕組みを明示"],
  },

  学習欲: {
    traits: ["学ぶこと自体が動機", "自走でキャッチアップ"],
    management: ["学習→即PoCの課題設定", "資格・新技術の実務接続"],
  },
  分析思考: {
    traits: ["因果・根拠を求める", "データに強い"],
    management: ["打ち切り条件を先に定義", "結論の出し方を合意"],
  },
  原点思考: {
    traits: ["歴史・前例から腹落ちする"],
    management: ["過去→現在→未来の橋渡しを提示"],
  },
  未来志向: {
    traits: ["望ましい未来像から逆算", "新技術の順応が早い"],
    management: ["ビジョン設計やロードマップにアサイン"],
  },
  着想: {
    traits: ["アイデアが湧く", "新しい切り口を出す"],
    management: ["責任感や目標志向と組ませPDCAを設計"],
  },
  内省: {
    traits: ["内面を深く考える", "丁寧に振り返る"],
    management: ["定期1on1で言語化の場を確保", "早期シグナルを拾う"],
  },
  収集心: {
    traits: ["情報・モノ・人脈などを集めるのが好き"],
    management: ["収集→整理→共有の仕組みを役割化"],
  },
  戦略性: {
    traits: ["論理の筋道に敏感", "構造化が得意"],
    management: ["要点化・構造化の担当に置く", "コミュ系資質とペア"],
  },

  慎重さ: {
    traits: ["リスクヘッジが徹底", "石橋を叩く"],
    management: ["工程を小刻みに設計", "保守運用・監査など守りで活かす"],
  },
  アレンジ: {
    traits: ["編集・再配置が上手い", "議事整理や資料化が得意"],
    management: ["最適なアウトプット形式を見極め“編集長”役を任せる"],
  },
  達成欲: {
    traits: ["達成・進捗が原動力", "走り続けたい"],
    management: ["目標の明確化を徹底", "曖昧さを排除"],
  },
  信念: {
    traits: ["揺るがない価値観・軸がある"],
    management: ["会社方針との整合を最初に合わせる"],
  },
  公平性: {
    traits: ["公平・一貫性を重んじる"],
    management: ["評価基準の透明化・説明責任を厚く"],
  },
  規律性: {
    traits: ["ルール・手順・秩序を好む"],
    management: ["1→10や運用整備の標準化を担当"],
  },
  責任感: {
    traits: ["引き受けたことをやり遂げる"],
    management: ["仕事量の可視化と“断る支援”を設計"],
  },
  回復志向: {
    traits: ["問題解決・人のケアに強い"],
    management: ["オンボードやトラブルシュートのハブに"],
  },
  目標志向: {
    traits: ["目的・優先順位にフォーカスできる"],
    management: ["目的・優先順位・締切を明瞭に"],
  },

  個別化: {
    traits: ["人の違いを見抜き最適な組み合わせを考える"],
    management: ["配役設計・ペアリングで力を発揮"],
  },
  適応性: {
    traits: ["組織に馴染み、関係を円滑にする"],
    management: ["チーム安定化の役割に置く"],
  },
  共感性: {
    traits: ["感情の機微に気づき配慮できる"],
    management: ["信頼貯金を担う役割に"],
  },
  調和性: {
    traits: ["衝突を避け関係を保つ"],
    management: ["変革局面では意見言語化を支援"],
  },
  親密性: {
    traits: ["深い関係を築く"],
    management: ["小さな強いチームで活かす"],
  },
  包含: {
    traits: ["輪から漏れる人をつくらないよう配慮"],
    management: ["採用・オンボード・全体会の包容力設計に"],
  },
  ポジティブ: {
    traits: ["場を明るくし推進力を生む"],
    management: ["リスク管理役とバディ運用"],
  },
  運命思考: {
    traits: ["つながりや巡り合わせを重視する直感型"],
    management: ["直感の根拠を最低限可視化し勢いが要る局面で活かす"],
  },
};

// Top5 => StrengthProfile を生成（型: perTheme 配列 / summarized* 配列）
export function computeStrengthProfileFromTop5(
  top5: string[]
): StrengthProfile {
  // perTheme は配列
  const perTheme: StrengthProfile["perTheme"] = [];
  const picked: PersonaEntry[] = [];

  for (const s of top5) {
    const entry = STRENGTH_PERSONA[s];
    if (entry) {
      perTheme.push({
        theme: s,
        traits: entry.traits.slice(0, 4),
        management: entry.management.slice(0, 4),
      });
      picked.push(entry);
    }
  }

  const dedup = (arr: string[]) => Array.from(new Set(arr));
  const summarizedTraits = dedup(picked.flatMap((x) => x.traits)).slice(0, 6);
  const summarizedManagement = dedup(picked.flatMap((x) => x.management)).slice(
    0,
    6
  );

  // StrengthProfile には summary フィールドが無い前提で返却
  return { summarizedTraits, summarizedManagement, perTheme };
}

export { computeStrengthProfileFromTop5 as buildStrengthProfile };
