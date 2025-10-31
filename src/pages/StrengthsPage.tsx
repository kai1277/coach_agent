import React from "react";
import { useNavigate } from "react-router-dom";
import { STRENGTH_THEMES } from "../features/coach/constants/strengths";
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

export default function StrengthsPage() {
  const navigate = useNavigate();
  const [user, setUser] = React.useState<UserProfile | null>(null);
  const [strengths, setStrengths] = React.useState<string[]>([]);
  const [age, setAge] = React.useState("");
  const [gender, setGender] = React.useState("");
  const [hometown, setHometown] = React.useState("");

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
        setGender(parsed.basicInfo?.gender ?? "");
        setHometown(parsed.basicInfo?.hometown ?? "");
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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;

    const filteredStrengths = strengths
      .map((item) => item.trim())
      .filter((item) => item !== "")
      .slice(0, 5);

    const updatedBasicInfo = {
      age: age.trim() || undefined,
      gender: gender.trim() || undefined,
      hometown: hometown.trim() || undefined,
    };

    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strengthsTop5: filteredStrengths,
          basicInfo: updatedBasicInfo,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to update user profile');
      }

      const updatedUser = await res.json();
      setUser(updatedUser);
      localStorage.setItem('user', JSON.stringify(updatedUser));
      navigate('/user-info');
    } catch (error) {
      console.error('Error updating profile:', error);
      alert('プロフィールの更新に失敗しました。');
    }
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
              <select
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
                value={age}
                onChange={(event) => setAge(event.target.value)}
              >
                <option value="">選択してください</option>
                <option value="10代">10代</option>
                <option value="20代">20代</option>
                <option value="30代">30代</option>
                <option value="40代">40代</option>
                <option value="50代">50代</option>
                <option value="60代以上">60代以上</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">性別</span>
              <select
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
                value={gender}
                onChange={(event) => setGender(event.target.value)}
              >
                <option value="">選択してください</option>
                <option value="男性">男性</option>
                <option value="女性">女性</option>
                <option value="その他">その他</option>
                <option value="回答しない">回答しない</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">出身</span>
              <select
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring"
                value={hometown}
                onChange={(event) => setHometown(event.target.value)}
              >
                <option value="">選択してください</option>
                <option value="北海道">北海道</option>
                <option value="青森県">青森県</option>
                <option value="岩手県">岩手県</option>
                <option value="宮城県">宮城県</option>
                <option value="秋田県">秋田県</option>
                <option value="山形県">山形県</option>
                <option value="福島県">福島県</option>
                <option value="茨城県">茨城県</option>
                <option value="栃木県">栃木県</option>
                <option value="群馬県">群馬県</option>
                <option value="埼玉県">埼玉県</option>
                <option value="千葉県">千葉県</option>
                <option value="東京都">東京都</option>
                <option value="神奈川県">神奈川県</option>
                <option value="新潟県">新潟県</option>
                <option value="富山県">富山県</option>
                <option value="石川県">石川県</option>
                <option value="福井県">福井県</option>
                <option value="山梨県">山梨県</option>
                <option value="長野県">長野県</option>
                <option value="岐阜県">岐阜県</option>
                <option value="静岡県">静岡県</option>
                <option value="愛知県">愛知県</option>
                <option value="三重県">三重県</option>
                <option value="滋賀県">滋賀県</option>
                <option value="京都府">京都府</option>
                <option value="大阪府">大阪府</option>
                <option value="兵庫県">兵庫県</option>
                <option value="奈良県">奈良県</option>
                <option value="和歌山県">和歌山県</option>
                <option value="鳥取県">鳥取県</option>
                <option value="島根県">島根県</option>
                <option value="岡山県">岡山県</option>
                <option value="広島県">広島県</option>
                <option value="山口県">山口県</option>
                <option value="徳島県">徳島県</option>
                <option value="香川県">香川県</option>
                <option value="愛媛県">愛媛県</option>
                <option value="高知県">高知県</option>
                <option value="福岡県">福岡県</option>
                <option value="佐賀県">佐賀県</option>
                <option value="長崎県">長崎県</option>
                <option value="熊本県">熊本県</option>
                <option value="大分県">大分県</option>
                <option value="宮崎県">宮崎県</option>
                <option value="鹿児島県">鹿児島県</option>
                <option value="沖縄県">沖縄県</option>
                <option value="海外">海外</option>
              </select>
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
