import { useEffect, useMemo, useRef, useState } from "react";
import { useCreateSession } from "../api/useCreateSession";
import { useNextStep } from "../api/useNextStep";
import { STRENGTH_THEMES, type StrengthTheme } from "../constants/strengths";
import { SkeletonBlock } from "../../../ui/Skeleton";
import { useToast } from "../../../ui/ToastProvider";
import { useSearchParams } from "react-router-dom";
import { useLoadSession } from "../api/useLoadSession";
import IdentityPicker, {
  type IdentityValue,
} from "../components/IdentityPicker";
import type { Demographics } from "../../../types/api";

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
  text: string;
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
    }
  | {
      done: true;
      top: { id: string; label: string; confidence: number };
      next_steps: string[];
      asked: number;
      max: number;
      posterior: Posterior;
      evidence: EvidenceItem[];
    };

type SessionOutput = {
  summary: string;
  hypotheses: string[];
  next_steps: string[];
  citations: { text: string; anchor: string }[];
  counter_questions?: string[];
};
type SessionDTO = {
  id: string;
  createdAt: string;
  output: SessionOutput;
  loop?: { threshold: number; maxQuestions: number; minQuestions?: number };
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
  return {
    // IdentityPicker は null を使うので、API には undefined で渡す
    ageRange: v.ageRange ?? undefined,
    gender: v.gender ? String(v.gender) : undefined, // API 側は string 想定
    hometown: v.hometown?.trim() ? v.hometown.trim() : undefined,
  };
}

