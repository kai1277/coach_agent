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

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'ログインに失敗しました');
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
      console.error('Login error:', err);
      setError(err.message || 'ログインに失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {import.meta.env.DEV && <HealthCheck />}
      <div className="max-w-md mx-auto mt-16 space-y-6 px-4">
        <h1 className="text-2xl font-semibold text-center">ログイン</h1>
        <p className="text-sm text-gray-600 text-center">
          登録したメールアドレスを入力してログインしてください。
        </p>
        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">メールアドレス</span>
            <input
              type="email"
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="coach@example.com"
              disabled={isLoading}
              required
            />
          </label>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-md bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {isLoading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
        <button
          type="button"
          className="w-full text-sm text-blue-600 hover:underline"
          onClick={() => navigate('/register')}
          disabled={isLoading}
        >
          アカウントをお持ちでない方はこちら
        </button>
      </div>
    </div>
  );
}
