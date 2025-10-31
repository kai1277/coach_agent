import React from "react";
import { useNavigate } from "react-router-dom";
import { STRENGTH_THEMES } from "../features/coach/constants/strengths";
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

export default function StrengthsPage() {
  const navigate = useNavigate();
  const [user, setUser] = React.useState<UserProfile | null>(null);
  const [strengths, setStrengths] = React.useState<string[]>([]);
  const [age, setAge] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [note, setNote] = React.useState("");

  // localStorageからユーザー情報を復元
  React.useEffect(() => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        setUser(parsed);

        // ストレングスを初期化（5つまで）
        const base = [...(parsed.strengthsTop5 || [])];
        while (base.length < 5) {
          base.push("");
        }
        setStrengths(base);

        setAge(parsed.basicInfo?.age ?? "");
        setLocation(parsed.basicInfo?.location ?? "");
        setNote(parsed.basicInfo?.note ?? "");
      } catch (err) {
        console.error('Failed to parse saved user:', err);
        localStorage.removeItem('user');
        navigate('/login');
      }
    } else {
      navigate('/login');
    }
  }, [navigate]);

  const handleStrengthChange = (index: number, value: string) => {
    setStrengths((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;

    const filteredStrengths = strengths
      .map((item) => item.trim())
      .filter((item) => item !== "")
      .slice(0, 5);

    const updatedUser = {
      ...user,
      strengthsTop5: filteredStrengths,
      basicInfo: {
        age: age.trim() || undefined,
        location: location.trim() || undefined,
        note: note.trim() || undefined,
      },
    };

    setUser(updatedUser);
    localStorage.setItem('user', JSON.stringify(updatedUser));
    navigate('/user-info');
  };

  // 選択済みの資質を除外したリストを生成
  const getAvailableStrengths = (currentIndex: number) => {
    const selectedStrengths = strengths.filter((s, i) => s && i !== currentIndex);
    return STRENGTH_THEMES.filter(theme => !selectedStrengths.includes(theme));
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {import.meta.env.DEV && <HealthCheck />}
      <div className="max-w-2xl mx-auto mt-12 space-y-6 px-4 pb-12">
        <h1 className="text-2xl font-semibold">ストレングス Top5・基本情報</h1>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-3 rounded-lg border p-4">
            <h2 className="text-lg font-medium">ストレングス Top5</h2>
            <p className="text-sm text-gray-600">
              あなたの強みとなる資質を5つまで選択してください。
            </p>
            <div className="space-y-2">
              {strengths.map((strength, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-700 w-6">
                    {index + 1}.
                  </span>
                  <select
                    className="flex-1 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
                    value={strength}
                    onChange={(event) =>
                      handleStrengthChange(index, event.target.value)
                    }
                  >
                    <option value="">選択してください</option>
                    {strength && !STRENGTH_THEMES.includes(strength as any) && (
                      <option value={strength}>{strength}</option>
                    )}
                    {getAvailableStrengths(index).map((theme) => (
                      <option key={theme} value={theme}>
                        {theme}
                      </option>
                    ))}
                  </select>
                </div>
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
              onClick={() => navigate('/user-info')}
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
    </div>
  );
}
