import { useEffect, useMemo, useRef, useState } from "react";
import { useCreateSession } from "../api/useCreateSession";
// import { useNextStep } from "../api/useNextStep";
import { STRENGTH_THEMES, type StrengthTheme } from "../constants/strengths";
import { SkeletonBlock } from "../../../ui/Skeleton";
import { useToast } from "../../../ui/ToastProvider";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Muted,
  SectionLabel,
  cn,
} from "../../../ui/primitives";
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

  const messageInputRef = useRef<HTMLInputElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
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

  // 新しいメッセージが追加されたら自動スクロール
  useEffect(() => {
    if (chatMessages.length > 0) {
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, [chatMessages.length]);

  // デバッグ: loopStateの変化を監視
  useEffect(() => {
    console.log("loopState changed:", loopState);
    console.log("currentQuestion:", getCurrentQuestion(loopState));
    console.log("loopBusy:", loopBusy);
    console.log("chatMessages:", chatMessages);
    console.log("turns:", turns);
  }, [loopState, loopBusy, chatMessages, turns]);

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
  }: {
    questionId: string;
    text: string;
  }) => {
    if (!sessionId) return;
    setLoopBusy(true);
    setLoopError(null);
    try {
      const trimmed = text.trim();
      const data = await api.sessions.answer(sessionId, {
        questionId,
        answer: "UNKNOWN",
        answerText: trimmed || undefined,
      });
      console.log("Answer response:", data);
      setLoopState(data as any);
      // 回答ログとセッションの最新化
      qc.invalidateQueries({ queryKey: ["turns", sessionId] });
      qc.invalidateQueries({ queryKey: ["session", sessionId] });

      if ((data as any).done) {
        showToast("推定が確定しました", { type: "success" });
      }
      // サーバーから次の質問も含めて返ってくるので、fetchNext()は不要
      setAnswerInput("");
      setTimeout(() => messageInputRef.current?.focus(), 0);
    } catch (e: any) {
      console.error("Answer error:", e);
      const msg = String(e?.message || e);
      setLoopError(msg);
      showToast(`回答エラー：${msg}`, { type: "error" });
    } finally {
      console.log("Setting loopBusy to false");
      setLoopBusy(false);
    }
  };

  const submitCurrentAnswer = async (questionId?: string | null) => {
    if (!questionId || loopBusy) return;
    const trimmed = answerInput.trim();
    if (!trimmed) {
      showToast("回答を入力してください", { type: "info" });
      return;
    }
    await answer({
      questionId,
      text: trimmed,
    });
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
      <div className="space-y-5">
        {(profile.summarizedTraits?.length ||
          profile.summarizedManagement?.length) && (
          <div className="grid gap-4 sm:grid-cols-2">
            {profile.summarizedTraits?.length ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-semibold text-slate-800">
                  あなたの特徴（要点）
                </div>
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  {profile.summarizedTraits.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {profile.summarizedManagement?.length ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-semibold text-slate-800">
                  効果的なマネジメント
                </div>
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  {profile.summarizedManagement.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        {profile.perTheme?.length ? (
          <div className="space-y-4">
            {profile.perTheme.map((t) => (
              <div
                key={t.theme}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="text-sm font-semibold text-sky-600">
                  {t.theme}
                </div>
                {t.traits?.length ? (
                  <div className="mt-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      特徴
                    </div>
                    <ul className="mt-2 space-y-1 text-sm text-slate-600">
                      {t.traits.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {t.management?.length ? (
                  <div className="mt-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      マネジメント
                    </div>
                    <ul className="mt-2 space-y-1 text-sm text-slate-600">
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
  const personaSafe = safeSession.persona;
  const hasSession = Boolean(sessionId);
  const currentQuestion = getCurrentQuestion(loopState);
  const loopFinished =
    loopStarted && loopState && "done" in loopState && loopState.done === true;
  const loopHeadline =
    loopFinished && typeof (loopState as any)?.headline === "string"
      ? (loopState as any)?.headline
      : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-12 lg:px-8">
        <header className="flex flex-col gap-3 text-left">
          <SectionLabel>AI COACH LOOP</SectionLabel>
          <h1 className="text-3xl font-semibold text-slate-900 md:text-4xl">
            AI Coaching Studio
          </h1>
          <Muted className="max-w-2xl">
            Strengthsベースの質問ループで、あなたの強みや次の一歩をAIマネージャーが伴走します。
          </Muted>
        </header>

        <div
          className={cn(
            "grid gap-6",
            hasSession
              ? "xl:grid-cols-[320px_minmax(0,1fr)_320px]"
              : "lg:grid-cols-[minmax(0,1fr)_360px]"
          )}
        >
          <div className="space-y-6">
            {!hasSession ? (
              <Card>
                <CardHeader>
                  <SectionLabel subtle>STEP 1</SectionLabel>
                  <CardTitle>プロフィールをセットアップ</CardTitle>
                  <CardDescription>
                    強みや基本属性を入力すると、最適な問いからコーチングが始まります。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-700">
                      基本属性（任意）
                    </h3>
                    <IdentityPicker value={identity} onChange={setIdentity} />
                  </section>
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-700">
                        ストレングスTop5（最大5つ・任意）
                      </h3>
                      <span className="text-xs text-slate-500">
                        {selected.length}/5
                      </span>
                    </div>
                    <Input
                      aria-label="資質検索"
                      placeholder="資質名で絞り込み（例：戦略性）"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <div className="grid max-h-56 grid-cols-2 gap-2 overflow-auto rounded-2xl border border-slate-200 bg-white p-2 sm:grid-cols-3">
                      {filtered.map((theme) => {
                        const checked = selected.includes(theme);
                        const disabled = !checked && !canAddMore;
                        return (
                          <label
                            key={theme}
                            className={cn(
                              "group flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2 text-sm transition",
                              checked
                                ? "border-sky-300 bg-sky-50 text-sky-700"
                                : "border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:bg-slate-50",
                              disabled && !checked ? "opacity-40" : ""
                            )}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-300"
                              checked={checked}
                              disabled={disabled}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  if (selected.length < 5) {
                                    setSelected([...selected, theme]);
                                  }
                                } else {
                                  setSelected(
                                    selected.filter((t) => t !== theme)
                                  );
                                }
                              }}
                            />
                            <span>{theme}</span>
                          </label>
                        );
                      })}
                    </div>
                    {!!selected.length && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {selected.map((s) => (
                          <Button
                            key={s}
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="rounded-full border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                            onClick={() =>
                              setSelected(selected.filter((t) => t !== s))
                            }
                          >
                            {s} ×
                          </Button>
                        ))}
                      </div>
                    )}
                  </section>
                  {create.isPending && (
                    <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                      <SkeletonBlock lines={4} />
                    </div>
                  )}
                  {create.isError && (
                    <Muted className="text-rose-400">
                      {String(
                        (create.error as any)?.message || "エラーが発生しました"
                      )}
                    </Muted>
                  )}
                </CardContent>
                <CardFooter className="border-t border-slate-100 pt-6">
                  <Button
                    type="button"
                    onClick={onStart}
                    disabled={create.isPending}
                    className="min-w-[180px]"
                  >
                    {create.isPending ? "生成中…" : "セッションを開始"}
                  </Button>
                </CardFooter>
              </Card>
            ) : null}
            {/* 最近のセッション一覧は非表示（保存機能は維持） */}
            {/* <Card>
              <CardHeader>
                <SectionLabel subtle>履歴</SectionLabel>
                <CardTitle>最近のセッション</CardTitle>
                <CardDescription>直近20件のセッションを参照できます。</CardDescription>
              </CardHeader>
              <CardContent>
                {!Array.isArray(list) || list.length === 0 ? (
                  <Muted>まだセッションはありません。</Muted>
                ) : (
                  <div className="space-y-3">
                    {list.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between rounded-2xl border border-slate-800/60 bg-slate-900/40 px-4 py-3 text-sm"
                      >
                        <div>
                          <div className="font-medium text-slate-100">
                            {s.title || "(no title)"}
                          </div>
                          <div className="text-xs text-slate-400">
                            {new Date(s.created_at).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/app/coach?session=${s.id}`)}
                          >
                            開く
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
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
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card> */}
          </div>
          <div className="space-y-6">
            {!hasSession ? (
              <Card className="min-h-[520px]">
                <CardHeader>
                  <SectionLabel subtle>PREVIEW</SectionLabel>
                  <CardTitle>AIマネージャーと対話しましょう</CardTitle>
                  <CardDescription>
                    左のフォームからセッションを開始すると、ChatGPTのような体験で質問と回答が交互に表示されます。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3 text-sm text-slate-600">
                    <li>
                      ・質問はAIが自動で生成し、あなたの回答に合わせて深掘りします。
                    </li>
                    <li>
                      ・回答はチャット欄に入力し、「回答を送信」ボタンで送信します。
                    </li>
                    <li>
                      ・診断が完了すると、次の一歩の提案やペルソナの要約が表示されます。
                    </li>
                  </ul>
                </CardContent>
              </Card>
            ) : !loopStarted ? (
              <Card className="min-h-[360px]">
                <CardHeader>
                  <SectionLabel subtle>COACH</SectionLabel>
                  <CardTitle>診断を開始できます</CardTitle>
                  <CardDescription>
                    ボタンを押すとAIが最初の質問を生成し、チャット形式でのコーチングが始まります。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <Muted>
                    セッションはいつでも再開・再生成できます。準備が整ったら以下のボタンを押してください。
                  </Muted>
                  <Button
                    type="button"
                    size="lg"
                    onClick={async () => {
                      setLoopStarted(true);
                      await fetchNext();
                    }}
                    className="w-full sm:w-auto"
                  >
                    診断を開始
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="flex h-[680px] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg">
                {/* Chat Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 md:p-6">
                  <div className="mx-auto max-w-4xl space-y-6">
                    {turnsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Muted>履歴を読み込んでいます…</Muted>
                      </div>
                    ) : chatMessages.length === 0 ? (
                      <div className="flex items-center justify-center py-8">
                        <Muted>
                          最初の質問を準備しています。少々お待ちください。
                        </Muted>
                      </div>
                    ) : (
                      <>
                        {chatMessages.map((msg) => {
                          const isAssistant = msg.role === "assistant";
                          const timestamp =
                            msg.createdAt &&
                            new Date(msg.createdAt).toLocaleTimeString();
                          return (
                            <div
                              key={msg.id}
                              className={cn(
                                "flex gap-3",
                                isAssistant ? "justify-start" : "justify-end"
                              )}
                            >
                              {isAssistant && (
                                <div className="h-10 w-10 shrink-0">
                                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-pink-500 text-white">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
                                      <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
                                    </svg>
                                  </div>
                                </div>
                              )}

                              <div
                                className={cn(
                                  "flex flex-col",
                                  isAssistant ? "items-start" : "items-end",
                                  "max-w-[70%]"
                                )}
                              >
                                <div
                                  className={cn(
                                    "group relative rounded-2xl px-4 py-3",
                                    isAssistant
                                      ? "bg-chat-other text-chat-other-foreground"
                                      : "bg-chat-user text-chat-user-foreground"
                                  )}
                                >
                                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                                    {msg.text}
                                  </p>
                                </div>
                                {timestamp && (
                                  <span className="mt-1 text-xs text-muted-foreground">
                                    {timestamp}
                                  </span>
                                )}
                                {msg.pending && !msg.createdAt && (
                                  <span className="mt-1 text-xs text-muted-foreground">
                                    送信準備中…
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        <div ref={chatEndRef} />
                      </>
                    )}
                  </div>
                </div>

                {/* Input Area */}
                <div className="border-t bg-background p-4">
                  <div className="mx-auto max-w-4xl">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!loopBusy && currentQuestion?.id && answerInput.trim()) {
                          submitCurrentAnswer(currentQuestion?.id);
                        }
                      }}
                      className="flex items-center gap-2"
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                          <path fillRule="evenodd" d="M18.97 3.659a2.25 2.25 0 00-3.182 0l-10.94 10.94a3.75 3.75 0 105.304 5.303l7.693-7.693a.75.75 0 011.06 1.06l-7.693 7.693a5.25 5.25 0 11-7.424-7.424l10.939-10.94a3.75 3.75 0 115.303 5.304L9.097 18.835l-.008.008-.007.007-.002.002-.003.002A2.25 2.25 0 015.91 15.66l7.81-7.81a.75.75 0 011.061 1.06l-7.81 7.81a.75.75 0 001.054 1.068L18.97 6.84a2.25 2.25 0 000-3.182z" clipRule="evenodd" />
                        </svg>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                          <path fillRule="evenodd" d="M1.5 6a2.25 2.25 0 012.25-2.25h16.5A2.25 2.25 0 0122.5 6v12a2.25 2.25 0 01-2.25 2.25H3.75A2.25 2.25 0 011.5 18V6zM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0021 18v-1.94l-2.69-2.689a1.5 1.5 0 00-2.12 0l-.88.879.97.97a.75.75 0 11-1.06 1.06l-5.16-5.159a1.5 1.5 0 00-2.12 0L3 16.061zm10.125-7.81a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0z" clipRule="evenodd" />
                        </svg>
                      </Button>
                      <Input
                        ref={messageInputRef}
                        value={answerInput}
                        onChange={(e) => setAnswerInput(e.target.value)}
                        placeholder={
                          loopBusy
                            ? "処理中です..."
                            : !currentQuestion?.id
                            ? "次の質問を読み込んでいます..."
                            : "回答を入力してください..."
                        }
                        disabled={loopBusy || !currentQuestion?.id}
                        className="flex-1"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (!loopBusy && currentQuestion?.id && answerInput.trim()) {
                              submitCurrentAnswer(currentQuestion?.id);
                            }
                          }
                        }}
                      />
                      <Button
                        type="submit"
                        size="icon"
                        disabled={loopBusy || !currentQuestion?.id || !answerInput.trim()}
                        className="shrink-0 bg-chat-send hover:bg-chat-send/90"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                          <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
                        </svg>
                      </Button>
                    </form>
                    {loopError && (
                      <p className="mt-2 text-sm text-destructive">{loopError}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {hasSession && (
            <div className="space-y-6">
              {safeSession.summary?.trim() && (
                <Card>
                  <CardHeader>
                    <SectionLabel subtle>SUMMARY</SectionLabel>
                    <CardTitle>セッション要約</CardTitle>
                    <CardDescription>生成済みのサマリーです。</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700 shadow-sm">
                      {safeSession.summary}
                    </div>
                  </CardContent>
                </Card>
              )}

              {loopFinished &&
                loopState &&
                "done" in loopState &&
                loopState.done === true && (
                  <Card aria-live="polite">
                    <CardHeader>
                      <SectionLabel subtle>INSIGHT</SectionLabel>
                      <CardTitle>
                        {loopHeadline || "AIマネージャーのまとめ"}
                      </CardTitle>
                      <CardDescription>
                        診断が完了しました。AIマネージャーからの提案です。
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      {isNewDone(loopState) ? (
                        <>
                          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                            <div className="text-sm font-semibold text-sky-700">
                              あなたはこういう人です！
                            </div>
                            <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                              {loopState.metadata.next_step.summary}
                            </div>
                          </div>
                          <div className="space-y-3">
                            <div className="text-sm font-semibold text-slate-800">
                              やってみよう！
                            </div>
                            <div className="space-y-2">
                              {(loopState.metadata.next_step.next_week_plan
                                ?.length
                                ? loopState.metadata.next_step.next_week_plan
                                : loopState.metadata.next_step.management?.do ||
                                  []
                              ).map((s, i) => (
                                <Button
                                  key={`${s}-${i}`}
                                  type="button"
                                  variant="secondary"
                                  className="w-full justify-start rounded-2xl border border-sky-200 bg-white text-left text-sm text-slate-700 shadow-sm hover:bg-slate-50"
                                  onClick={() => {
                                    navigator.clipboard
                                      ?.writeText(s)
                                      .then(() =>
                                        showToast("コピーしました", {
                                          type: "success",
                                        })
                                      )
                                      .catch(() =>
                                        showToast("コピーできませんでした", {
                                          type: "error",
                                        })
                                      );
                                  }}
                                >
                                  {s}
                                </Button>
                              ))}
                            </div>
                          </div>
                          {loopState.metadata.next_step.management?.dont
                            ?.length ? (
                            <div className="space-y-2">
                              <div className="text-sm font-semibold text-slate-800">
                                避けたいこと
                              </div>
                              <ul className="space-y-1 text-sm text-slate-600">
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
                        <>
                          {(loopState as any).persona_statement && (
                            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                              <div className="text-sm font-semibold text-sky-700">
                                あなたはこういう人です！
                              </div>
                              <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                                {(loopState as any).persona_statement}
                              </div>
                            </div>
                          )}
                          <div className="space-y-3">
                            <div className="text-sm font-semibold text-slate-800">
                              次のアクション候補
                            </div>
                            <div className="space-y-2">
                              {loopState.next_steps.map((s, i) => (
                                <Button
                                  key={`${s}-${i}`}
                                  type="button"
                                  variant="secondary"
                                  className="w-full justify-start rounded-2xl border border-sky-200 bg-white text-left text-sm text-slate-700 shadow-sm hover:bg-slate-50"
                                  onClick={() => {
                                    navigator.clipboard
                                      ?.writeText(s)
                                      .then(() =>
                                        showToast("コピーしました", {
                                          type: "success",
                                        })
                                      )
                                      .catch(() =>
                                        showToast("コピーできませんでした", {
                                          type: "error",
                                        })
                                      );
                                  }}
                                >
                                  {s}
                                </Button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                      {(loopState as any).evidence?.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            根拠の内訳
                          </div>
                          <ul className="space-y-2 text-xs text-slate-500">
                            {(loopState as any).evidence.map(
                              (e: EvidenceItem, i: number) => (
                                <li
                                  key={i}
                                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm"
                                >
                                  <div className="font-medium text-slate-700">
                                    Q: {e.text}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500">
                                    A: {ANSWER_LABEL[e.answer]} ／ 確信度寄与:{" "}
                                    {(e.delta * 100).toFixed(1)}%
                                  </div>
                                </li>
                              )
                            )}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                    <CardFooter className="border-t border-slate-100 pt-6">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setLoopStarted(false);
                          setLoopState(null);
                        }}
                      >
                        もう一度診断する
                      </Button>
                      <Button type="button" variant="ghost" onClick={resetAll}>
                        セッションを終了
                      </Button>
                    </CardFooter>
                  </Card>
                )}

              {personaSafe && (
                <Card>
                  <CardHeader>
                    <SectionLabel subtle>STRENGTHS</SectionLabel>
                    <CardTitle>ストレングス プロファイル</CardTitle>
                    <CardDescription>
                      生成されたストレングスの解釈です。
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <PersonaView profile={personaSafe} />
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
