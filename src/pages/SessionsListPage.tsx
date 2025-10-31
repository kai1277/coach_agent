import React from "react";
import { useNavigate } from "react-router-dom";
import HealthCheck from "../components/HealthCheck";

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

export default function SessionsListPage() {
  const navigate = useNavigate();
  const [user, setUser] = React.useState<UserProfile | null>(null);
  const [sessions, setSessions] = React.useState<any[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

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

  // セッション一覧を取得
  const loadSessions = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/sessions?limit=50');
      if (!res.ok) {
        throw new Error('Failed to load sessions');
      }
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (error) {
      console.error('Error loading sessions:', error);
      alert('セッション一覧の取得に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 初回マウント時にセッション一覧を取得
  React.useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // セッション削除
  const handleDelete = async (sessionId: string) => {
    if (!confirm('このセッションを削除しますか？')) {
      return;
    }

    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Failed to delete session');
      }

      // 一覧から削除
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      alert('セッションを削除しました。');
    } catch (error) {
      console.error('Error deleting session:', error);
      alert('セッションの削除に失敗しました。');
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {import.meta.env.DEV && <HealthCheck />}
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">過去のセッション</h1>
            <p className="text-sm text-gray-600">
              これまでのコーチングセッションの履歴です
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate('/session')}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              セッション画面へ
            </button>
            <button
              type="button"
              onClick={() => navigate('/user-info')}
              className="text-sm text-gray-500 underline"
            >
              ユーザー情報に戻る
            </button>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4">
          {isLoading ? (
            <div className="py-8 text-center">
              <p className="text-sm text-gray-600">読み込み中...</p>
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-gray-600">まだセッションはありません。</p>
              <button
                type="button"
                onClick={() => navigate('/session')}
                className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                新しいセッションを作成
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between rounded-md border p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {session.title || "無題のセッション"}
                    </p>
                    {session.summary && (
                      <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                        {session.summary}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      作成日時: {new Date(session.created_at).toLocaleString('ja-JP', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <button
                      type="button"
                      onClick={() => navigate(`/app/coach?session=${session.id}`)}
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      開く
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(session.id)}
                      className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
