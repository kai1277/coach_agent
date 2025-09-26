// Auto-generated 風の手書き型（OpenAPIに整合）

// 34資質（ストレングスファインダー）
export type StrengthTheme =
  | "達成欲"
  | "活発性"
  | "適応性"
  | "分析思考"
  | "アレンジ"
  | "信念"
  | "指令性"
  | "コミュニケーション"
  | "競争性"
  | "共感性"
  | "公平性"
  | "原点思考"
  | "未来志向"
  | "調和性"
  | "着想"
  | "包含"
  | "個別化"
  | "収集心"
  | "成長促進"
  | "内省"
  | "親密性"
  | "学習欲"
  | "最上志向"
  | "ポジティブ"
  | "規律性"
  | "回復志向"
  | "責任感"
  | "自我"
  | "自己確信"
  | "戦略性"
  | "社交性"
  | "慎重さ"
  | "運命思考"
  | "目標志向";

// 診断タイプ（5分類）
export type TypeKey =
  | "TYPE_STRATEGY"
  | "TYPE_EMPATHY"
  | "TYPE_EXECUTION"
  | "TYPE_ANALYTICAL"
  | "TYPE_STABILITY";

// 5段階回答
export type Answer5 = "YES" | "PROB_YES" | "UNKNOWN" | "PROB_NO" | "NO";

// 旧：エンティティID（必要なら併用可）
export type EntityId = TypeKey;

export type Citation = { text: string; anchor: string };

// ★ Top5 から生成するプロフィール（特徴/マネジメント）
export { computeStrengthProfileFromTop5 as buildStrengthProfile };

export type StrengthProfile = {
  perTheme: { theme: string; traits: string[]; management: string[] }[];
  summarizedTraits: string[];
  summarizedManagement: string[];
};

export type SessionOutput = {
  summary: string;
  hypotheses: string[];
  next_steps: string[];
  citations: Citation[];
  counter_questions?: string[];
  // Top5 由来のプロフィール
  persona?: StrengthProfile;
};

export type Posterior = Record<TypeKey, number>;

export type LoopQuestion = { id: string; text: string };

export type EvidenceItem = {
  questionId: string;
  text: string;
  answer: Answer5;
  delta: number;
};

export type LoopFetchInProgress = {
  done: false;
  question: LoopQuestion | null;
  progress: { asked: number; max: number };
  hint: { topLabel: string; confidence: number };
  posterior: Posterior;
};

export type LoopFetchDone = {
  done: true;
  top: { id: TypeKey; label: string; confidence: number };
  next_steps: string[];
  asked: number;
  max: number;
  posterior: Posterior;
  evidence?: EvidenceItem[];
};

export type LoopFetch = LoopFetchInProgress | LoopFetchDone;

export type Session = {
  id: string;
  createdAt: string; // ISO datetime
  output: SessionOutput;
  // minQuestions はモックでは任意扱いなので optional にしておく
  loop?: { threshold: number; maxQuestions: number; minQuestions?: number };
  strengths_top5?: StrengthTheme[]; // 文字列でも可だが候補制約のため型付け
};

export type ApiError = { code: string; message: string };

// API レスポンス（GET /api/sessions/:id）
export type SessionGetResponse = {
  id: string;
  createdAt: string;
  output: {
    summary: string;
    hypotheses: string[];
    next_steps: string[];
    citations: { text: string; anchor: string }[];
    counter_questions?: string[];
    persona?: StrengthProfile; // ←追加
  };
  loop: { threshold: number; maxQuestions: number };
};