export default function SessionPage() {
  const firstAnswerBtnRef = useRef<HTMLButtonElement | null>(null);
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
  const [identity, setIdentity] = useState<IdentityValue>({
    ageRange: null,
    gender: null,
    hometown: "",
  });

  const create = useCreateSession();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<SessionDTO | null>(null);

  const advance = useNextStep(sessionId);
  const [refineText, setRefineText] = useState("");

  const [timeToFirst, setTimeToFirst] = useState<number | null>(null);
  const [t0, setT0] = useState<number | null>(null);

  // 質問ループ
  const [loopStarted, setLoopStarted] = useState(false);
  const [loopBusy, setLoopBusy] = useState(false);
  const [loopError, setLoopError] = useState<string | null>(null);
  const [loopState, setLoopState] = useState<LoopFetch | null>(null);

  // 設定（UIスライダー）
  const [threshold, setThreshold] = useState(0.9);
  const [maxQuestions, setMaxQuestions] = useState(8);
  const [minQuestions, setMinQuestions] = useState(0);

  // URL パラメータから復元
  const [sp, setSp] = useSearchParams();
  const sessionFromUrl = sp.get("session");
  const { data: restored } = useLoadSession(sessionFromUrl);

  // 永続化：ロード時に sessionId を復元
  useEffect(() => {
    if (!restored) return;
    setSessionId(restored.id);
    setSessionData(restored as any);
    if ((restored as any).loop) {
      setThreshold((restored as any).loop.threshold);
      setMaxQuestions((restored as any).loop.maxQuestions);
      setMinQuestions((restored as any).loop.minQuestions ?? 0);
    }
    localStorage.setItem(LS_KEY, restored.id);
  }, [restored]);

  // セッション開始（悩み領域／会話ログは送らない）
  const onStart = async () => {
    // サーバは transcript>=20 文字必須なので安全なダミーを生成
    const fallback =
      "（自動生成ログ）Top5と基本属性から初期セッションを開始します。";
    const autoTranscript =
      selected.length > 0
        ? `Top5: ${selected.join("、")} に基づく初期セッションメモです。`
        : fallback;
    const transcript = autoTranscript.length >= 20 ? autoTranscript : fallback;

    // 空オブジェクトは送らない
    const d = identityToDemographics(identity);
    const demographics = d.ageRange || d.gender || d.hometown ? d : undefined;

    setT0(performance.now());
    try {
      const s = await create.mutateAsync({
        transcript, // 必須を満たすために自動送信
        // context は送らない（サーバ側が "仕事" にデフォルト）
        strengths_top5: selected.length ? selected : undefined,
        demographics,
      } as any);
      setSessionId(s.id);
      setSessionData(s as any);
      localStorage.setItem(LS_KEY, s.id);
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("session", s.id);
          return next;
        },
        { replace: true }
      );
      if (t0 !== null) setTimeToFirst(Math.round(performance.now() - t0));
      if ((s as any).loop) {
        setThreshold((s as any).loop.threshold);
        setMaxQuestions((s as any).loop.maxQuestions);
        setMinQuestions((s as any).loop.minQuestions ?? 0);
      }
      showToast("セッションを開始しました", { type: "success" });
    } catch (e: any) {
      showToast(`開始に失敗：${String(e?.message || e)}`, { type: "error" });
    }
  };

  // 次の質問を取得
  const fetchNext = async () => {
    if (!sessionId) return;
    setLoopBusy(true);
    setLoopError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/questions/next`);
      const data: LoopFetch = await res.json();
      if (!res.ok)
        throw new Error((data as any)?.message || "質問の取得に失敗しました");
      setLoopState(data);
      setTimeout(() => firstAnswerBtnRef.current?.focus(), 0);
    } catch (e: any) {
      const msg = String(e?.message || e);
      setLoopError(msg);
      showToast(`質問取得エラー：${msg}`, { type: "error" });
    } finally {
      setLoopBusy(false);
    }
  };

  // 回答送信
  const answer = async (
    qId: string,
    a: "YES" | "PROB_YES" | "UNKNOWN" | "PROB_NO" | "NO"
  ) => {
    if (!sessionId) return;
    setLoopBusy(true);
    setLoopError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: qId, answer: a }),
      });
      const data: LoopFetch = await res.json();
      if (!res.ok)
        throw new Error((data as any)?.message || "回答の送信に失敗しました");
      setLoopState(data);
      if ("done" in data && data.done) {
        showToast("推定が確定しました", { type: "success" });
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      setLoopError(msg);
      showToast(`回答エラー：${msg}`, { type: "error" });
    } finally {
      setLoopBusy(false);
    }
  };

  // 取り消し
  const undo = async () => {
    if (!sessionId) return;
    setLoopBusy(true);
    setLoopError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/answers/undo`, {
        method: "POST",
      });
      const data: LoopFetch | any = await res.json();
      if (!res.ok) throw new Error(data?.message || "取り消しに失敗しました");
      setLoopState(data);
      showToast("直前の回答を取り消しました", { type: "info" });
    } catch (e: any) {
      const msg = String(e?.message || e);
      setLoopError(msg);
      showToast(`取り消しエラー：${msg}`, { type: "error" });
    } finally {
      setLoopBusy(false);
    }
  };

  // 設定の適用
  const applySettings = async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/loop`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threshold, maxQuestions, minQuestions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "設定の反映に失敗しました");
      if (data.loop) {
        setThreshold(data.loop.threshold);
        setMaxQuestions(data.loop.maxQuestions);
        setMinQuestions(data.loop.minQuestions ?? 0);
      }
      showToast("しきい値／上限を反映しました", { type: "success" });
    } catch (e: any) {
      const msg = String(e?.message || e);
      setLoopError(msg);
      showToast(`設定エラー：${msg}`, { type: "error" });
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
    setRefineText("");
    setTimeToFirst(null);
    setSelected([]);
    setQuery("");
    setIdentity({ ageRange: null, gender: null, hometown: "" });
    create.reset();
    advance.reset();
    showToast("セッションをクリアしました", { type: "info" });
  };

  // 次の一歩クリック → コピー & ローカル計測
  const onClickSuggestion = async (text: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      showToast("コピーしました", { type: "success" });
    } catch {
      showToast("コピーできませんでした", { type: "error" });
    }
    const key = "metrics_suggestion_clicks";
    const n = Number(localStorage.getItem(key) || "0") + 1;
    localStorage.setItem(key, String(n));
    console.debug("[metrics] suggestion_click_rate increment", { total: n });
  };

  const handleShare = async () => {
    if (!sessionId) return;
    const url = `${window.location.origin}/app/coach?session=${sessionId}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("共有リンクをコピーしました", { type: "success" });
    } catch {
      prompt("以下のURLを手動でコピーしてください。", url);
    }
  };

  // キーボードショートカット（1..5で回答）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        !loopState ||
        !("done" in loopState) ||
        loopState.done ||
        !loopState.question
      )
        return;
      const map: Record<
        string,
        "YES" | "PROB_YES" | "UNKNOWN" | "PROB_NO" | "NO"
      > = {
        "1": "YES",
        "2": "PROB_YES",
        "3": "UNKNOWN",
        "4": "PROB_NO",
        "5": "NO",
      };
      const a = map[e.key];
      if (a) {
        e.preventDefault();
        answer(loopState.question.id, a);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [loopState]);

  const posterior =
    loopState && "posterior" in loopState ? loopState.posterior : null;

  const PosteriorBars = ({ p }: { p: Posterior }) => {
    const items = [
      { k: "TYPE_STRATEGY", label: "戦略" },
      { k: "TYPE_EMPATHY", label: "共感" },
      { k: "TYPE_EXECUTION", label: "実行" },
      { k: "TYPE_ANALYTICAL", label: "探究" },
      { k: "TYPE_STABILITY", label: "安定" },
    ] as const;
    return (
      <div className="space-y-2" aria-label="確率分布">
        {items.map((it) => {
          const v = Math.round(p[it.k as keyof Posterior] * 100);
          return (
            <div key={it.k}>
              <div className="flex justify-between text-sm">
                <span>{it.label}</span>
                <span>{v}%</span>
              </div>
              <div
                className="h-2 bg-gray-200 rounded"
                role="progressbar"
                aria-valuenow={v}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${it.label}の確率`}
              >
                <div
                  className="h-2 rounded bg-black"
                  style={{ width: `${v}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-6">
      <h1 className="text-2xl font-bold">
        Coach セッション (MVP){" "}
        <span title="Top5→軽い事前確率→質問で更新→確信度で確定">ℹ️</span>
      </h1>

      {/* ===== 初期入力（悩み領域／会話ログは削除） ===== */}
      {!sessionId && (
        <div className="space-y-3" aria-busy={create.isPending}>
          {/* 基本属性（任意） */}
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

      {/* ===== 初回結果 ===== */}
      {sessionId && (sessionData || create.data) && (
        <div className="space-y-4">
          <div className="text-sm text-gray-600">
            セッションID: <code>{sessionId}</code>
            {timeToFirst !== null && <span> / 初回出力: {timeToFirst} ms</span>}
            <button
              className="ml-2 px-2 py-1 border rounded text-xs hover:bg-gray-50"
              onClick={handleShare}
              disabled={!sessionId}
              aria-label="共有リンクをコピー"
            >
              共有リンクをコピー
            </button>
          </div>

          <section className="space-y-2">
            <h2 className="text-xl font-semibold">要約</h2>
            {!create.data && !sessionData ? (
              <SkeletonBlock lines={5} />
            ) : (
              <pre className="whitespace-pre-wrap bg-gray-50 p-3 rounded border">
                {(sessionData?.output ?? create.data!.output).summary}
              </pre>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-xl font-semibold">仮説</h2>
            {!create.data && !sessionData ? (
              <SkeletonBlock lines={3} />
            ) : (
              <ul className="list-disc pl-6">
                {(sessionData?.output ?? create.data!.output).hypotheses.map(
                  (h, i) => (
                    <li key={i}>{h}</li>
                  )
                )}
              </ul>
            )}
          </section>

          {!!(sessionData?.output ?? create.data!.output).counter_questions
            ?.length && (
            <section className="space-y-2">
              <h2 className="text-xl font-semibold">反証質問</h2>
              <ul className="list-disc pl-6">
                {(
                  sessionData?.output ?? create.data!.output
                ).counter_questions!.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-xl font-semibold">根拠引用</h2>
            <ul className="list-disc pl-6">
              {(sessionData?.output ?? create.data!.output).citations.map(
                (c, i) => (
                  <li key={i}>
                    <a
                      href={c.anchor}
                      className="underline"
                      onClick={(e) => e.preventDefault()}
                    >
                      {c.text}
                    </a>{" "}
                    <span className="text-gray-500">{c.anchor}</span>
                  </li>
                )
              )}
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-xl font-semibold">次の一歩</h2>
            <ul className="pl-0">
              {(sessionData?.output ?? create.data!.output).next_steps.map(
                (s, i) => (
                  <li key={i} className="list-none">
                    <button
                      className="underline rounded px-1 py-0.5 hover:bg-gray-100"
                      onClick={() => onClickSuggestion(s)}
                      aria-label={`次の一歩をコピー：${s}`}
                    >
                      {s}
                    </button>
                  </li>
                )
              )}
            </ul>
          </section>
        </div>
      )}

      {/* ===== 追加指示 ===== */}
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
                  setSessionData(s as any);
                  setRefineText("");
                  showToast("更新しました", { type: "success" });
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

      {/* ===== タイプ推定（ベータ） ===== */}
      {sessionId && (
        <section className="space-y-4 border rounded p-3" aria-live="polite">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">タイプ推定（ベータ）</h2>
            <div className="flex flex-wrap gap-2 text-sm">
              <div className="flex items-center gap-2">
                <label className="whitespace-nowrap">
                  しきい値 ({threshold.toFixed(2)})
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={0.99}
                  step={0.01}
                  value={threshold}
                  onChange={(e) => setThreshold(parseFloat(e.target.value))}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="whitespace-nowrap">
                  最大質問数 ({maxQuestions})
                </label>
                <input
                  type="range"
                  min={3}
                  max={12}
                  step={1}
                  value={maxQuestions}
                  onChange={(e) => setMaxQuestions(parseInt(e.target.value))}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="whitespace-nowrap">
                  最低質問数 ({minQuestions})
                </label>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={minQuestions}
                  onChange={(e) => setMinQuestions(parseInt(e.target.value))}
                  aria-label="最低質問数"
                  title="この回数に達するまでは確定しません"
                />
              </div>
              <button
                className="rounded border px-3 py-1"
                onClick={applySettings}
              >
                適用
              </button>
            </div>
          </div>

          {!loopStarted && (
            <button
              className="rounded bg-black text-white px-4 py-2"
              onClick={async () => {
                setLoopStarted(true);
                await fetchNext();
              }}
            >
              診断を開始
            </button>
          )}

          {posterior && (
            <div className="space-y-2">
              <div className="text-sm text-gray-600">現在の確率分布</div>
              <PosteriorBars p={posterior} />
            </div>
          )}

          {/* 進行中 */}
          {loopStarted &&
            loopState &&
            "done" in loopState &&
            loopState.done === false && (
              <div className="space-y-3" aria-busy={loopBusy}>
                <div className="text-sm text-gray-600">
                  進捗: {loopState.progress.asked}/{loopState.progress.max}　
                  現在のトップ: {loopState.hint.topLabel}（確信度{" "}
                  {(loopState.hint.confidence * 100).toFixed(0)}%）
                </div>

                <div className="p-3 rounded border">
                  <div className="font-medium mb-2">
                    Q:{" "}
                    {loopState.question
                      ? loopState.question.text
                      : "（取得中）"}
                  </div>
                  <div className="text-xs text-gray-500 mb-1">
                    ※ キー操作: 1=はい / 2=たぶんはい / 3=わからない /
                    4=たぶんいいえ / 5=いいえ
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        { k: "YES", label: "はい" },
                        { k: "PROB_YES", label: "たぶんはい" },
                        { k: "UNKNOWN", label: "わからない" },
                        { k: "PROB_NO", label: "たぶんいいえ" },
                        { k: "NO", label: "いいえ" },
                      ] as const
                    ).map((opt, idx) => (
                      <button
                        key={opt.k}
                        ref={idx === 0 ? firstAnswerBtnRef : undefined}
                        disabled={loopBusy || !loopState.question}
                        className="rounded border px-3 py-2 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-black"
                        onClick={() =>
                          loopState.question &&
                          answer(loopState.question.id, opt.k as any)
                        }
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
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
                </div>

                {loopError && (
                  <div className="text-sm text-red-600">{loopError}</div>
                )}
              </div>
            )}

          {/* 確定 */}
          {loopStarted &&
            loopState &&
            "done" in loopState &&
            loopState.done === true && (
              <div className="space-y-3">
                <div className="text-green-700 font-medium">
                  予測タイプ：{loopState.top.label}（確信度{" "}
                  {(loopState.top.confidence * 100).toFixed(0)}%）
                </div>
                <div>
                  <div className="font-medium">
                    このタイプ向けの「次の一歩」
                  </div>
                  <ul className="pl-0">
                    {loopState.next_steps.map((s, i) => (
                      <li key={i} className="list-none">
                        <button
                          className="underline rounded px-1 py-0.5 hover:bg-gray-100"
                          onClick={() => onClickSuggestion(s)}
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                {loopState.evidence?.length > 0 && (
                  <div className="space-y-1">
                    <div className="font-medium">
                      根拠の内訳（影響が大きかった回答）
                    </div>
                    <ul className="list-disc pl-6 text-sm">
                      {loopState.evidence.map((e, i) => (
                        <li key={i}>
                          <span className="font-medium">Q:</span> {e.text} ／
                          <span className="font-medium">A:</span>{" "}
                          {ANSWER_LABEL[e.answer]} ／
                          <span className="text-gray-600">
                            確信度寄与: {(e.delta * 100).toFixed(1)}%
                          </span>
                        </li>
                      ))}
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
