import { describe, it, expect } from "vitest";

const BASE = "http://localhost";

async function jfetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { res, json };
}

describe("Coach MVP mock API", () => {
  it("422: 会話ログが短すぎるとバリデーションエラー", async () => {
    const { res, json } = await jfetch("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ transcript: "短すぎ" }),
    });
    expect(res.status).toBe(422);
    expect(json?.code).toBe("VALIDATION_ERROR");
  });

  it("201: セッション作成→設定変更→(Q/A×3で)確定→取り消し", async () => {
    // 1) セッション作成
    const create = await jfetch("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        transcript:
          "上司との認識齟齬が続き、定例の目的が曖昧で動きにくい状況です。改善したい。",
        context: "仕事",
        strengths_top5: ["戦略性", "調和性"], // 任意
      }),
    });
    expect(create.res.status).toBe(201);
    const id = create.json.id as string;
    expect(id).toMatch(/^sess_/);

    // 2) ループ設定：最大質問数=3（バリデーション内）
    const patched = await jfetch(`/api/sessions/${id}/loop`, {
      method: "PATCH",
      body: JSON.stringify({ maxQuestions: 3 }), // 2..12 が許容
    });
    expect(patched.res.status).toBe(200);
    expect(patched.json.ok).toBe(true);

    // 3) Q/A×3 回で done=true（上限で確定）
    for (let i = 0; i < 3; i++) {
      const next = await jfetch(`/api/sessions/${id}/questions/next`);
      expect(next.res.status).toBe(200);
      expect(next.json.done).toBe(false);
      const q = next.json.question;
      expect(q?.id).toMatch(/^Q\d+/);

      const ans = await jfetch(`/api/sessions/${id}/answers`, {
        method: "POST",
        body: JSON.stringify({ questionId: q.id, answer: "YES" }),
      });
      expect(ans.res.status).toBe(200);
      // 3回目の回答時点では done=true になる（最大質問数到達）
      if (i < 2) {
        expect(ans.json.done).toBe(false);
      } else {
        expect(ans.json.done).toBe(true);
        expect(ans.json.top?.label).toBeTruthy();
        expect(ans.json.next_steps?.length).toBeGreaterThan(0);
        expect(ans.json.posterior).toBeTruthy();
      }
    }

    // 4) 取り消しで in-progress に戻る（asked が 2 へ）
    const undo = await jfetch(`/api/sessions/${id}/answers/undo`, {
      method: "POST",
    });
    expect(undo.res.status).toBe(200);
    expect(undo.json.done).toBe(false);
    expect(undo.json.progress.asked).toBe(2);
  });

  it("422: strengths_top5 は 5件まで & 候補外はエラー", async () => {
    const tooMany = await jfetch("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        transcript:
          "これは20文字以上のダミーテキストです。APIの検証に使います。",
        strengths_top5: [
          "戦略性",
          "戦略性",
          "戦略性",
          "戦略性",
          "戦略性",
          "戦略性",
        ], // 6件
      }),
    });
    expect(tooMany.res.status).toBe(422);

    const unknown = await jfetch("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        transcript:
          "これは20文字以上のダミーテキストです。APIの検証に使います。",
        strengths_top5: ["未知の資質"], // 候補外 → 422
      }),
    });
    expect(unknown.res.status).toBe(422);
  });

  it("201: strengths_top5 を渡すと persona が返る（要約と perTheme を最低限検証）", async () => {
    const created = await jfetch("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        transcript:
          "これは20文字以上の会話ログです。Top5 のペルソナ生成を検証します。",
        context: "仕事",
        strengths_top5: ["着想", "責任感", "ポジティブ", "慎重さ", "学習欲"],
      }),
    });
    expect(created.res.status).toBe(201);
    const id = created.json.id as string;

    const fetched = await jfetch(`/api/sessions/${id}`, { method: "GET" });
    expect(fetched.res.status).toBe(200);

    const persona = fetched.json?.output?.persona;
    expect(persona).toBeDefined();
    expect(Array.isArray(persona.perTheme)).toBe(true);
    expect(Array.isArray(persona.summarizedTraits)).toBe(true);
    expect(Array.isArray(persona.summarizedManagement)).toBe(true);
    expect(persona.perTheme.length).toBeGreaterThan(0);
  });
});

it("Coach MVP mock API > minQuestions で早期確定をブロックできる", async () => {
  // 1) セッション作成
  const created = await jfetch("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      transcript: "これは20文字以上ある会話ログです。最小質問数のテスト",
      context: "仕事",
    }),
  });
  expect(created.res.status).toBe(201);
  const id = created.json.id as string;

  // 2) 低しきい値 + minQuestions=2 に設定
  const patched = await jfetch(`/api/sessions/${id}/loop`, {
    method: "PATCH",
    body: JSON.stringify({ threshold: 0.99, maxQuestions: 2, minQuestions: 2 }),
  });
  expect(patched.res.status).toBe(200);
  expect(patched.json.ok).toBe(true);
  expect(patched.json.loop.minQuestions).toBe(2);

  // 3) 初回の質問取得（必ず done:false で質問が返る想定）
  const next1 = await jfetch(`/api/sessions/${id}/questions/next`);
  expect(next1.res.status).toBe(200);
  expect(next1.json.done).toBe(false);
  const q1 = next1.json.question;
  expect(q1?.id).toMatch(/^Q\d+/);

  // 4) 1問目に YES を回答 → minQuestions=2 なので、閾値に達していてもまだ done:false
  const ans1 = await jfetch(`/api/sessions/${id}/answers`, {
    method: "POST",
    body: JSON.stringify({ questionId: q1.id, answer: "YES" }),
  });
  expect(ans1.res.status).toBe(200);
  expect(ans1.json.done).toBe(false); // ★ ここがポイント

  // 5) 2問目を取得して回答（YES） → minQuestions 満たすので done:true（しきい値が低いので確定しやすい）
  const next2 = await jfetch(`/api/sessions/${id}/questions/next`);
  expect(next2.res.status).toBe(200);
  expect(next2.json.done).toBe(false);
  const q2 = next2.json.question;
  expect(q2?.id).toMatch(/^Q\d+/);

  const ans2 = await jfetch(`/api/sessions/${id}/answers`, {
    method: "POST",
    body: JSON.stringify({ questionId: q2.id, answer: "YES" }),
  });
  expect(ans2.res.status).toBe(200);
  // 閾値 or 質問上限 のいずれかを満たし、かつ minQuestions を超えたので確定
  expect(ans2.json.done).toBe(true);
});
