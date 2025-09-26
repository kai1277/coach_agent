import React from "react";
import type { StrengthProfile } from "../../../types/api";

export default function StrengthPersonaCard({
  persona,
}: {
  persona?: StrengthProfile;
}) {
  if (!persona) return null;

  return (
    <section className="border p-3 mb-4 bg-white rounded">
      <header className="flex items-center justify-between mb-2">
        <h2 className="font-bold">ストレングス：特徴とマネジメント</h2>
      </header>

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

      {persona.perTheme?.length > 0 && (
        <>
          <h3 className="font-semibold mt-3 mb-2">資質ごとのヒント</h3>
          <div className="grid md:grid-cols-2 gap-3">
            {persona.perTheme.map((p, idx) => (
              <div key={`${p.theme}-${idx}`} className="border p-2 rounded">
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
    </section>
  );
}
