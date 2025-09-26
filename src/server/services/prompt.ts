type BuildPromptArgs = {
  transcript: string;
  context: string | null;
  strengths_top5: string[] | null;
  instruction?: string | null;
};

export function redactPII(text: string): string {
  // 雑ながら効果の高い基本マスク：メール、電話、URL
  const masked = text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[メール]")
    .replace(/\b(?:0\d{1,4}-\d{1,4}-\d{3,4}|\+?\d[\d\- ]{7,}\d)\b/g, "[電話]")
    .replace(/\bhttps?:\/\/\S+/gi, "[URL]");
  return masked;
}

export function buildCoachPrompt(args: BuildPromptArgs): string {
  const { transcript, context, strengths_top5, instruction } = args;
  const header = [
    "あなたはビジネスコーチです。以下の会話ログを要約し、仮説/次の一歩/確認質問を出力してください。",
    "出力は日本語、簡潔、箇条書き中心。",
  ].join("\n");

  const ctx = context ? `文脈: ${context}` : "文脈: (未指定)";
  const strengths = strengths_top5?.length
    ? `Top5: ${strengths_top5.join(", ")}`
    : "Top5: (未指定)";
  const ins = instruction ? `追加指示: ${instruction}` : "";

  const body = [
    `【入力メタ】`,
    ctx,
    strengths,
    ins,
    "",
    `【会話ログ（マスク済）】`,
    redactPII(transcript),
  ].join("\n");

  const rubric = [
    "【出力フォーマット】",
    "- 要約: 2〜3行",
    "- 仮説: 箇条書き3つ",
    "- 次の一歩: 箇条書き3つ（具体アクション）",
    "- 反証/カウンター質問: 箇条書き2つ",
  ].join("\n");

  return [header, "", body, "", rubric].join("\n");
}
