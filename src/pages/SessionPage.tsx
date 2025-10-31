import React from "react";
import { useNavigate } from "react-router-dom";
import SessionCards from "../features/coach/components/SessionCards";
import HealthCheck from "../components/HealthCheck";
import type { SessionGetResponse } from "../types/api";

interface BasicInfo {
  age?: string;
  gender?: string;
  hometown?: string;
}

interface UserProfile {
  id?: string;
  username: string;
  email?: string;
  department?: string;
  role?: string;
  goal?: string;
  strengthsTop5: string[];
  basicInfo?: BasicInfo;
}

export default function SessionPage() {
  const navigate = useNavigate();
  const [user, setUser] = React.useState<UserProfile | null>(null);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [sessionData, setSessionData] = React.useState<SessionGetResponse | null>(null);
  const [isLoadingSession, setIsLoadingSession] = React.useState(false);

  // localStorageからユーザー情報を復元
  React.useEffect(() => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        setUser(parsed);
      } catch (err) {
        console.error('Failed to parse saved user:', err);
        localStorage.removeItem('user');
        navigate('/login');
      }
    } else {
      navigate('/login');
    }
  }, [navigate]);

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
    if (isCreating || !user) return;
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
            gender: user?.basicInfo?.gender,
            hometown: user?.basicInfo?.hometown,
          },
          userId: user?.id || null,
        }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Session creation failed:', errorData);
        throw new Error(errorData.error || "failed to create session");
      }
      const json = await res.json();
      setSessionId(json.id);
      // セッション作成後、コーチング画面に遷移
      navigate(`/app/coach?session=${json.id}`);
    } catch (error: any) {
      console.error('Session creation error:', error);
      console.log('User data:', user);
      alert(`セッションの作成に失敗しました: ${error.message || '時間をおいて再度お試しください。'}`);
    } finally {
      setIsCreating(false);
    }
  };

  React.useEffect(() => {
    if (sessionId && !sessionData && !isLoadingSession) {
      void loadSession(sessionId);
    }
  }, [sessionId, sessionData, isLoadingSession, loadSession]);

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {import.meta.env.DEV && <HealthCheck />}
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
            onClick={() => navigate('/user-info')}
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
            {user.basicInfo?.gender ? (
              <p>性別: {user.basicInfo.gender}</p>
            ) : null}
            {user.basicInfo?.hometown ? <p>出身: {user.basicInfo.hometown}</p> : null}
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
            onClick={handleCreateSession}
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
                onClick={() => sessionId && loadSession(sessionId)}
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
    </div>
  );
}
