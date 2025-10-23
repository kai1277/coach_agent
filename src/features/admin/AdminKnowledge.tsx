import { useState } from "react";
import { apiClient } from "../../lib/apiClient";

export default function AdminKnowledge() {
  const [src, setSrc] = useState("web");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [chunksText, setChunksText] = useState("");

  const handleImport = async () => {
    const chunks = chunksText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((content) => ({ content }));

    const res = await apiClient("/api/knowledge/import", {
      method: "POST",
      body: JSON.stringify({ source: src, title, url: url || null, chunks }),
      headers: { "Content-Type": "application/json" },
    });
    const json = await res.json();
    alert(res.ok ? `OK: ${json.doc_id}` : `NG: ${json.error || "error"}`);
  };

  return (
    <div className="mx-auto max-w-2xl p-4 space-y-3">
      <h1 className="text-xl font-semibold">ナレッジ投入（簡易）</h1>

      <label className="block">
        <div className="text-sm">source</div>
        <input
          className="border rounded p-2 w-full"
          value={src}
          onChange={(e) => setSrc(e.target.value)}
        />
      </label>

      <label className="block">
        <div className="text-sm">title</div>
        <input
          className="border rounded p-2 w-full"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <label className="block">
        <div className="text-sm">url (任意)</div>
        <input
          className="border rounded p-2 w-full"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>

      <label className="block">
        <div className="text-sm">chunks（改行区切り）</div>
        <textarea
          className="border rounded p-2 w-full h-40"
          value={chunksText}
          onChange={(e) => setChunksText(e.target.value)}
        />
      </label>

      <button
        className="rounded bg-black text-white px-4 py-2"
        onClick={handleImport}
      >
        インポート
      </button>
    </div>
  );
}
