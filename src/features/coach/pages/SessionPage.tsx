import { useEffect, useMemo, useRef, useState } from "react";
import { useCreateSession } from "../api/useCreateSession";
import { STRENGTH_THEMES, type StrengthTheme } from "../constants/strengths";
import { SkeletonBlock } from "../../../ui/Skeleton";
import { useToast } from "../../../ui/ToastProvider";
import { useSearchParams } from "react-router-dom";
import { useLoadSession } from "../api/useLoadSession";
import IdentityPicker, {
  type IdentityValue,
} from "../components/IdentityPicker";
import type { Demographics, StrengthProfile } from "../../../types/api";

/* =========================
 * ローカル型（UIでのみ使用）
 * ========================= */
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
  next_steps: string[];
  persona?: StrengthProfile;
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

const TYPE_SHORT_JP: Record<keyof Posterior, string> = {
  TYPE_STRATEGY: "戦略",
  TYPE_EMPATHY: "共感",
  TYPE_EXECUTION: "実行",
  TYPE_ANALYTICAL: "探究",
  TYPE_STABILITY: "安定",
};

/* =========================
 * Identity → Demographics
 * ========================= */
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

/* =========================
 * 断定/1on1/NG ビルダー
 * ========================= */
function topTypeFromPosterior(p?: Posterior | null): keyof Posterior | null {
  if (!p) return null;
  return (Object.keys(p) as (keyof Posterior)[]).reduce((a, b) =>
    p[a] >= p[b] ? a : (b as any)
  );
}

function buildHeadline(
  profile?: StrengthProfile,
  posterior?: Posterior | null
) {
  const top = topTypeFromPosterior(posterior);
  const topLabel = top ? TYPE_SHORT_JP[top] : null;
  const traits = profile?.summarizedTraits?.slice(0, 2) ?? [];
  const t1 = traits[0] || "強みを活かす";
  const t2 = traits[1] || "周囲と整合させる";
  if (topLabel) {
    return `あなたは「${topLabel}×${t1}」型。初動よりも${t2}ことを重視するタイプです。`;
  }
  return `あなたは「${t1}」が強いタイプ。状況に合わせて着実に前進できます。`;
}

function buildOneOnOnePrompts(profile?: StrengthProfile): string[] {
  if (!profile) return [];
  const per = profile.perTheme ?? [];
  const out: string[] = [];
  for (const t of per.slice(0, 4)) {
    if (t.traits?.length) {
      out.push(`「${t.theme}」が出ています。最近それが活きた具体例は？`);
    }
    if (t.management?.length) {
      out.push(
        `「${t.theme}」の人が力を発揮する環境は？何が整えばベストですか？`
      );
    }
  }
  return Array.from(new Set(out)).slice(0, 5);
}

function buildNGs(profile?: StrengthProfile): string[] {
  if (!profile) return [];
  const per = profile.perTheme ?? [];
  const ng: string[] = [];
  for (const t of per.slice(0, 5)) {
    if (t.management?.some((m) => /裁量|任せる|目的/.test(m))) {
      ng.push(
        `「${t.theme}」に対して細かすぎる手順指示だけで縛るのはNG。意図と任せ方を。`
      );
    }
    if (t.management?.some((m) => /フィードバック|承認|安心/.test(m))) {
      ng.push(`「${t.theme}」の動機付けを軽視しない（承認/安心の無視はNG）。`);
    }
  }
  if (ng.length === 0) {
    ng.push("曖昧な期待値で走らせない（目的と判断基準は明文化）");
    ng.push("締切直前だけの指摘は避け、途中の確認ポイントを置く");
  }
  return Array.from(new Set(ng)).slice(0, 3);
}

/* =========================
 * 資質ベースのエントリ質問
 * ========================= */
type SeedQ = { id: string; theme: string; text: string };
type SeedAnswer = "YES" | "PROB_YES" | "UNKNOWN" | "PROB_NO" | "NO";

function seedQuestionsFromThemes(themes: string[]): SeedQ[] {
  const mk = (id: string, theme: string, text: string): SeedQ => ({
    id,
    theme,
    text,
  });
  const out: SeedQ[] = [];
  let i = 1;
  for (const t of themes.slice(0, 5)) {
    // 最低限の自社語彙での言い換え
    if (t === "原点思考")
      out.push(mk(`SQ${i++}`, t, "歴史や由来を調べるのはワクワクしますか？"));
    else if (t === "戦略性")
      out.push(
        mk(`SQ${i++}`, t, "選択肢を並べて最善ルートを素早く選べますか？")
      );
    else if (t === "着想")
      out.push(
        mk(`SQ${i++}`, t, "新しい切り口を思いつく瞬間がよくありますか？")
      );
    else if (t === "コミュニケーション")
      out.push(mk(`SQ${i++}`, t, "要点をつかんで人に伝えるのは得意ですか？"));
    else if (t === "包含")
      out.push(
        mk(`SQ${i++}`, t, "輪から外れた人を自然に巻き込みにいきますか？")
      );
    else if (t === "ポジティブ")
      out.push(
        mk(`SQ${i++}`, t, "場の空気を明るくする役割を自分で担うほうですか？")
      );
    else if (t === "分析思考")
      out.push(mk(`SQ${i++}`, t, "まず根拠やデータから考えるほうですか？"));
    else if (t === "回復志向")
      out.push(mk(`SQ${i++}`, t, "問題の原因を特定し直すのが得意ですか？"));
    else if (t === "規律性")
      out.push(mk(`SQ${i++}`, t, "決めたルーチンを崩さずに続けられますか？"));
    else if (t === "目標志向")
      out.push(
        mk(`SQ${i++}`, t, "ゴールから逆算して優先順位を切れるほうですか？")
      );
    else
      out.push(mk(`SQ${i++}`, t, `「${t}」っぽさを自覚する瞬間は多いですか？`));
  }
  return out;
}

