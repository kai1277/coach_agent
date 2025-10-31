import React from "react";
import SessionCards from "./features/coach/components/SessionCards";
import HealthCheck from "./components/HealthCheck";
import type { SessionGetResponse } from "./types/api";

type AppStage = "login" | "register" | "userInfo" | "strengths" | "session";

interface BasicInfo {
  age?: string;
  location?: string;
  note?: string;
}

interface UserProfile {
  username: string;
  email?: string;
  department?: string;
  role?: string;
  goal?: string;
  strengthsTop5: string[];
  basicInfo?: BasicInfo;
}

interface LoginViewProps {
  onLogin: (username: string) => void;
  onNavigateToRegister: () => void;
}

interface RegisterViewProps {
  onRegister: (profile: UserProfile) => void;
  onNavigateToLogin: () => void;
}

interface UserInfoViewProps {
  user: UserProfile;
  onUpdate: (profile: Partial<UserProfile>) => void;
  onNavigateToStrengths: () => void;
  onNavigateToSession: () => void;
  onLogout: () => void;
}

interface StrengthsViewProps {
  user: UserProfile;
  onSave: (data: { strengthsTop5: string[]; basicInfo: BasicInfo }) => void;
  onBack: () => void;
}

interface SessionViewProps {
  user: UserProfile;
  sessionId: string | null;
  sessionData: SessionGetResponse | null;
  isCreating: boolean;
  isLoadingSession: boolean;
  onCreateSession: () => void;
  onReloadSession: () => void;
  onBack: () => void;
}

function LoginView({ onLogin, onNavigateToRegister }: LoginViewProps) {
  const [username, setUsername] = React.useState("");

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) {
      return;
    }
    onLogin(trimmed);
    setUsername("");
  };

  return (
    <div className="max-w-md mx-auto mt-16 space-y-6">
      <h1 className="text-2xl font-semibold text-center">ログイン</h1>
      <p className="text-sm text-gray-600 text-center">
        ユーザーネームを入力するだけでログインできます。
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">ユーザーネーム</span>
          <input
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="coach_taro"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-md bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          ログイン
        </button>
      </form>
      <button
        type="button"
        className="w-full text-sm text-blue-600 hover:underline"
        onClick={onNavigateToRegister}
      >
        アカウントをお持ちでない方はこちら
      </button>
    </div>
  );
}

function RegisterView({ onRegister, onNavigateToLogin }: RegisterViewProps) {
  const [username, setUsername] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [department, setDepartment] = React.useState("");
  const [role, setRole] = React.useState("");
  const [goal, setGoal] = React.useState("");

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) {
      return;
    }
    onRegister({
      username: trimmed,
      email: email.trim() || undefined,
      department: department.trim() || undefined,
      role: role.trim() || undefined,
      goal: goal.trim() || undefined,
      strengthsTop5: [],
    });
    setUsername("");
    setEmail("");
    setDepartment("");
    setRole("");
    setGoal("");
  };

  return (
    <div className="max-w-md mx-auto mt-16 space-y-6">
      <h1 className="text-2xl font-semibold text-center">ユーザー登録</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">ユーザーネーム *</span>
          <input
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="coach_taro"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">メールアドレス</span>
          <input
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="coach@example.com"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">部署</span>
          <input
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            placeholder="プロダクトマネジメント"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">役割</span>
          <input
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder="マネージャー"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">1on1で達成したいこと</span>
          <textarea
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
            rows={3}
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="上司との合意形成をスムーズにしたい"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-md bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          登録して進む
        </button>
      </form>
      <button
        type="button"
        className="w-full text-sm text-blue-600 hover:underline"
        onClick={onNavigateToLogin}
      >
        すでにアカウントをお持ちの方はこちら
      </button>
    </div>
  );
}

