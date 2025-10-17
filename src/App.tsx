import React from "react";
import SessionCards from "./features/coach/components/SessionCards";
import HealthCheck from "./components/HealthCheck";

export default function App() {
  // 既に作成済みセッションIDを使う or 新規作成して紐づけてください
  const [sessionId, setSessionId] = React.useState<string | null>(null);

  const create = async () => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript:
          "上司との認識齟齬が続き、定例の目的が曖昧で動きにくい状況です。改善したい。",
        context: "仕事",
        strengths_top5: ["着想", "責任感", "ポジティブ", "慎重さ", "学習欲"],
      }),
    });
    const json = await res.json();
    setSessionId(json.id);
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      {/* 開発中だけ裏でヘルスチェック実行（UIには何も出ない） */}
      {import.meta.env.DEV && <HealthCheck />}

      <div className="flex gap-2">
        <button
          className="px-3 py-1.5 rounded-lg text-sm border hover:bg-gray-50"
          onClick={create}
        >
          セッション作成
        </button>
        {sessionId ? (
          <span className="text-sm text-gray-600">ID: {sessionId}</span>
        ) : null}
      </div>
      {sessionId ? (
        <SessionCards sessionId={sessionId} />
      ) : (
        <div>まずセッションを作成してください。</div>
      )}
    </div>
  );
}
