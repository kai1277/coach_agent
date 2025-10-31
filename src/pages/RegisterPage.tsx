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

export default function RegisterPage() {
  const navigate = useNavigate();
  const [username, setUsername] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [department, setDepartment] = React.useState("");
  const [role, setRole] = React.useState("");
  const [goal, setGoal] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: trimmed,
          email: email.trim() || undefined,
          department: department.trim() || undefined,
          role: role.trim() || undefined,
          goal: goal.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'ユーザー登録に失敗しました');
      }

      const data = await res.json();
      const profile: UserProfile = {
        id: data.id,
        username: data.username || data.display_name,
        email: data.email,
        department: data.department,
        role: data.role,
        goal: data.goal,
        strengthsTop5: data.strengthsTop5 || [],
        basicInfo: data.basicInfo || {},
      };

      // localStorageに保存
      localStorage.setItem('user', JSON.stringify(profile));

      // ユーザー情報画面へ遷移
      navigate('/user-info');
    } catch (err: any) {
      console.error('Registration error:', err);
      setError(err.message || 'ユーザー登録に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {import.meta.env.DEV && <HealthCheck />}
      <div className="max-w-md mx-auto mt-16 space-y-6 px-4">
        <h1 className="text-2xl font-semibold text-center">ユーザー登録</h1>
        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">ユーザーネーム *</span>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="coach_taro"
              required
              disabled={isLoading}
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
              disabled={isLoading}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">部署</span>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              placeholder="プロダクトマネジメント"
              disabled={isLoading}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">役割</span>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder="マネージャー"
              disabled={isLoading}
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
              disabled={isLoading}
            />
          </label>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-md bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {isLoading ? '登録中...' : '登録して進む'}
          </button>
        </form>
        <button
          type="button"
          className="w-full text-sm text-blue-600 hover:underline"
          onClick={() => navigate('/login')}
          disabled={isLoading}
        >
          すでにアカウントをお持ちの方はこちら
        </button>
      </div>
    </div>
  );
}
