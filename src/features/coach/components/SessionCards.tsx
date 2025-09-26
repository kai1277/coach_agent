import React from "react";
import type { SessionGetResponse, StrengthProfile } from "../../../types/api";

// シンプルなカード
const Card: React.FC<{
  title: string;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode; // ← children を受ける
}> = ({ title, actions, className = "", children }) => (
  <section className={`border p-3 mb-4 ${className}`}>
    <header className="flex items-center justify-between mb-2">
      <h2 className="font-bold">{title}</h2>
      {actions}
    </header>
    <div>{children}</div>
  </section>
);

// ストレングス・カード
const PersonaCard: React.FC<{ persona: StrengthProfile }> = ({ persona }) => {
  return (
    <Card title="ストレングス（ベータ）">
      {/* 要約（Traits / Management をコンパクトに） */}
      {persona.summarizedTraits?.length ? (
        <>
          <div className="text-sm font-semibold mb-1">特徴</div>
          <ul className="list-disc pl-5 mb-3">
            {persona.summarizedTraits.map((t, i) => (
              <li key={`trait-${i}`}>{t}</li>
            ))}
          </ul>
        </>
      ) : null}

      {persona.summarizedManagement?.length ? (
        <>
          <div className="text-sm font-semibold mb-1">マネジメント</div>
          <ul className="list-disc pl-5 mb-3">
            {persona.summarizedManagement.map((m, i) => (
              <li key={`mgmt-${i}`}>{m}</li>
            ))}
          </ul>
        </>
      ) : null}

      {/* 資質ごとの詳細 */}
      {persona.perTheme?.length ? (
        <>
          <div className="text-sm font-semibold mb-1">資質別の示唆</div>
          <div className="grid md:grid-cols-2 gap-3">
            {persona.perTheme.map((row, idx) => (
              <div key={row.theme + idx} className="border rounded p-2">
                <div className="font-semibold mb-1">{row.theme}</div>
                <div className="text-xs font-semibold">特徴</div>
                <ul className="list-disc pl-5 mb-2">
                  {row.traits.map((t, i) => (
                    <li key={`${row.theme}-t-${i}`}>{t}</li>
                  ))}
                </ul>
                <div className="text-xs font-semibold">マネジメント</div>
                <ul className="list-disc pl-5">
                  {row.management.map((m, i) => (
                    <li key={`${row.theme}-m-${i}`}>{m}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </Card>
  );
};

const SessionCards: React.FC<{ data: SessionGetResponse }> = ({ data }) => {
  const out = data.output;

  return (
    <div>
      {/* 既存の要約/仮説/反証/引用/次の一歩 などのカードがここに並んでいる想定 */}

      {/* ★ これを既存カードの好きな位置に追加（例：タイプ推定カードの上） */}
      {out.persona ? <PersonaCard persona={out.persona} /> : null}

      {/* 既存の「タイプ推定（ベータ）」や Q/A ループ設定 UI … */}
    </div>
  );
};

function StrengthPersonaCard({
  persona,
}: {
  persona?: {
    summarizedTraits: string[];
    summarizedManagement: string[];
    perTheme: { theme: string; traits: string[]; management: string[] }[];
  };
}) {
  if (!persona) return null;

  return (
    <Card title="ストレングス：特徴とマネジメント" className="bg-white">
      {/* サマリ（上部に凝縮表示） */}
      {persona.summarizedTraits?.length > 0 && (
        <>
          <h3 className="font-semibold mt-2 mb-1">特徴（サマリ）</h3>
          <ul className="list-disc pl-6">
            {persona.summarizedTraits.map((t, i) => (
              <li key={`traits-${i}`}>{t}</li>
            ))}
          </ul>
        </>
      )}

      {persona.summarizedManagement?.length > 0 && (
        <>
          <h3 className="font-semibold mt-3 mb-1">マネジメント（サマリ）</h3>
          <ul className="list-disc pl-6">
            {persona.summarizedManagement.map((m, i) => (
              <li key={`mgmt-${i}`}>{m}</li>
            ))}
          </ul>
        </>
      )}

      {/* 資質ごとの詳細 */}
      {persona.perTheme?.length > 0 && (
        <>
          <h3 className="font-semibold mt-3 mb-2">資質ごとのヒント</h3>
          <div className="grid md:grid-cols-2 gap-3">
            {persona.perTheme.map((p) => (
              <div key={p.theme} className="border p-2 rounded">
                <div className="font-semibold mb-1">{p.theme}</div>
                {p.traits?.length > 0 && (
                  <>
                    <div className="text-sm font-medium mt-1">特徴</div>
                    <ul className="list-disc pl-5 text-sm">
                      {p.traits.map((t, i) => (
                        <li key={`${p.theme}-t-${i}`}>{t}</li>
                      ))}
                    </ul>
                  </>
                )}
                {p.management?.length > 0 && (
                  <>
                    <div className="text-sm font-medium mt-2">マネジメント</div>
                    <ul className="list-disc pl-5 text-sm">
                      {p.management.map((m, i) => (
                        <li key={`${p.theme}-m-${i}`}>{m}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

export default SessionCards;
