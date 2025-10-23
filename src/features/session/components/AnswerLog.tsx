import type { Turn } from "../../../types/api";

export default function AnswerLog({ turns }: { turns: Turn[] }) {
  const answers = (turns ?? []).filter((t) => t.content?.type === "answer");
  if (answers.length === 0) return null;

  return (
    <div className="mt-6 border rounded-lg p-4">
      <div className="font-semibold mb-2">回答履歴</div>
      <ul className="space-y-1 text-sm">
        {answers.map((t) => (
          <li key={t.id} className="flex items-center justify-between">
            <div className="truncate">
              <span className="opacity-70 mr-2">
                {new Date(t.created_at).toLocaleString()}
              </span>
              <span className="mr-1">QID: {t.content?.question_id ?? "-"}</span>
              <span className="inline-block px-2 py-0.5 border rounded">
                {String(t.content?.answer ?? "")}
              </span>
            </div>
            <code className="opacity-60">#{t.id.slice(0, 6)}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}
