import React from "react";
import { useNavigate } from "react-router-dom";
import HealthCheck from "../components/HealthCheck";

interface BasicInfo {
  age?: string;
  location?: string;
  note?: string;
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

export default function UserInfoPage() {
  const navigate = useNavigate();
  const [user, setUser] = React.useState<UserProfile | null>(null);
  const [department, setDepartment] = React.useState("");
  const [role, setRole] = React.useState("");
  const [goal, setGoal] = React.useState("");

  // localStorageからユーザー情報を復元
  React.useEffect(() => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        setUser(parsed);
        setDepartment(parsed.department ?? "");
        setRole(parsed.role ?? "");
        setGoal(parsed.goal ?? "");
      } catch (err) {
        console.error('Failed to parse saved user:', err);
        localStorage.removeItem('user');
        navigate('/login');
      }
    } else {
      navigate('/login');
    }
  }, [navigate]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;

    const updatedUser = {
      ...user,
      department: department.trim() || undefined,
      role: role.trim() || undefined,
      goal: goal.trim() || undefined,
    };

    setUser(updatedUser);
    localStorage.setItem('user', JSON.stringify(updatedUser));
  };

  const handleLogout = () => {
    localStorage.removeItem('user');
    navigate('/login');
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {import.meta.env.DEV && <HealthCheck />}
      <div className="max-w-2xl mx-auto mt-12 space-y-8 px-4 pb-12">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{user.username}さんの情報</h1>
            {user.email ? (
              <p className="text-sm text-gray-600">{user.email}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleLogout}
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
            onClick={() => navigate('/strengths')}
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
            onClick={() => navigate('/session')}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            セッション画面へ
          </button>
        </div>
      </div>
    </div>
  );
}