function UserInfoView({
  user,
  onUpdate,
  onNavigateToStrengths,
  onNavigateToSession,
  onLogout,
}: UserInfoViewProps) {
  const [department, setDepartment] = React.useState(user.department ?? "");
  const [role, setRole] = React.useState(user.role ?? "");
  const [goal, setGoal] = React.useState(user.goal ?? "");

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onUpdate({
      department: department.trim() || undefined,
      role: role.trim() || undefined,
      goal: goal.trim() || undefined,
    });
  };

  return (
    <div className="max-w-2xl mx-auto mt-12 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{user.username}さんの情報</h1>
          {user.email ? (
            <p className="text-sm text-gray-600">{user.email}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="text-sm text-gray-500 underline"
        >
          ログアウト
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border p-4">
        <h2 className="text-lg font-medium">基本プロフィール</h2>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">部署</span>
          <input
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">役割</span>
          <input
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">1on1で達成したいこと</span>
          <textarea
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
            rows={3}
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          保存
        </button>
      </form>

      <div className="rounded-lg border p-4 space-y-3">
        <h2 className="text-lg font-medium">ストレングス Top5</h2>
        {user.strengthsTop5.length > 0 ? (
          <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1">
            {user.strengthsTop5.map((strength, index) => (
              <li key={index}>{strength}</li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-gray-600">
            まだ登録されていません。下のボタンから登録してください。
          </p>
        )}
        <button
          type="button"
          onClick={onNavigateToStrengths}
          className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50"
        >
          ストレングス・基本情報を登録する
        </button>
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <h2 className="text-lg font-medium">セッション</h2>
        <p className="text-sm text-gray-600">
          プロフィールをもとにコーチングセッションを開始できます。
        </p>
        <button
          type="button"
          onClick={onNavigateToSession}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          セッション画面へ
        </button>
      </div>
    </div>
  );
}

function StrengthsView({ user, onSave, onBack }: StrengthsViewProps) {
  const [strengths, setStrengths] = React.useState(() => {
    const base = [...user.strengthsTop5];
    while (base.length < 5) {
      base.push("");
    }
    return base;
  });
  const [age, setAge] = React.useState(user.basicInfo?.age ?? "");
  const [location, setLocation] = React.useState(user.basicInfo?.location ?? "");
  const [note, setNote] = React.useState(user.basicInfo?.note ?? "");

  const handleStrengthChange = (index: number, value: string) => {
    setStrengths((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const filteredStrengths = strengths
      .map((item) => item.trim())
      .filter((item) => item !== "")
      .slice(0, 5);
    onSave({
      strengthsTop5: filteredStrengths,
      basicInfo: {
        age: age.trim() || undefined,
        location: location.trim() || undefined,
        note: note.trim() || undefined,
      },
    });
  };

  return (
    <div className="max-w-2xl mx-auto mt-12 space-y-6">
      <h1 className="text-2xl font-semibold">ストレングス Top5・基本情報</h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-3 rounded-lg border p-4">
          <h2 className="text-lg font-medium">ストレングス Top5</h2>
          <p className="text-sm text-gray-600">
            特徴的だと思う資質を5つまで入力してください。
          </p>
          <div className="space-y-2">
            {strengths.map((strength, index) => (
              <input
                key={index}
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
                value={strength}
                onChange={(event) =>
                  handleStrengthChange(index, event.target.value)
                }
                placeholder={`資質 ${index + 1}`}
              />
            ))}
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <h2 className="text-lg font-medium">基本情報</h2>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">年齢</span>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
              value={age}
              onChange={(event) => setAge(event.target.value)}
              placeholder="32"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">勤務地</span>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="東京 / リモート"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">その他メモ</span>
            <textarea
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="プロジェクトAのリードとして活動中"
            />
          </label>
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            戻る
          </button>
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

function SessionView({
  user,
  sessionId,
  sessionData,
  isCreating,
  isLoadingSession,
  onCreateSession,
  onReloadSession,
  onBack,
}: SessionViewProps) {
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">セッション画面</h1>
          <p className="text-sm text-gray-600">
            {user.username}さんのプロフィールにもとづいてセッションを開始できます。
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-gray-500 underline"
        >
          ユーザー情報に戻る
        </button>
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <h2 className="text-lg font-medium">プロフィール概要</h2>
        <div className="text-sm text-gray-700 space-y-1">
          <p>部署: {user.department ?? "未設定"}</p>
          <p>役割: {user.role ?? "未設定"}</p>
          <p>1on1で達成したいこと: {user.goal ?? "未設定"}</p>
          {user.basicInfo?.age ? <p>年齢: {user.basicInfo.age}</p> : null}
          {user.basicInfo?.location ? (
            <p>勤務地: {user.basicInfo.location}</p>
          ) : null}
          {user.basicInfo?.note ? <p>メモ: {user.basicInfo.note}</p> : null}
        </div>
        {user.strengthsTop5.length > 0 ? (
          <div>
            <p className="text-sm font-medium">ストレングス Top5</p>
            <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1">
              {user.strengthsTop5.map((strength, index) => (
                <li key={index}>{strength}</li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <h2 className="text-lg font-medium">セッション操作</h2>
        <button
          type="button"
          onClick={onCreateSession}
          disabled={isCreating}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
        >
          {isCreating ? "作成中..." : "新しいセッションを作成"}
        </button>
        {sessionId ? (
          <div className="space-y-2 text-sm text-gray-600">
            <p>最新のセッションID: {sessionId}</p>
            <button
              type="button"
              onClick={onReloadSession}
              disabled={isLoadingSession}
              className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoadingSession ? "読込中..." : "セッション情報を再読込"}
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-600">まだセッションは作成されていません。</p>
        )}
      </div>

      {sessionData ? (
        <SessionCards data={sessionData} />
      ) : sessionId ? (
        <p className="text-sm text-gray-600">
          セッション情報を読み込み中です。しばらくお待ちください。
        </p>
      ) : null}
    </div>
  );
}

export default function App() {
  const [stage, setStage] = React.useState<AppStage>("login");
  const [user, setUser] = React.useState<UserProfile | null>(null);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [sessionData, setSessionData] = React.useState<SessionGetResponse | null>(null);
  const [isLoadingSession, setIsLoadingSession] = React.useState(false);

  const loadSession = React.useCallback(
    async (id: string) => {
      setIsLoadingSession(true);
      try {
        const res = await fetch(`/api/sessions/${id}`);
        if (!res.ok) {
          throw new Error("failed to load session");
        }
        const data: SessionGetResponse = await res.json();
        setSessionData(data);
      } catch (error) {
        console.error(error);
        alert("セッション情報の取得に失敗しました。");
      } finally {
        setIsLoadingSession(false);
      }
    },
    [],
  );

  const handleCreateSession = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript:
            user?.goal ??
            "1on1で取り組みたい課題について自由に記入してください。",
          context: "コーチング",
          strengths_top5: user?.strengthsTop5 ?? [],
          demographics: {
            department: user?.department,
            role: user?.role,
            age: user?.basicInfo?.age,
            location: user?.basicInfo?.location,
          },
        }),
      });
      if (!res.ok) {
        throw new Error("failed to create session");
      }
      const json = await res.json();
      setSessionId(json.id);
      await loadSession(json.id);
    } catch (error) {
      console.error(error);
      alert("セッションの作成に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setIsCreating(false);
    }
  };

  const resetSession = () => {
    setSessionId(null);
    setSessionData(null);
  };

  const handleLogout = () => {
    setUser(null);
    resetSession();
    setStage("login");
  };

  React.useEffect(() => {
    if (stage === "session" && sessionId && !sessionData && !isLoadingSession) {
      void loadSession(sessionId);
    }
  }, [stage, sessionId, sessionData, isLoadingSession, loadSession]);

  return (
    <div className="min-h-screen bg-gray-50">
      {import.meta.env.DEV && <HealthCheck />}
      <div className="mx-auto max-w-5xl px-4 pb-12">
        {stage === "login" ? (
          <LoginView
            onLogin={(username) => {
              setUser({ username, strengthsTop5: [] });
              resetSession();
              setStage("userInfo");
            }}
            onNavigateToRegister={() => setStage("register")}
          />
        ) : null}

        {stage === "register" ? (
          <RegisterView
            onRegister={(profile) => {
              setUser(profile);
              resetSession();
              setStage("userInfo");
            }}
            onNavigateToLogin={() => setStage("login")}
          />
        ) : null}

        {stage === "userInfo" && user ? (
          <UserInfoView
            user={user}
            onUpdate={(profile) => setUser((prev) => (prev ? { ...prev, ...profile } : prev))}
            onNavigateToStrengths={() => setStage("strengths")}
            onNavigateToSession={() => setStage("session")}
            onLogout={handleLogout}
          />
        ) : null}

        {stage === "strengths" && user ? (
          <StrengthsView
            user={user}
            onSave={({ strengthsTop5, basicInfo }) => {
              setUser((prev) =>
                prev
                  ? {
                      ...prev,
                      strengthsTop5,
                      basicInfo,
                    }
                  : prev,
              );
              resetSession();
              setStage("userInfo");
            }}
            onBack={() => setStage("userInfo")}
          />
        ) : null}

        {stage === "session" && user ? (
          <SessionView
            user={user}
            sessionId={sessionId}
            sessionData={sessionData}
            isCreating={isCreating}
            isLoadingSession={isLoadingSession}
            onCreateSession={handleCreateSession}
            onReloadSession={() => {
              if (sessionId) {
                void loadSession(sessionId);
              }
            }}
            onBack={() => setStage("userInfo")}
          />
        ) : null}
      </div>
    </div>
  );
}
