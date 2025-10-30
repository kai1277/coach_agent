import React from "react";
import {
  AGE_BANDS,
  GENDERS,
  REGIONS,
  PREFECTURES_BY_REGION,
  type AgeBand,
  type Gender,
  type Region,
} from "../constants/demographics";

export type IdentityValue = {
  ageBand?: AgeBand | null;
  gender?: Gender | null;
  region?: Region | null;
  prefecture?: string | null;
};

export default function IdentityPicker({
  value,
  onChange,
}: {
  value: IdentityValue;
  onChange: (v: IdentityValue) => void;
}) {
  const { ageBand, gender, region, prefecture } = value;
  const prefs = region ? PREFECTURES_BY_REGION[region] : [];

  const selectClass =
    "rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100";

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">年齢帯（任意）</span>
        <select
          className={selectClass}
          value={ageBand ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              ageBand: (e.target.value || null) as AgeBand | null,
            })
          }
        >
          <option value="">— 未選択 —</option>
          {AGE_BANDS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">性別（任意）</span>
        <select
          className={selectClass}
          value={gender ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              gender: (e.target.value || null) as Gender | null,
            })
          }
        >
          <option value="">— 未選択 —</option>
          {GENDERS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">出身（地方・任意）</span>
        <select
          className={selectClass}
          value={region ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              region: (e.target.value || null) as Region | null,
              prefecture: null, // 地方変更時は県をクリア
            })
          }
        >
          <option value="">— 未選択 —</option>
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">都道府県（任意）</span>
        <select
          className={selectClass}
          disabled={!region}
          value={prefecture ?? ""}
          onChange={(e) =>
            onChange({ ...value, prefecture: e.target.value || null })
          }
        >
          <option value="">— 未選択 —</option>
          {prefs.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