function formatSeedAnswersForInstruction(qa: { q: SeedQ; a: SeedAnswer }[]) {
  const label: Record<SeedAnswer, string> = {
    YES: "はい",
    PROB_YES: "たぶんはい",
    UNKNOWN: "わからない",
    PROB_NO: "たぶんいいえ",
    NO: "いいえ",
  };
  const lines = qa.map(
    ({ q, a }) => `- [${label[a]}] ${q.text}（テーマ: ${q.theme}）`
  );
  return [
    "以下は資質ベースのエントリ質問に対する回答です。",
    "この回答を考慮して、人物像の断定・1on1質問カード・NG行動をより的確にしてください。",
    "",
    ...lines,
  ].join("\n");
}

// ★ サーバへ Top5/デモグラを渡して質問を生成してもらう
async function fetchSeedQuestions(
  sessionId: string,
  params: {
    strengths_top5?: string[];
    demographics?: { ageRange?: string; gender?: string; hometown?: string };
    n?: number;
  }
): Promise<SeedQ[]> {
  const res = await fetch(`/api/sessions/${sessionId}/seed-questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || "質問生成に失敗しました");
  return Array.isArray(json?.questions) ? json.questions : [];
}

/* =========================
 * コンポーネント
 * ========================= */
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
  const [identity, setIdentity] = useState<IdentityValue>({} as IdentityValue);

  // API
  const create = useCreateSession();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<SessionDTO | null>(null);

  const [timeToFirst, setTimeToFirst] = useState<number | null>(null);
  const [t0, setT0] = useState<number | null>(null);

  // 診断ループ
  const [loopStarted, setLoopStarted] = useState(false);
  const [loopBusy, setLoopBusy] = useState(false);
  const [loopError, setLoopError] = useState<string | null>(null);
  const [loopState, setLoopState] = useState<LoopFetch | null>(null);

  // 設定（UIスライダー）
  const [threshold, setThreshold] = useState(0.9);
  const [maxQuestions, setMaxQuestions] = useState(8);
  const [minQuestions, setMinQuestions] = useState(0);

  // URL 復元
  const [sp, setSp] = useSearchParams();
  const sessionFromUrl = sp.get("session");
  const { data: restored } = useLoadSession(sessionFromUrl);

  // エントリ質問（Top5→生成）
  const [seedQs, setSeedQs] = useState<SeedQ[]>([]);
  const [seedAns, setSeedAns] = useState<Record<string, SeedAnswer>>({});
  const [seedApplied, setSeedApplied] = useState(false);

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
      //LLM/モックAPIから動的取得
      try {
        const qs = await fetchSeedQuestions(s.id, {
          strengths_top5: selected.length ? selected : undefined,
          demographics,
          n: 5,
        });
        setSeedQs(qs);
        setSeedAns({});
        setSeedApplied(false);
      } catch (e: any) {
        // フォールバック：質問なしでも続行
        console.warn("[seed-questions] fallback:", e?.message || e);
        setSeedQs([]);
      }

      showToast("セッションを開始しました", { type: "success" });
    } catch (e: any) {
      showToast(`開始に失敗：${String(e?.message || e)}`, { type: "error" });
    }
  };

  // タイプ質問：次の質問
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

  // タイプ質問：回答
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
    setTimeToFirst(null);
    setSelected([]);
    setQuery("");
    setIdentity({} as IdentityValue);
    setSeedQs([]);
    setSeedAns({});
    setSeedApplied(false);
    create.reset();
    showToast("セッションをクリアしました", { type: "info" });
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

  const PersonaView = ({ profile }: { profile: StrengthProfile }) => {
    const headline = buildHeadline(profile, posterior);
    const prompts = buildOneOnOnePrompts(profile);
    const ngs = buildNGs(profile);

    return (
      <div className="space-y-4">
        <div className="p-3 border rounded bg-gray-50">
          <div className="text-sm text-gray-600 mb-1">人物像（断定）</div>
          <div className="font-semibold">{headline}</div>
        </div>

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

        {prompts.length > 0 && (
          <div className="p-3 border rounded">
            <div className="font-medium mb-1">次の1on1で使う質問</div>
            <ul className="list-disc pl-5">
              {prompts.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        )}

        {ngs.length > 0 && (
          <div className="p-3 border rounded">
            <div className="font-medium mb-1">NG行動（避けたいこと）</div>
            <ul className="list-disc pl-5">
              {ngs.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
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

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-6">
      <h1 className="text-2xl font-bold">
        1on1支援エージェント (MVP){" "}
        <span title="Top5→事前確率→質問で更新→確信度で確定">ℹ️</span>
      </h1>

      {/* ===== 初期入力 ===== */}
      {!sessionId && (
        <div className="space-y-3" aria-busy={create.isPending}>
          <section className="space-y-2">
            <h2 className="font-medium">基本属性（任意）</h2>
            <IdentityPicker value={identity} onChange={setIdentity} />
          </section>

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

      {/* ===== セッション出力（ペルソナ中心） ===== */}
      {sessionId && (sessionData || create.data) && (
        <div className="space-y-4">
          <div className="text-sm text-gray-600">
            セッションID: <code>{sessionId}</code>
            {timeToFirst !== null && <span> / 初回出力: {timeToFirst} ms</span>}
            <button
              className="ml-2 px-2 py-1 border rounded text-xs hover:bg-gray-50"
              onClick={async () => {
                if (!sessionId) return;
                const url = `${window.location.origin}/app/coach?session=${sessionId}`;
                try {
                  await navigator.clipboard.writeText(url);
                  showToast("共有リンクをコピーしました", { type: "success" });
                } catch {
                  prompt("以下のURLを手動でコピーしてください。", url);
                }
              }}
              disabled={!sessionId}
              aria-label="共有リンクをコピー"
            >
              共有リンクをコピー
            </button>
          </div>

          {/* 1) エントリ質問（Top5起点） */}
          {seedQs.length > 0 && !seedApplied && (
            <section className="space-y-2 p-3 border rounded">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  資質ベースの質問（精度アップ）
                </h2>
                <div className="text-xs text-gray-600">
                  ※人事評価には使いません
                </div>
              </div>
              <div className="space-y-3">
                {seedQs.map((q) => (
                  <div key={q.id} className="p-2 rounded border">
                    <div className="mb-2">
                      <span className="text-xs bg-gray-100 px-2 py-0.5 rounded mr-2">
                        {q.theme}
                      </span>
                      {q.text}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(
                        ["YES", "PROB_YES", "UNKNOWN", "PROB_NO", "NO"] as const
                      ).map((k) => (
                        <label
                          key={k}
                          className="flex items-center gap-1 text-sm"
                        >
                          <input
                            type="radio"
                            name={q.id}
                            checked={seedAns[q.id] === k}
                            onChange={() =>
                              setSeedAns((prev) => ({ ...prev, [q.id]: k }))
                            }
                          />
                          {ANSWER_LABEL[k]}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded border px-3 py-2"
                  onClick={() => {
                    setSeedAns({});
                    showToast("選択をクリアしました", { type: "info" });
                  }}
                >
                  クリア
                </button>
                <button
                  className="rounded bg-black text-white px-3 py-2 disabled:opacity-50"
                  disabled={!Object.keys(seedAns).length || !sessionId}
                  onClick={async () => {
                    try {
                      // 回答を /actions に投げて出力をチューニング
                      const filled = seedQs
                        .filter((q) => seedAns[q.id])
                        .map((q) => ({ q, a: seedAns[q.id]! }));
                      const instruction =
                        formatSeedAnswersForInstruction(filled);
                      const res = await fetch(
                        `/api/sessions/${sessionId}/actions`,
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ instruction }),
                        }
                      );
                      const data = await res.json();
                      if (!res.ok)
                        throw new Error(data?.message || "反映に失敗しました");
                      setSessionData(data as any);
                      setSeedApplied(true);
                      showToast("回答を反映しました", { type: "success" });
                    } catch (e: any) {
                      showToast(String(e?.message || e), { type: "error" });
                    }
                  }}
                >
                  反映する
                </button>
              </div>
            </section>
          )}

          {/* 2) ストレングス（ベータ）＝ペルソナ＋1on1カード */}
          {(() => {
            const persona = (sessionData?.output ?? create.data!.output)
              .persona;
            return persona ? (
              <section className="space-y-2">
                <h2 className="text-xl font-semibold">
                  ストレングス（ベータ）
                </h2>
                <PersonaView profile={persona} />
              </section>
            ) : null;
          })()}
        </div>
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
                          onClick={async () => {
                            try {
                              await navigator.clipboard?.writeText(s);
                              showToast("コピーしました", { type: "success" });
                            } catch {
                              showToast("コピーできませんでした", {
                                type: "error",
                              });
                            }
                          }}
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

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
