import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client.js";

const QUEUE_META = {
  "watch-later": { label: "Watch Later", color: "var(--watch)" },
  "read-later":  { label: "Read Later",  color: "var(--read)"  },
  "try-later":   { label: "Try Later",   color: "var(--try)"   },
  inbox:         { label: "Inbox",       color: "var(--inbox)" },
  archive:       { label: "Archive",     color: "var(--archive)" },
};

const CONTENT_TYPES = [
  { value: "article",        label: "Article" },
  { value: "video",          label: "Video" },
  { value: "tool",           label: "Tool / Product" },
  { value: "research-paper", label: "Research Paper" },
  { value: "newsletter",     label: "Newsletter" },
  { value: "podcast",        label: "Podcast" },
  { value: "other",          label: "Other" },
];

const AI_STATUS_LABEL = {
  pending:   { text: "Classifying…", color: "var(--inbox)" },
  done:      { text: "Classified",   color: "var(--try)"   },
  skipped:   { text: "Skipped",      color: "var(--muted)" },
  failed:    { text: "Failed",       color: "var(--bad)"   },
  "ai-failed": { text: "Failed",     color: "var(--bad)"   },
};

const OpenIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5"/>
  </svg>
);

const DOMAIN_COLORS = ["#6d3aff","#ff6b3d","#14a974","#2a6fdb","#b18800","#cc1a6f"];
function domainColor(d) {
  let h = 0;
  for (const c of d) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return DOMAIN_COLORS[h % DOMAIN_COLORS.length];
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// ── TagInput ──────────────────────────────────────────────────
function TagInput({ tags, onChange }) {
  const [input, setInput] = useState("");
  const inputRef = useRef(null);

  const addTag = useCallback((raw) => {
    const tag = raw.trim();
    if (!tag || tag.length > 50) return;
    if (tags.some(t => t.toLowerCase() === tag.toLowerCase())) return;
    if (tags.length >= 20) return;
    onChange([...tags, tag]);
    setInput("");
  }, [tags, onChange]);

  const removeTag = useCallback((idx) => {
    onChange(tags.filter((_, i) => i !== idx));
  }, [tags, onChange]);

  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && !input && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      style={{
        display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center",
        padding: "8px 10px", borderRadius: 10, cursor: "text",
        border: "1px solid var(--line)", background: "var(--surface-2)",
        minHeight: 40,
      }}
    >
      {tags.map((tag, i) => (
        <span key={i} className="arciv-ld-tag">
          {tag}
          <button type="button" onClick={(e) => { e.stopPropagation(); removeTag(i); }} aria-label={`Remove ${tag}`}>×</button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="arciv-ld-tag-input"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => { if (input.trim()) addTag(input); }}
        placeholder={tags.length === 0 ? "Add tags…" : ""}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
export default function LinkDetailDrawer({ link, onClose, onUpdate, onDelete, onRetryAI }) {
  // Keep content alive during close animation
  const [data, setData] = useState(link);
  const open = !!link;

  // Local editable state — synced from data
  const [notes, setNotes] = useState(data?.notes ?? "");
  const [tags, setTags] = useState(data?.ai_tags ?? []);
  const [queue, setQueue] = useState(data?.queue ?? "inbox");
  const [contentType, setContentType] = useState(data?.content_type ?? "");
  const [notesStatus, setNotesStatus] = useState("idle"); // idle | saving | saved | error
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [copied, setCopied] = useState(false);

  const notesTimerRef = useRef(null);
  const savedTimerRef = useRef(null);

  // Sync data + reset local state when link prop changes
  useEffect(() => {
    if (link) {
      setData(link);
      setNotes(link.notes ?? "");
      setTags(link.ai_tags ?? []);
      setQueue(link.queue ?? "inbox");
      setContentType(link.content_type ?? "");
      setNotesStatus("idle");
      setDeleteConfirm(false);
    } else {
      const t = setTimeout(() => setData(null), 340);
      return () => clearTimeout(t);
    }
  }, [link]);

  // Cleanup debounce timers on unmount
  useEffect(() => () => {
    clearTimeout(notesTimerRef.current);
    clearTimeout(savedTimerRef.current);
  }, []);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  // ── Patch helpers ──────────────────────────────────────────
  const patch = useCallback(async (payload) => {
    if (!data) return;
    try {
      const updated = await api.updateLink(data.id, payload);
      onUpdate(updated);
      return updated;
    } catch {
      return null;
    }
  }, [data, onUpdate]);

  // Notes — debounced auto-save on change
  const handleNotesChange = (val) => {
    setNotes(val);
    setNotesStatus("saving");
    clearTimeout(notesTimerRef.current);
    clearTimeout(savedTimerRef.current);
    notesTimerRef.current = setTimeout(async () => {
      const result = await patch({ notes: val });
      if (result) {
        setNotesStatus("saved");
        savedTimerRef.current = setTimeout(() => setNotesStatus("idle"), 2000);
      } else {
        setNotesStatus("error");
      }
    }, 800);
  };

  // Tags — save immediately on change
  const handleTagsChange = async (newTags) => {
    setTags(newTags);
    await patch({ ai_tags: newTags });
  };

  // Queue — save immediately
  const handleQueueChange = async (val) => {
    setQueue(val);
    await patch({ queue: val });
  };

  // Content type — save immediately
  const handleContentTypeChange = async (val) => {
    setContentType(val);
    await patch({ content_type: val });
  };

  // Mark done / Restore
  const handleToggleStatus = async () => {
    const newStatus = data.status === "done" ? "active" : "done";
    const updated = await patch({ status: newStatus });
    if (updated) onClose();
  };

  // Delete
  const handleDelete = async () => {
    if (!data) return;
    try {
      await api.deleteLink(data.id);
      onDelete(data.id);
      onClose();
    } catch {}
  };

  // Retry AI
  const handleRetryAI = async () => {
    if (!data) return;
    const updated = await onRetryAI(data.id);
    if (updated) setData(updated);
  };

  // Copy URL
  const handleCopy = () => {
    navigator.clipboard.writeText(data?.canonical_url ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!data) return null;

  let domain = data.canonical_url;
  try { domain = new URL(data.canonical_url).hostname.replace(/^www\./, ""); } catch {}
  const favColor = domainColor(domain);
  const favLetter = domain[0]?.toUpperCase() ?? "?";
  const queueMeta = QUEUE_META[data.status === "done" ? "archive" : (data.queue || "inbox")];
  const aiStatus = AI_STATUS_LABEL[data.ai_status] ?? { text: data.ai_status, color: "var(--muted)" };
  const isArchive = data.status === "done";

  return createPortal(
    <div className={`arciv-ld-root${open ? " open" : ""}`}>
      <div className="arciv-ld-scrim" onClick={onClose} />
      <div className="arciv-ld-panel" role="dialog" aria-modal="true">

        {/* ── Header ── */}
        <header style={{ padding: "20px 22px 16px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            {/* Favicon */}
            {data.favicon_url ? (
              <img
                src={data.favicon_url}
                alt=""
                width={36} height={36}
                onError={e => { e.currentTarget.style.display = "none"; e.currentTarget.nextSibling.style.display = "grid"; }}
                style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, objectFit: "contain", background: "var(--surface-2)", border: "1px solid var(--line)" }}
              />
            ) : null}
            <div
              style={{
                width: 36, height: 36, borderRadius: 9, flexShrink: 0, display: data.favicon_url ? "none" : "grid",
                placeItems: "center", color: "#fff", fontSize: 14, fontWeight: 700,
                background: favColor, boxShadow: "0 1px 2px rgba(22,21,19,.18)",
              }}
            >
              {favLetter}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.02em", lineHeight: 1.3 }}>
                {data.title || domain}
              </h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>{domain}</span>
                <span style={{ width: 3, height: 3, borderRadius: 99, background: "var(--muted-2)", flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: queueMeta.color, background: `color-mix(in oklab, ${queueMeta.color} 12%, transparent)`, padding: "2px 8px", borderRadius: 99 }}>
                  {queueMeta.label}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button
                onClick={handleCopy}
                title={copied ? "Copied!" : "Copy URL"}
                style={{ width: 32, height: 32, display: "grid", placeItems: "center", border: "1px solid var(--line)", borderRadius: 8, background: copied ? "var(--good-tint)" : "var(--surface-2)", color: copied ? "var(--good)" : "var(--muted)", cursor: "pointer", transition: "all .15s", borderColor: copied ? "color-mix(in oklab, var(--good) 35%, transparent)" : "var(--line)" }}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
              <a
                href={data.canonical_url}
                target="_blank"
                rel="noopener noreferrer"
                title="Open original"
                style={{ width: 32, height: 32, display: "grid", placeItems: "center", border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface-2)", color: "var(--muted)", textDecoration: "none", transition: "background .15s, color .15s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--accent-tint)"; e.currentTarget.style.color = "var(--accent)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.color = "var(--muted)"; }}
              >
                <OpenIcon />
              </a>
              <button
                onClick={onClose}
                title="Close (Esc)"
                style={{ width: 32, height: 32, display: "grid", placeItems: "center", border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface-2)", color: "var(--muted)", cursor: "pointer", fontSize: 16, transition: "background .15s, color .15s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--surface)"; e.currentTarget.style.color = "var(--ink)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.color = "var(--muted)"; }}
              >×</button>
            </div>
          </div>
        </header>

        {/* ── Scrollable body ── */}
        <div className="arciv-ld-body">

          {/* AI Summary */}
          {data.ai_summary && (
            <div className="arciv-ld-section">
              <div className="arciv-ld-label">AI Summary</div>
              <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.65 }}>
                {data.ai_summary}
              </p>
            </div>
          )}

          {/* Description (fallback if no AI summary) */}
          {!data.ai_summary && data.description && (
            <div className="arciv-ld-section">
              <div className="arciv-ld-label">Description</div>
              <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.65 }}>
                {data.description}
              </p>
            </div>
          )}

          {/* Notes */}
          <div className="arciv-ld-section">
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
              <div className="arciv-ld-label" style={{ marginBottom: 0 }}>Notes</div>
              {notesStatus === "saving" && <span style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>Saving…</span>}
              {notesStatus === "saved"  && <span style={{ fontSize: 10.5, color: "var(--good)", fontFamily: "ui-monospace, monospace" }}>Saved ✓</span>}
              {notesStatus === "error"  && <span style={{ fontSize: 10.5, color: "var(--bad)",  fontFamily: "ui-monospace, monospace" }}>Error saving</span>}
            </div>
            <textarea
              className="arciv-ld-notes"
              value={notes}
              onChange={e => handleNotesChange(e.target.value)}
              placeholder="Add personal notes, reminders, or context…"
              rows={4}
            />
          </div>

          {/* Tags */}
          <div className="arciv-ld-section">
            <div className="arciv-ld-label">Tags</div>
            <TagInput tags={tags} onChange={handleTagsChange} />
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--muted-2)" }}>
              Enter or comma to add · Backspace to remove · max 20
            </p>
          </div>

          {/* Queue + Content type */}
          <div className="arciv-ld-section">
            <div className="arciv-ld-label">Classification</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 5 }}>Queue</div>
                <select
                  className="arciv-ld-select"
                  value={queue}
                  onChange={e => handleQueueChange(e.target.value)}
                  disabled={isArchive}
                >
                  <option value="watch-later">Watch Later</option>
                  <option value="read-later">Read Later</option>
                  <option value="try-later">Try Later</option>
                  <option value="inbox">Inbox</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 5 }}>Content type</div>
                <select
                  className="arciv-ld-select"
                  value={contentType}
                  onChange={e => handleContentTypeChange(e.target.value)}
                >
                  <option value="">Unknown</option>
                  {CONTENT_TYPES.map(ct => (
                    <option key={ct.value} value={ct.value}>{ct.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Metadata */}
          <div className="arciv-ld-section">
            <div className="arciv-ld-label">Details</div>
            <div>
              <div className="arciv-ld-meta-row">
                <span>Saved</span>
                <strong>{formatDate(data.saved_at)}</strong>
              </div>
              {data.done_at && (
                <div className="arciv-ld-meta-row">
                  <span>Archived</span>
                  <strong>{formatDate(data.done_at)}</strong>
                </div>
              )}
              <div className="arciv-ld-meta-row">
                <span>AI status</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong style={{ color: aiStatus.color }}>{aiStatus.text}</strong>
                  {(data.ai_status === "failed" || data.ai_status === "ai-failed") && (
                    <button
                      onClick={handleRetryAI}
                      style={{ fontSize: 10.5, padding: "2px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "var(--accent)", fontWeight: 600, cursor: "pointer" }}
                    >
                      ↺ Retry
                    </button>
                  )}
                </div>
              </div>
              <div className="arciv-ld-meta-row">
                <span>Fetch</span>
                <strong style={{ color: data.fetch_status === "ok" ? "var(--good)" : "var(--bad)" }}>
                  {data.fetch_status}
                </strong>
              </div>
            </div>
          </div>

        </div>

        {/* ── Footer ── */}
        <div style={{ padding: "14px 22px", borderTop: "1px solid var(--line-2)", display: "flex", gap: 8, flexShrink: 0, background: "color-mix(in oklab, var(--nav) 60%, transparent)" }}>
          {!deleteConfirm ? (
            <>
              <button
                onClick={handleToggleStatus}
                className={`arciv-ld-action ${isArchive ? "ghost" : "primary"}`}
                style={{ flex: 1 }}
              >
                {isArchive ? "↩ Restore" : "✓ Mark done"}
              </button>
              <button
                onClick={() => setDeleteConfirm(true)}
                className="arciv-ld-action ghost"
                title="Delete link"
                style={{ width: 44, height: 38 }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                </svg>
              </button>
            </>
          ) : (
            <>
              <span style={{ flex: 1, fontSize: 12.5, color: "var(--muted)", alignSelf: "center" }}>Delete permanently?</span>
              <button onClick={() => setDeleteConfirm(false)} className="arciv-ld-action ghost">Cancel</button>
              <button onClick={handleDelete} className="arciv-ld-action danger">Delete</button>
            </>
          )}
        </div>

      </div>
    </div>,
    document.body
  );
}
