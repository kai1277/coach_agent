import { useEffect, useMemo, useRef, useState } from "react";
import { useCreateSession } from "../api/useCreateSession";
// import { useNextStep } from "../api/useNextStep";
import { STRENGTH_THEMES, type StrengthTheme } from "../constants/strengths";
import { SkeletonBlock } from "../../../ui/Skeleton";
import { useToast } from "../../../ui/ToastProvider";
import { useSearchParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { useLoadSession } from "../api/useLoadSession";
import IdentityPicker, {
  type IdentityValue,
} from "../components/IdentityPicker";
import type {
  Demographics,
  StrengthProfile,
  Answer5,
} from "../../../types/api";
import { api } from "../../../lib/apiClient";
import { useQueryClient } from "@tanstack/react-query";
// import AnswerLog from "../../session/components/AnswerLog";
import { useTurns } from "../../session/hooks/useTurns";

type LoopQuestion = { id: string; text: string };
type Posterior = Record<
  | "TYPE_STRATEGY"
  | "TYPE_EMPATHY"
  | "TYPE_EXECUTION"
  | "TYPE_ANALYTICAL"
  | "TYPE_STABILITY",
  number
>;
type EvidenceItem = {
  questionId: string;
  text: "YES" | "PROB_YES" | "UNKNOWN" | "PROB_NO" | "NO" extends infer A
    ? string
    : never;
  answer: "YES" | "PROB_YES" | "UNKNOWN" | "PROB_NO" | "NO";
  delta: number;
};

type LoopFetch =
  | {
      done: false;
      question: LoopQuestion | null;
      progress: { asked: number; max: number };
      hint: { topLabel: string; confidence: number };
      posterior: Posterior;
      /** ★ 生成トレースID（HITL投稿に使う） */
      trace_id?: string | null;
    }
  | {
      done: true;
      top: { id: string; label: string; confidence: number };
      next_steps: string[];
      asked: number;
      max: number;
      posterior: Posterior;
      evidence: EvidenceItem[];
      persona_statement?: string;
    };

type SessionOutput = {
  summary: string | null;
  hypotheses?: string[];
  next_steps?: string[];
  citations?: { text: string; anchor: string }[];
  counter_questions?: string[];
  persona?: StrengthProfile;
};
type SessionDTO = {
  id: string;
  createdAt?: string;
  output?: SessionOutput; // 旧形のため optional
  next_steps?: string[]; // 新形のため optional
  plan?: { next_steps?: string[] };
  seed_questions?: string[];
  persona?: StrengthProfile;
  summary?: string | null;
  metadata?: any;
  loop?: { threshold: number; maxQuestions: number; minQuestions?: number };
};

// 種質問の型
type SeedQuestion = { id: string; theme: string; text: string };

type NextStepAsk = {
  type: "ASK";
  question_id?: string;
  text: string;
  goal?: string;
};

type NextStepConclude = {
  type: "CONCLUDE";
  summary: string;
  management: { do: string[]; dont: string[] };
  next_week_plan?: string[];
};

type NextStep = NextStepAsk | NextStepConclude;

type LoopFetchNew =
  | {
      done: false;
      asked: number;
      posterior: any;
      metadata: { next_step: NextStepAsk };
    }
  | {
      done: true;
      asked: number;
      posterior: any;
      metadata: { next_step: NextStepConclude };
    };

const LS_KEY = "coach_session_id";
const ANSWER_LABEL: Record<
  "YES" | "PROB_YES" | "UNKNOWN" | "PROB_NO" | "NO",
  string
> = {
  YES: "はい",
  PROB_YES: "たぶんはい",
  UNKNOWN: "わからない",
  PROB_NO: "たぶんいいえ",
  NO: "いいえ",
};

function identityToDemographics(v: IdentityValue): Demographics {
  const anyv = v as any;
  const ageLike = anyv.ageRange ?? anyv.age ?? null;
  const genderLike = anyv.gender ?? null;
  const hometownRaw = anyv.hometown ?? anyv.home ?? anyv.birthplace ?? "";

  return {
    ageRange: ageLike ?? undefined,
    gender: genderLike ? String(genderLike) : undefined,
    hometown:
      typeof hometownRaw === "string" && hometownRaw.trim()
        ? hometownRaw.trim()
        : undefined,
  };
}

/** レスポンス形の揺れを吸収して共通形に揃える */
function normalizeSession(raw: any) {
  if (!raw || typeof raw !== "object") {
    return {
      id: undefined,
      next_steps: [],
      plan: { next_steps: [] },
      seed_questions: [],
      persona: undefined,
      summary: null,
      metadata: {},
    };
  }

  // 旧形：{ output: { next_steps, persona, ... } }
  if ("output" in raw && raw.output) {
    const out = raw.output ?? {};
    const next_steps = Array.isArray(out.next_steps) ? out.next_steps : [];
    const plan = {
      next_steps: Array.isArray(out.next_steps) ? out.next_steps : [],
    };
    return {
      id: raw.id,
      next_steps,
      plan,
      seed_questions: Array.isArray(raw.seed_questions)
        ? raw.seed_questions
        : [],
      persona: out.persona,
      summary: "summary" in out ? out.summary ?? null : raw.summary ?? null,
      metadata: raw.metadata ?? {},
      loop: raw.loop,
    };
  }

  // 新形：{ id, next_steps, plan?.next_steps, seed_questions, ... }
  const next_steps = Array.isArray(raw.next_steps)
    ? raw.next_steps
    : Array.isArray(raw.plan?.next_steps)
    ? raw.plan.next_steps
    : [];
  const plan = {
    next_steps: Array.isArray(raw.plan?.next_steps)
      ? raw.plan.next_steps
      : next_steps,
  };
  return {
    id: raw.id,
    next_steps,
    plan,
    seed_questions: Array.isArray(raw.seed_questions) ? raw.seed_questions : [],
    persona: raw.persona,
    summary: "summary" in raw ? raw.summary ?? null : null,
    metadata: raw.metadata ?? {},
    loop: raw.loop,
  };
}

// ===== Loop response helpers =====
function isOldAsk(x: any): x is Extract<LoopFetch, { done: false }> {
  return x && x.done === false && "question" in x;
}
function isOldDone(x: any): x is Extract<LoopFetch, { done: true }> {
  return x && x.done === true && "next_steps" in x && !("metadata" in x);
}
function isNewAsk(x: any): x is Extract<LoopFetchNew, { done: false }> {
  return x && x.done === false && x.metadata?.next_step?.type === "ASK";
}
function isNewDone(x: any): x is Extract<LoopFetchNew, { done: true }> {
  return x && x.done === true && x.metadata?.next_step?.type === "CONCLUDE";
}

/** 共通化：現在の質問ID/本文を取得（なければ null） */
function getCurrentQuestion(
  ls: LoopFetch | LoopFetchNew | null
): { id?: string; text?: string } | null {
  if (!ls) return null;
  if (isOldAsk(ls) && ls.question)
    return { id: ls.question.id, text: ls.question.text };
  if (isNewAsk(ls))
    return {
      id: ls.metadata.next_step.question_id,
      text: ls.metadata.next_step.text,
    };
  return null;
}

/** 共通化：進捗 asked / max を取得（max は推定も可） */
function getProgress(
  ls: LoopFetch | LoopFetchNew | null,
  fallbackMax?: number
) {
  if (!ls) return { asked: 0, max: fallbackMax ?? 0 };
  if (isOldAsk(ls)) return { asked: ls.progress.asked, max: ls.progress.max };
  if (isOldDone(ls)) return { asked: ls.asked, max: ls.max };
  if ("asked" in ls)
    return { asked: (ls as any).asked ?? 0, max: fallbackMax ?? 0 };
  return { asked: 0, max: fallbackMax ?? 0 };
}

export default function SessionPage() {
  const navigate = useNavigate();

  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const showToast = useToast();

  // Top5
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<StrengthTheme[]>([]);
  const canAddMore = selected.length < 5;
  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return STRENGTH_THEMES;
    return STRENGTH_THEMES.filter((t) => t.includes(q));
  }, [query]);

  // デモグラ（任意）
  const [identity, setIdentity] = useState<IdentityValue>({} as IdentityValue);

  const create = useCreateSession();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<SessionDTO | null>(null);

  // null を undefined に正規化して渡す（hook 側の型と一致させる）
  // const advance = useNextStep(sessionId ?? null);
  // const [refineText, setRefineText] = useState("");

  const [timeToFirst, setTimeToFirst] = useState<number | null>(null);
  const [t0, setT0] = useState<number | null>(null);

  // 質問ループ
  const [loopStarted, setLoopStarted] = useState(false);
  const [loopBusy, setLoopBusy] = useState(false);
  const [loopError, setLoopError] = useState<string | null>(null);
  const [loopState, setLoopState] = useState<(LoopFetch | LoopFetchNew) | null>(
    null
  );

  // URL パラメータから復元
  const [sp, setSp] = useSearchParams();
  const sessionFromUrl = sp.get("session");
  const { data: restored } = useLoadSession(sessionFromUrl);

  const qc = useQueryClient();
  const { data: turns = [], isFetching: turnsLoading } = useTurns(
    sessionId ?? undefined
  );

  const [answerInput, setAnswerInput] = useState("");
  const [selectedChoice, setSelectedChoice] = useState<Answer5 | null>(null);

  const [list, setList] = useState<
    Array<{ id: string; title?: string | null; created_at: string }>
  >([]);
  useEffect(() => {
    (async () => {
      try {
        const rows = await api.sessions.list({ limit: 20 });
        const arr = Array.isArray((rows as any)?.sessions)
          ? (rows as any).sessions
          : Array.isArray(rows)
          ? rows
          : [];
        setList(arr);
      } catch (e) {
        console.warn("failed to load sessions list", e);
        setList([]);
      }
    })();
  }, [sessionId]);


  const chatMessages = useMemo(() => {
    const messages: Array<{
      id: string;
      role: "assistant" | "user";
      text: string;
      createdAt?: string;
      pending?: boolean;
      questionId?: string;
    }> = [];

    (turns ?? []).forEach((t: any) => {
      const c = t?.content ?? {};
      if (
        t.role === "assistant" &&
        c?.type === "question" &&
        typeof c?.text === "string" &&
        c.text.trim().length > 0
      ) {
        messages.push({
          id: t.id,
          role: "assistant",
          text: String(c.text),
          createdAt: t.created_at,
          questionId: c.question_id ?? undefined,
        });
      } else if (t.role === "user" && c?.type === "answer") {
        const textFromContent =
          typeof c.answer_text === "string" && c.answer_text.trim().length > 0
            ? c.answer_text.trim()
            : null;
        const labelFromChoice =
          typeof c.answer === "string"
            ? ANSWER_LABEL[c.answer as Answer5] ?? String(c.answer)
            : "";
        const msgText = textFromContent ?? labelFromChoice;
        if (msgText) {
          messages.push({
            id: t.id,
            role: "user",
            text: msgText,
            createdAt: t.created_at,
            questionId: c.question_id ?? undefined,
          });
        }
      }
    });

    const current = getCurrentQuestion(loopState);
    if (
      current?.id &&
      !messages.some(
        (m) => m.role === "assistant" && m.questionId === current.id
      ) &&
      (current.text?.trim() ?? "").length > 0
    ) {
      messages.push({
        id: `pending-${current.id}`,
        role: "assistant",
        text: current.text ?? "",
        pending: true,
        questionId: current.id,
      });
    }

    return messages;
  }, [turns, loopState]);

  // 復元 → 正規化して保持
  useEffect(() => {
    if (!restored) return;
    const norm = normalizeSession(restored as any);
    setSessionId(norm.id);
    setSessionData(norm as any);
    localStorage.setItem(LS_KEY, norm.id);
  }, [restored]);

  useEffect(() => {
    setLoopStarted(false);
    setLoopState(null);
    setLoopError(null);
  }, [sessionId]);

  // セッション開始
  const onStart = async () => {
    const fallback =
      "（自動生成ログ）Top5と基本属性から初期セッションを開始します。";
    const autoTranscript =
      selected.length > 0
        ? `Top5: ${selected.join("、")} に基づく初期セッションメモです。`
        : fallback;
    const transcript = autoTranscript.length >= 20 ? autoTranscript : fallback;

    const d = identityToDemographics(identity);
    const demographics = d.ageRange || d.gender || d.hometown ? d : undefined;

    setT0(performance.now());

    try {
      const s = await create.mutateAsync({
        transcript,
        strengths_top5: selected.length ? selected : undefined,
        demographics,
      } as any);

      const norm = normalizeSession(s as any);

      // state & localStorage 反映
      setSessionId(norm.id);
      setSessionData(norm as any);
      localStorage.setItem(LS_KEY, norm.id);

      if (t0 !== null) setTimeToFirst(Math.round(performance.now() - t0));

      showToast("セッションを開始しました", { type: "success" });

      // ★ ここで遷移（クエリ方式）
      navigate(`/app/coach?session=${norm.id}`, { replace: true });

      setLoopStarted(true);
      await fetchNext();
    } catch (e: any) {
      showToast(`開始に失敗：${String(e?.message || e)}`, { type: "error" });
    }
  };

  // 次の質問を取得（診断ループ）
  const fetchNext = async () => {
    if (!sessionId) return;
    setLoopBusy(true);
    setLoopError(null);
    try {
      const data = await api.sessions.getNext(sessionId);
      setLoopState(data as any);
      setAnswerInput("");
      setSelectedChoice(null);
      qc.invalidateQueries({ queryKey: ["turns", sessionId] });
      setTimeout(() => messageInputRef.current?.focus(), 0);
    } catch (e: any) {
      const msg = String(e?.message || e);
      setLoopError(msg);
      showToast(`質問取得エラー：${msg}`, { type: "error" });
    } finally {
      setLoopBusy(false);
    }
  };

  // 回答送信
  const answer = async ({
    questionId,
    text,
    choice,
  }: {
    questionId: string;
    text?: string;
    choice?: Answer5 | null;
  }) => {
    if (!sessionId) return;
    setLoopBusy(true);
    setLoopError(null);
    try {
      const trimmed = text?.trim() ?? "";
      const data = await api.sessions.answer(sessionId, {
        questionId,
        answer: choice ?? "UNKNOWN",
        answerText: trimmed || undefined,
      });
      setLoopState(data as any);
      // 回答ログとセッションの最新化
      qc.invalidateQueries({ queryKey: ["turns", sessionId] });
      qc.invalidateQueries({ queryKey: ["session", sessionId] });

      if ((data as any).done) {
        showToast("推定が確定しました", { type: "success" });
      }
      // サーバーから次の質問も含めて返ってくるので、fetchNext()は不要
      setAnswerInput("");
      setSelectedChoice(null);
      setTimeout(() => messageInputRef.current?.focus(), 0);
    } catch (e: any) {
      const msg = String(e?.message || e);
      setLoopError(msg);
      showToast(`回答エラー：${msg}`, { type: "error" });
    } finally {
      setLoopBusy(false);
    }
  };

  const submitCurrentAnswer = async (questionId?: string | null) => {
    if (!questionId || loopBusy) return;
    const trimmed = answerInput.trim();
    if (!trimmed && !selectedChoice) {
      showToast("回答を入力してください", { type: "info" });
      return;
    }
    await answer({
      questionId,
      text: trimmed,
      choice: selectedChoice ?? undefined,
    });
  };

  // 取り消し
  const undo = async () => {
    if (!sessionId) return;
    setLoopBusy(true);
    setLoopError(null);
    try {
      const data = await api.sessions.undo(sessionId);
      setLoopState(data as any);
      showToast("直前の回答を取り消しました", { type: "info" });
      // 取り消し後のログとセッションの最新化
      qc.invalidateQueries({ queryKey: ["turns", sessionId] });
      qc.invalidateQueries({ queryKey: ["session", sessionId] });
      setAnswerInput("");
      setSelectedChoice(null);
      setTimeout(() => messageInputRef.current?.focus(), 0);
    } catch (e: any) {
      const msg = String(e?.message || e);
      setLoopError(msg);
      showToast(`取り消しエラー：${msg}`, { type: "error" });
    } finally {
      setLoopBusy(false);
    }
  };

  // クリア
  const resetAll = () => {
    setSessionId(null);
    setSessionData(null);
    localStorage.removeItem(LS_KEY);
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("session");
        return next;
      },
      { replace: true }
    );
    setLoopStarted(false);
    setLoopState(null);
    setLoopError(null);
    // setRefineText("");
    setAnswerInput("");
    setSelectedChoice(null);
    setTimeToFirst(null);
    setSelected([]);
    setQuery("");
    setIdentity({} as IdentityValue);
    create.reset();
    // advance.reset();
    showToast("セッションをクリアしました", { type: "info" });
  };

  const PersonaView = ({ profile }: { profile: StrengthProfile }) => {
    return (
      <div className="space-y-4">
        {(profile.summarizedTraits?.length ||
          profile.summarizedManagement?.length) && (
          <div className="grid sm:grid-cols-2 gap-3">
            {profile.summarizedTraits?.length ? (
              <div className="p-3 border rounded">
                <div className="font-medium mb-1">あなたの特徴（要点）</div>
                <ul className="list-disc pl-5">
                  {profile.summarizedTraits.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {profile.summarizedManagement?.length ? (
              <div className="p-3 border rounded">
                <div className="font-medium mb-1">効果的なマネジメント</div>
                <ul className="list-disc pl-5">
                  {profile.summarizedManagement.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        {profile.perTheme?.length ? (
          <div className="space-y-3">
            {profile.perTheme.map((t) => (
              <div key={t.theme} className="p-3 border rounded">
                <div className="font-semibold mb-1">{t.theme}</div>
                {t.traits?.length ? (
                  <div className="mb-2">
                    <div className="text-sm text-gray-600">特徴</div>
                    <ul className="list-disc pl-5">
                      {t.traits.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {t.management?.length ? (
                  <div>
                    <div className="text-sm text-gray-600">マネジメント</div>
                    <ul className="list-disc pl-5">
                      {t.management.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  // 以降は正規化済みのセッションを参照
  const safeSession = normalizeSession(sessionData ?? create.data ?? null);
  const safeNextSteps =
    safeSession.next_steps ?? safeSession.plan?.next_steps ?? [];
  const personaSafe = safeSession.persona;

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-6">
      <h1 className="text-2xl font-bold">
        Coach セッション (MVP){" "}
        <span title="Top5→軽い事前確率→質問で更新→確信度で確定">ℹ️</span>
      </h1>

      {/* ===== 初期入力 ===== */}
      {!sessionId && (
        <div className="space-y-3" aria-busy={create.isPending}>
          <section className="space-y-2">
            <h2 className="font-medium">基本属性（任意）</h2>
            <IdentityPicker value={identity} onChange={setIdentity} />
          </section>

          {/* Top5 選択 */}
          <div className="space-y-2">
            <div className="flex items-end justify-between gap-2">
              <label className="font-medium">
                ストレングスTop5（最大5つまで・任意）
              </label>
              <div className="text-sm text-gray-600">
                {selected.length}/5 選択
              </div>
            </div>
            <input
              aria-label="資質検索"
              className="w-full rounded border p-2"
              placeholder="資質名で絞り込み（例：戦略性）"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-auto border rounded p-2">
              {filtered.map((theme) => {
                const checked = selected.includes(theme);
                const disabled = !checked && !canAddMore;
                return (
                  <label
                    key={theme}
                    className={`flex items-center gap-2 ${
                      disabled ? "opacity-50" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={(e) => {
                        if (e.target.checked) {
                          if (selected.length < 5)
                            setSelected([...selected, theme]);
                        } else {
                          setSelected(selected.filter((t) => t !== theme));
                        }
                      }}
                    />
                    <span>{theme}</span>
                  </label>
                );
              })}
            </div>
            {!!selected.length && (
              <div className="flex flex-wrap gap-2">
                {selected.map((s) => (
                  <button
                    key={s}
                    className="px-2 py-1 rounded border"
                    onClick={() => setSelected(selected.filter((t) => t !== s))}
                  >
                    {s} ×
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              aria-label="セッション開始"
              className="rounded bg-black text-white px-4 py-2 disabled:opacity-50"
              disabled={create.isPending}
              onClick={onStart}
            >
              {create.isPending ? "生成中…" : "開始"}
            </button>
          </div>

          {create.isPending && (
            <div className="mt-2">
              <SkeletonBlock lines={4} />
            </div>
          )}

          {create.isError && (
            <pre className="text-sm text-red-600">
              {String((create.error as any)?.message || "エラーが発生しました")}
            </pre>
          )}
        </div>
      )}

      {/* 最近のセッション */}
      {!sessionId && (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">最近のセッション</h2>

          {!Array.isArray(list) || list.length === 0 ? (
            <div className="text-sm text-gray-500">まだありません</div>
          ) : (
            <ul className="space-y-2">
              {list.map((s) => (
                <li
                  key={s.id}
                  className="p-2 border rounded flex items-center justify-between"
                >
                  <div>
                    <div className="font-medium">{s.title || "(no title)"}</div>
                    <div className="text-xs text-gray-500">
                      {new Date(s.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="underline text-sm"
                      onClick={() => navigate(`/app/coach?session=${s.id}`)}
                    >
                      開く
                    </button>
                    <button
                      className="text-red-600 underline text-sm"
                      onClick={async () => {
                        if (!confirm("削除しますか？")) return;
                        await api.sessions.remove(s.id);
                        setList((prev) =>
                          Array.isArray(prev)
                            ? prev.filter((x) => x.id !== s.id)
                            : []
                        );
                        if (sessionId === s.id) resetAll();
                      }}
                    >
                      削除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ===== 初回結果 ===== */}
      {sessionId && (sessionData || create.data) && (
        <div className="space-y-4">
          <div className="text-sm text-gray-600">
            セッションID: <code>{sessionId}</code>
            {timeToFirst !== null && <span> / 初回出力: {timeToFirst} ms</span>}
            <button
              className="ml-2 px-2 py-1 border rounded text-xs hover:bg-gray-50"
              onClick={() => {
                if (!sessionId) return;
                const url = `${window.location.origin}/app/coach?session=${sessionId}`;
                navigator.clipboard.writeText(url).then(
                  () =>
                    showToast("共有リンクをコピーしました", {
                      type: "success",
                    }),
                  () =>
                    (window as any).prompt?.(
                      "以下のURLを手動でコピーしてください。",
                      url
                    )
                );
              }}
              disabled={!sessionId}
              aria-label="共有リンクをコピー"
            >
              共有リンクをコピー
            </button>
          </div>

          {/* 要約（サーバ永続） */}
          {sessionId && safeSession.summary?.trim() && (
            <section className="space-y-2">
              <h2 className="text-xl font-semibold">要約</h2>
              <div className="rounded border p-3 whitespace-pre-wrap">
                {safeSession.summary}
              </div>
            </section>
          )}

          {/* 次の一歩 */}
          {/*
          <section className="space-y-2">
            <h2 className="text-xl font-semibold">次の一歩</h2>
            <ul className="pl-0">
              {safeNextSteps.map((s: string, i: number) => (
                <li key={i} className="list-none">
                  <button
                    className="underline rounded px-1 py-0.5 hover:bg-gray-100"
                    onClick={() => {
                      navigator.clipboard?.writeText(s).then(
                        () => showToast("コピーしました", { type: "success" }),
                        () =>
                          showToast("コピーできませんでした", { type: "error" })
                      );
                    }}
                    aria-label={`次の一歩をコピー：${s}`}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          */}

          {/* 回答履歴（turns） */}
          {/*
          {turns.length === 0 ? (
            <div className="text-sm text-gray-500">まだ回答はありません</div>
          ) : (
            <AnswerLog turns={turns} />
          )}
          */}
        </div>
      )}

      {/* ストレングス（ベータ） */}
      {sessionId && (sessionData || create.data) && personaSafe && (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">ストレングス（ベータ）</h2>
          <PersonaView profile={personaSafe} />
        </section>
      )}

      {/* 追加指示 */}
      {/*
      {sessionId && (
        <section className="space-y-2">
          <h3 className="font-medium">
            追加の指示で更新{" "}
            <span title="要約の先頭に【更新】を追記し、次の一歩の先頭を差し替えます">
              ℹ️
            </span>
          </h3>
          <div className="flex gap-2">
            <input
              aria-label="追加指示"
              className="flex-1 rounded border p-2"
              placeholder="例：面接準備向けにSTARで要約して"
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
            />
            <button
              aria-label="更新を送信"
              className="rounded border px-3 py-2"
              onClick={async () => {
                try {
                  const s = await advance.mutateAsync(refineText);
                  const norm = normalizeSession(s as any);
                  setSessionData(norm as any);
                  setRefineText("");
                  showToast("更新しました", { type: "success" });
                  if (sessionId) {
                    qc.invalidateQueries({ queryKey: ["session", sessionId] });
                    qc.invalidateQueries({ queryKey: ["turns", sessionId] });
                  }
                } catch {}
              }}
              disabled={advance.isPending || !refineText}
            >
              {advance.isPending ? "送信中…" : "更新"}
            </button>
            <button
              aria-label="クリア"
              className="rounded border px-3 py-2"
              onClick={resetAll}
            >
              クリア
            </button>
          </div>
          {advance.isError && (
            <pre className="text-red-600 text-sm">
              {String((advance.error as any)?.message || "更新に失敗しました")}
            </pre>
          )}
        </section>
      )}
      */}

      {/* タイプ推定（ベータ） */}
      {sessionId && (
        <section className="space-y-4 border rounded p-3" aria-live="polite">
          {!loopStarted && (
            <button
              className="rounded bg-black text-white px-4 py-2"
              onClick={async () => {
                setLoopStarted(true);
                await fetchNext(); // 初手＝統合初期質問が出る
              }}
            >
              診断を開始
            </button>
          )}

          {loopStarted &&
            loopState &&
            "done" in loopState &&
            loopState.done === false &&
            (() => {
              const prog = getProgress(
                loopState,
                safeSession.loop?.maxQuestions ?? 0
              );
              const curQ = getCurrentQuestion(loopState);

              return (
                <div className="space-y-3" aria-busy={loopBusy}>
                  <div className="text-sm text-gray-600">
                    進捗: {prog.asked}/{prog.max || "—"}
                  </div>

                  <div className="rounded-lg border overflow-hidden flex flex-col bg-white">
                    <div className="flex-1 overflow-y-auto space-y-3 p-3 bg-gray-50">
                      {turnsLoading ? (
                        <div className="text-sm text-gray-500">
                          履歴を読み込んでいます…
                        </div>
                      ) : chatMessages.length === 0 ? (
                        <div className="text-sm text-gray-500">
                          最初の質問を準備しています。少々お待ちください。
                        </div>
                      ) : (
                        chatMessages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`flex ${
                              msg.role === "assistant"
                                ? "justify-start"
                                : "justify-end"
                            }`}
                          >
                            <div
                              className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm shadow-sm ${
                                msg.role === "assistant"
                                  ? "bg-white border"
                                  : "bg-black text-white"
                              }`}
                            >
                              <div>{msg.text}</div>
                              {msg.pending && !msg.createdAt ? (
                                <div className="mt-1 text-[10px] text-gray-400">
                                  送信準備中…
                                </div>
                              ) : null}
                              {msg.createdAt ? (
                                <div
                                  className={`mt-1 text-[10px] ${
                                    msg.role === "assistant"
                                      ? "text-gray-400"
                                      : "text-white/70"
                                  }`}
                                >
                                  {new Date(msg.createdAt).toLocaleTimeString()}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <form
                      className="border-t bg-white p-3 space-y-2"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        await submitCurrentAnswer(curQ?.id);
                      }}
                    >
                      <div>
                        <div className="text-xs text-gray-500 mb-1">現在の質問</div>
                        <div className="text-sm font-medium text-gray-800">
                          {curQ?.text || "（取得中）"}
                        </div>
                      </div>
                      <textarea
                        ref={messageInputRef}
                        className="w-full rounded-lg border p-2 text-sm focus:outline-none focus:ring-2 focus:ring-black min-h-[96px] resize-vertical disabled:opacity-50"
                        placeholder="自由に回答を入力してください。Shift+Enterで改行、Enterで送信できます。"
                        value={answerInput}
                        onChange={(e) => setAnswerInput(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            await submitCurrentAnswer(curQ?.id);
                          }
                        }}
                        disabled={loopBusy || !curQ?.id}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-gray-500">クイック返信:</span>
                        {(Object.entries(ANSWER_LABEL) as Array<[
                          Answer5,
                          string,
                        ]>).map(([key, label]) => (
                          <button
                            type="button"
                            key={key}
                            className={`rounded-full border px-3 py-1 text-xs transition ${
                              selectedChoice === key
                                ? "bg-black text-white border-black"
                                : "bg-white text-gray-700 hover:bg-gray-100"
                            } disabled:opacity-50`}
                            disabled={loopBusy}
                            onClick={() =>
                              setSelectedChoice((prev) =>
                                prev === key ? null : key
                              )
                            }
                          >
                            {label}
                          </button>
                        ))}
                        {selectedChoice && (
                          <button
                            type="button"
                            className="text-xs text-gray-500 underline"
                            onClick={() => setSelectedChoice(null)}
                            disabled={loopBusy}
                          >
                            選択をクリア
                          </button>
                        )}
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          className="rounded bg-black text-white px-4 py-2 disabled:opacity-50"
                          disabled={loopBusy || !curQ?.id}
                        >
                          {loopBusy ? "送信中…" : "送信"}
                        </button>
                      </div>
                    </form>
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    <button
                      className="rounded border px-3 py-2"
                      disabled={loopBusy}
                      onClick={fetchNext}
                    >
                      次の質問を取得
                    </button>
                    <button
                      className="rounded border px-3 py-2"
                      disabled={loopBusy}
                      onClick={undo}
                    >
                      直前の回答を取り消す
                    </button>
                    <button
                      className="rounded border px-3 py-1"
                      onClick={() =>
                        qc.invalidateQueries({ queryKey: ["turns", sessionId] })
                      }
                    >
                      ログの再読み込み
                    </button>
                  </div>

                  {loopError && (
                    <div className="text-sm text-red-600">{loopError}</div>
                  )}
                </div>
              );
            })()}

          {loopStarted &&
            loopState &&
            "done" in loopState &&
            loopState.done === true && (
              <div className="space-y-3">
                {(loopState as any).headline && (
                  <div className="text-lg font-semibold">
                    {(loopState as any).headline}
                  </div>
                )}

                {/* 新形式（CONCLUDE）：metadata.next_step を優先表示 */}
                {isNewDone(loopState) ? (
                  <>
                    <section className="space-y-3">
                      <div className="text-lg font-semibold">
                        あなたはこういう人です！
                      </div>
                      <div className="whitespace-pre-wrap rounded-xl bg-white/80 px-5 py-4 leading-relaxed shadow-sm">
                        {loopState.metadata.next_step.summary}
                      </div>
                    </section>

                    <div className="space-y-3">
                      <div className="text-lg font-semibold">やってみよう！</div>
                      <ul className="pl-0 space-y-3">
                        {(loopState.metadata.next_step.next_week_plan?.length
                          ? loopState.metadata.next_step.next_week_plan
                          : loopState.metadata.next_step.management?.do || []
                        ).map((s, i) => (
                          <li key={i} className="list-none">
                            <button
                              className="w-full text-left rounded-xl bg-white/80 px-5 py-3 text-base shadow-sm transition hover:bg-white"
                              onClick={() => {
                                navigator.clipboard?.writeText(s).then(
                                  () =>
                                    showToast("コピーしました", {
                                      type: "success",
                                    }),
                                  () =>
                                    showToast("コピーできませんでした", {
                                      type: "error",
                                    })
                                );
                              }}
                            >
                              {s}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {loopState.metadata.next_step.management?.dont?.length ? (
                      <div className="space-y-3">
                        <div className="text-lg font-semibold">避けたいこと</div>
                        <ul className="list-disc pl-6 text-sm leading-relaxed">
                          {loopState.metadata.next_step.management.dont.map(
                            (d, i) => (
                              <li key={i}>{d}</li>
                            )
                          )}
                        </ul>
                      </div>
                    ) : null}
                  </>
                ) : (
                  // 旧形式（互換）：persona_statement / next_steps
                  <>
                    {(loopState as any).persona_statement && (
                      <section className="space-y-3">
                        <div className="text-lg font-semibold">
                          あなたはこういう人です！
                        </div>
                        <div className="whitespace-pre-wrap rounded-xl bg-white/80 px-5 py-4 leading-relaxed shadow-sm">
                          {(loopState as any).persona_statement}
                        </div>
                      </section>
                    )}

                    <div className="space-y-3">
                      <div className="text-lg font-semibold">やってみよう！</div>
                      <ul className="pl-0 space-y-3">
                        {loopState.next_steps.map((s, i) => (
                          <li key={i} className="list-none">
                            <button
                              className="w-full text-left rounded-xl bg-white/80 px-5 py-3 text-base shadow-sm transition hover:bg-white"
                              onClick={() => {
                                navigator.clipboard?.writeText(s).then(
                                  () =>
                                    showToast("コピーしました", {
                                      type: "success",
                                    }),
                                  () =>
                                    showToast("コピーできませんでした", {
                                      type: "error",
                                    })
                                );
                              }}
                            >
                              {s}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}

                {/* 旧形式の根拠表示（互換表示） */}
                {(loopState as any).evidence?.length > 0 && (
                  <div className="space-y-1">
                    <div className="font-medium">
                      根拠の内訳（影響が大きかった回答）
                    </div>
                    <ul className="list-disc pl-6 text-sm">
                      {(loopState as any).evidence.map(
                        (e: EvidenceItem, i: number) => (
                          <li key={i}>
                            <span className="font-medium">Q:</span> {e.text} ／
                            <span className="font-medium">A:</span>{" "}
                            {ANSWER_LABEL[e.answer]} ／
                            <span className="text-gray-600">
                              確信度寄与: {(e.delta * 100).toFixed(1)}%
                            </span>
                          </li>
                        )
                      )}
                    </ul>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    className="rounded border px-3 py-2"
                    onClick={() => {
                      setLoopStarted(false);
                      setLoopState(null);
                    }}
                  >
                    もう一度診断する
                  </button>
                  <button
                    className="rounded border px-3 py-2"
                    onClick={resetAll}
                  >
                    セッションを終了
                  </button>
                </div>
              </div>
            )}
        </section>
      )}
    </div>
  );
}
