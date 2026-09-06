import { useState } from "react";

export default function UrlInputBar({ onSave, loading, inputRef }) {
  const [url, setUrl] = useState("");
  const [focused, setFocused] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setUrl("");
  }

  const hasUrl = url.trim().length > 0;

  return (
    <div className="arciv-saver-wrap" style={{ width: "100%" }}>
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          height: 42, padding: "0 6px 0 14px",
          background: "var(--surface)",
          borderRadius: 12,
          boxShadow: "0 1px 0 rgba(255,255,255,.6) inset, 0 1px 2px rgba(22,21,19,.04)",
          position: "relative",
        }}
      >
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke={focused ? "var(--accent)" : "var(--muted-2)"}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transition: "stroke .2s" }}
        >
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
        </svg>
        <input
          ref={inputRef}
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Paste a URL to save…"
          style={{
            flex: 1, border: 0, outline: 0, background: "transparent",
            fontSize: 14, color: "var(--ink)", minWidth: 0,
            fontFamily: "inherit",
          }}
        />
        {!hasUrl && (
          <span style={{
            fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--muted-2)",
            padding: "2px 6px", borderRadius: 5,
            background: "var(--surface-2)", border: "1px solid var(--line)",
            flexShrink: 0,
          }}>
            ⌘V
          </span>
        )}
        <button
          type="submit"
          disabled={loading || !hasUrl}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            height: 32, padding: "0 14px", border: 0, borderRadius: 8,
            fontSize: 13, fontWeight: 500, cursor: loading || !hasUrl ? "default" : "pointer",
            background: loading || !hasUrl ? "var(--accent-tint-2)" : "var(--accent)",
            color: loading || !hasUrl ? "#a08bd9" : "#fff",
            transition: "transform .08s, background .15s, box-shadow .15s",
            flexShrink: 0,
            boxShadow: !loading && hasUrl
              ? "0 1px 0 rgba(255,255,255,.25) inset, 0 1px 3px color-mix(in oklab, var(--accent) 40%, transparent)"
              : "none",
          }}
          onMouseEnter={e => { if (!loading && hasUrl) e.currentTarget.style.background = "var(--accent-deep)"; }}
          onMouseLeave={e => { if (!loading && hasUrl) e.currentTarget.style.background = "var(--accent)"; }}
          onMouseDown={e => { if (!loading && hasUrl) e.currentTarget.style.transform = "translateY(1px)"; }}
          onMouseUp={e => { e.currentTarget.style.transform = "translateY(0)"; }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2 14 9l7 2-7 2-2 7-2-7-7-2 7-2 2-7Z" />
          </svg>
          {loading ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}
