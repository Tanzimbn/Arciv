import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, errMessage } from "../api/client.js";

// ── Constants ─────────────────────────────────────────────────
const QUEUE_OPTIONS = [
  { id: "watch-later", label: "Watch Later", color: "var(--watch)", tint: "var(--watch-tint)" },
  { id: "read-later",  label: "Read Later",  color: "var(--read)",  tint: "var(--read-tint)"  },
  { id: "try-later",   label: "Try Later",   color: "var(--try)",   tint: "var(--try-tint)"   },
  { id: "inbox",       label: "Inbox",       color: "var(--inbox)", tint: "var(--inbox-tint)" },
];

const CONTENT_TYPES = [
  "Article", "Essay", "Video", "Talk", "Tool",
  "Podcast", "Research Paper", "Newsletter", "Thread", "Other",
];

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

// ── CustomSelect ──────────────────────────────────────────────
function CustomSelect({ value, options, onChange, renderTrigger }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div className="ldr-select" ref={ref}>
      <button type="button" className="ldr-select-trigger" onClick={() => setOpen(o => !o)}>
        {renderTrigger(value)}
        <svg className="ldr-select-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(-90deg)" : "rotate(90deg)", transition: "transform .15s" }}>
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
      {open && (
        <div className="ldr-select-menu">
          {options.map(o => {
            const id = o.id ?? o;
            const isActive = (value?.id ?? value) === id;
            return (
              <button
                key={id}
                type="button"
                className={`ldr-select-opt${isActive ? " on" : ""}`}
                onClick={() => { onChange(o); setOpen(false); }}
              >
                {o.color && <span className="ldr-select-swatch" style={{ background: o.color }} />}
                {o.label ?? o}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const VIDEO_HOSTS = /youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv/i;

function insightsErrorMessage(err, link) {
  if (err?.status === 429) {
    // Rate limited — surface the backend's "max N per minute" detail. Must come
    // before the content-type guesses below, which would otherwise mislabel a
    // throttle as a paywall/JS problem.
    return errMessage(err, "Too many insight requests — try again in a minute.");
  }
  if (err?.status === 422) {
    return "No AI provider configured, add an API key in Settings.";
  }
  if (link?.content_type === "video" || VIDEO_HOSTS.test(link?.canonical_url ?? "")) {
    return "Insights work best with articles. Video transcripts aren't supported yet.";
  }
  if (link?.fetch_status === "unreachable") {
    return "This page couldn't be fetched — it may be paywalled or bot-blocked. Insights need readable text.";
  }
  return "Couldn't generate insights. The page may be paywalled or JavaScript-only. Try again.";
}

// ── Main drawer ───────────────────────────────────────────────
export default function LinkDetailDrawer({ link, onClose, onUpdate, onDelete, onRetryAI, onOpenLink, aiAvailable = true }) {
  const [data, setData] = useState(link);
  const open = !!link;

  // Semantically related links (embedding cosine distance). Best-effort: any
  // failure or empty result just hides the panel.
  const [related, setRelated] = useState([]);
  const [relatedLoading, setRelatedLoading] = useState(false);

  // Local editable state
  const [notes, setNotes] = useState(data?.notes ?? "");
  const [tags, setTags] = useState(data?.ai_tags ?? []);
  const [queue, setQueue] = useState(() => QUEUE_OPTIONS.find(q => q.id === data?.queue) ?? QUEUE_OPTIONS[0]);
  const [contentType, setContentType] = useState(data?.content_type ?? "");
  const [notesStatus, setNotesStatus] = useState("idle");
  const [insightsStatus, setInsightsStatus] = useState("idle");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notesOpen, setNotesOpen] = useState(!!link?.notes?.trim());

  const notesTimerRef = useRef(null);
  const savedTimerRef = useRef(null);

  // Sync state when link changes
  useEffect(() => {
    if (link) {
      setData(link);
      setNotes(link.notes ?? "");
      setTags(link.ai_tags ?? []);
      setQueue(QUEUE_OPTIONS.find(q => q.id === link.queue) ?? QUEUE_OPTIONS[0]);
      setContentType(link.content_type ?? "");
      setNotesStatus("idle");
      setInsightsStatus("idle");
      setDeleteConfirm(false);
      setNotesOpen(!!link.notes?.trim());
    } else {
      const t = setTimeout(() => setData(null), 360);
      return () => clearTimeout(t);
    }
  }, [link]);

  useEffect(() => () => {
    clearTimeout(notesTimerRef.current);
    clearTimeout(savedTimerRef.current);
  }, []);

  // Fetch related links whenever the open link changes.
  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    setRelated([]);
    setRelatedLoading(true);
    api.getSimilar(link.id)
      .then(items => { if (!cancelled) setRelated(items || []); })
      .catch(() => { if (!cancelled) setRelated([]); })
      .finally(() => { if (!cancelled) setRelatedLoading(false); });
    return () => { cancelled = true; };
  }, [link]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  // ── Patch helpers ─────────────────────────────────────────
  const patch = useCallback(async (payload) => {
    if (!data) return null;
    try {
      const updated = await api.updateLink(data.id, payload);
      onUpdate(updated);
      return updated;
    } catch { return null; }
  }, [data, onUpdate]);

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

  const handleTagsChange = async (newTags) => {
    setTags(newTags);
    await patch({ ai_tags: newTags });
  };

  const handleQueueChange = async (opt) => {
    setQueue(opt);
    await patch({ queue: opt.id });
  };

  const handleContentTypeChange = async (val) => {
    const normalized = val.toLowerCase().replace(" ", "-");
    setContentType(val);
    await patch({ content_type: normalized });
  };

  const handleToggleStatus = async () => {
    const newStatus = data.status === "done" ? "active" : "done";
    await patch({ status: newStatus });
    onClose();
  };

  const handleDelete = async () => {
    if (!data) return;
    try { await api.deleteLink(data.id); onDelete(data.id); onClose(); } catch {}
  };

  const handleGenerateInsights = async () => {
    if (!data || insightsStatus === "loading") return;
    setInsightsStatus("loading");
    try {
      const updated = await api.generateInsights(data.id);
      onUpdate(updated);
      setInsightsStatus("idle");
    } catch (err) {
      setInsightsStatus(insightsErrorMessage(err, data));
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(data?.canonical_url ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Tag input
  const addTag = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const v = e.target.value.trim().replace(/,$/, "");
      if (v && !tags.some(t => t.toLowerCase() === v.toLowerCase()) && tags.length < 20 && v.length <= 50) {
        handleTagsChange([...tags, v]);
      }
      e.target.value = "";
    } else if (e.key === "Backspace" && !e.target.value && tags.length) {
      handleTagsChange(tags.slice(0, -1));
    }
  };

  if (!data) return null;

  let domain = data.canonical_url;
  try { domain = new URL(data.canonical_url).hostname.replace(/^www\./, ""); } catch {}

  const favColor = domainColor(domain);
  const favLetter = domain[0]?.toUpperCase() ?? "?";
  const isArchive = data.status === "done";
  // "pending" only means "classifying" when the pipeline can actually run: the
  // page was fetchable AND an AI provider is available. An unreachable fetch
  // never enqueues classify, and a keyless user has no provider — in both cases
  // the link is parked in Inbox, not moments from being classified.
  const pendingLabel =
    data.fetch_status === "unreachable"
      ? { text: "Not classified — couldn't fetch page", cls: "bad" }
      : !aiAvailable
        ? { text: "Waiting — add an AI key", cls: "warn" }
        : { text: "Classifying…", cls: "warn" };

  const aiStatusLabel = {
    pending: pendingLabel,
    done:    { text: "Classified",   cls: "good" },
    skipped: { text: "Skipped",      cls: "" },
    failed:  { text: "Failed",       cls: "bad" },
  }[data.ai_status] ?? { text: data.ai_status, cls: "" };

  return createPortal(
    <div className={`ldr-root${open ? " open" : ""}`}>
      <div className="ldr-scrim" onClick={onClose} />
      <aside className="ldr" role="dialog" aria-modal="true" aria-label="Link details">

        {/* Identity bar — where the link is from, and the two things you do to a
            link rather than to its record. Sticky, so both stay reachable while
            the body scrolls; the gradient hero this replaces was decoration
            that pushed the summary a screen down. */}
        <div className="ldr-topbar">
          {data.favicon_url
            ? <img src={data.favicon_url} alt="" width={20} height={20} style={{ borderRadius: 6, flexShrink: 0, objectFit: "contain" }}
                onError={e => { e.currentTarget.style.display = "none"; e.currentTarget.nextSibling.style.display = "grid"; }} />
            : null}
          <span className="ldr-fav" style={{ background: favColor, display: data.favicon_url ? "none" : "grid", flexShrink: 0 }}>{favLetter}</span>
          <span className="ldr-topbar-domain">{domain}</span>
          <div style={{ flex: 1 }} />
          <a
            href={data.canonical_url} target="_blank" rel="noopener noreferrer"
            className="ldr-iconbtn" title="Open original in a new tab"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
          <button
            className={`ldr-iconbtn${copied ? " ok" : ""}`}
            onClick={handleCopy}
            title={copied ? "URL copied" : "Copy URL"}
          >
            {copied
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}
          </button>
          <button className="ldr-x" onClick={onClose} title="Close (Esc)">×</button>
        </div>

        <div className="ldr-scroll">

          {/* Title, then one meta line. The queue and type are not repeated
              here — they are controls in Filing below, and stating them twice
              is how the old panel ended up with the same fact in two places. */}
          <div className="ldr-title-block">
            <h2 className="ldr-title">{data.title || domain}</h2>
            <div className="ldr-metaline">
              <span>Saved {formatDate(data.saved_at)}</span>
              {data.done_at && (
                <>
                  <span className="dot" />
                  <span>Archived {formatDate(data.done_at)}</span>
                </>
              )}
            </div>
          </div>

          {/* The answer to "what is this" comes first, with no label above it —
              a paragraph in that position needs no announcing. */}
          {(data.ai_summary || data.description) && (
            <div className="ldr-summary">
              {data.ai_summary || data.description}
            </div>
          )}

          {/* Insights */}
          <section className="ldr-section">
            <div className="ldr-section-h">
              <div className="ldr-section-label">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                Key insights
              </div>
              <button
                className="ldr-ghost-btn"
                onClick={handleGenerateInsights}
                disabled={insightsStatus === "loading"}
              >
                {insightsStatus === "loading" ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: "spin .8s linear infinite" }}>
                      <circle cx="12" cy="12" r="9" strokeOpacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"/>
                    </svg>
                    Generating…
                  </>
                ) : data.ai_insights?.length ? "Regenerate" : "Generate"}
              </button>
            </div>

            {typeof insightsStatus === "string" && insightsStatus !== "idle" && insightsStatus !== "loading" && (
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--bad)", lineHeight: 1.5 }}>{insightsStatus}</p>
            )}

            {insightsStatus !== "loading" && data.ai_insights?.length > 0 && (
              <ol className="ldr-insights">
                {data.ai_insights.map((ins, i) => (
                  <li key={i}>
                    <span className="ldr-insight-n">{String(i + 1).padStart(2, "0")}</span>
                    <span className="ldr-insight-t">{ins}</span>
                  </li>
                ))}
              </ol>
            )}

            {insightsStatus === "idle" && !data.ai_insights?.length && (
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                Pull the main points out of this page with <strong style={{ color: "var(--ink-2)" }}>Generate</strong>.
              </p>
            )}
          </section>

          {/* Filing — queue, type and tags were three controls split across two
              sections a screen apart. They answer one question: where this
              lives and what it is about. */}
          <section className="ldr-section">
            <div className="ldr-section-h">
              <div className="ldr-section-label">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                Filing
              </div>
              <span className="ldr-count">{tags.length}/20 tags</span>
            </div>
            <div className="ldr-class">
              <label>
                <span>Queue</span>
                <CustomSelect
                  value={queue}
                  options={QUEUE_OPTIONS}
                  onChange={handleQueueChange}
                  renderTrigger={v => (
                    <>
                      <span className="ldr-select-swatch" style={{ background: v.color }} />
                      {v.label}
                    </>
                  )}
                />
              </label>
              <label>
                <span>Type</span>
                <CustomSelect
                  value={contentType ? contentType.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "Other"}
                  options={CONTENT_TYPES}
                  onChange={handleContentTypeChange}
                  renderTrigger={v => <>{v}</>}
                />
              </label>
            </div>
            <div className="ldr-tags">
              {tags.map((t, i) => (
                <span key={i} className="ldr-tag">
                  {t}
                  <button onClick={() => handleTagsChange(tags.filter((_, j) => j !== i))} title={`Remove ${t}`}>×</button>
                </span>
              ))}
              <input
                className="ldr-tag-input"
                placeholder={tags.length ? "Add…" : "Type a tag and press Enter"}
                onKeyDown={addTag}
              />
            </div>
          </section>

          {/* Notes — folded away until there is something in them, so an empty
              textarea doesn't take a fifth of the panel on every open. */}
          <details className="ldr-fold" open={notesOpen} onToggle={e => setNotesOpen(e.currentTarget.open)}>
            <summary>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              {notes.trim() ? "Your notes" : "Add a note"}
              {notes.trim() && notesStatus !== "idle" && (
                <span className="ldr-count" style={{ marginLeft: 4 }}>
                  {notesStatus === "saving" ? "saving…" : notesStatus === "saved" ? "saved ✓" : "error"}
                </span>
              )}
              <svg className="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </summary>
            <div className="ldr-fold-body">
              <textarea
                className="ldr-notes"
                placeholder="What did you find here? Highlights, takeaways, follow-ups…"
                value={notes}
                onChange={e => handleNotesChange(e.target.value)}
                rows={3}
              />
            </div>
          </details>

          {/* Related — a way out of this link, so it belongs after everything
              about this link rather than interrupting it. */}
          {(relatedLoading || related.length > 0) && (
            <section className="ldr-section">
              <div className="ldr-section-h">
                <div className="ldr-section-label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                  Related
                </div>
              </div>
              {relatedLoading ? (
                <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>Finding related links…</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {related.map(r => {
                    let rd = r.canonical_url;
                    try { rd = new URL(r.canonical_url).hostname.replace(/^www\./, ""); } catch {}
                    return (
                      <button key={r.id} onClick={() => onOpenLink?.(r)} className="ldr-related-row">
                        {r.favicon_url
                          ? <img src={r.favicon_url} alt="" width={22} height={22} style={{ flex: "0 0 auto", borderRadius: 6, objectFit: "contain" }} onError={e => { e.currentTarget.style.display = "none"; e.currentTarget.nextSibling.style.display = "grid"; }} />
                          : null}
                        <span style={{ flex: "0 0 auto", width: 22, height: 22, borderRadius: 6, display: r.favicon_url ? "none" : "grid", placeItems: "center", background: domainColor(rd), color: "#fff", fontSize: 11, fontWeight: 700 }}>{rd[0]?.toUpperCase() ?? "?"}</span>
                        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 550, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title || rd}</span>
                          <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{rd}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Details — pipeline state, folded. Saved and Archived are no longer
              repeated here; the meta line above owns them. */}
          <details className="ldr-fold">
            <summary>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Details
              <svg className="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </summary>
            <div className="ldr-fold-body" style={{ display: "grid", gap: 10 }}>
              <dl className="ldr-meta" style={{ margin: 0 }}>
                <div><dt>AI status</dt>
                  <dd className={aiStatusLabel.cls}>
                    {aiStatusLabel.text}
                    {data.ai_status === "failed" && (
                      <button className="ldr-retry" onClick={() => onRetryAI(data.id)}>↺ Retry</button>
                    )}
                  </dd>
                </div>
                <div><dt>Fetch</dt><dd className={data.fetch_status === "ok" ? "good" : "bad"}>{data.fetch_status}</dd></div>
              </dl>
              <button className="ldr-url" onClick={handleCopy} title="Copy URL">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <span>{data.canonical_url}</span>
              </button>
            </div>
          </details>

          <div style={{ height: 4 }} />
        </div>

        {/* ── Footer ── */}
        <footer className="ldr-foot">
          {!deleteConfirm ? (
            <>
              <button className="ldr-primary" onClick={handleToggleStatus}>
                {!isArchive && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>}
                {isArchive ? "↩ Restore" : "Mark done"}
              </button>
              <button className="ldr-secondary danger" title="Delete link" onClick={() => setDeleteConfirm(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                </svg>
              </button>
            </>
          ) : (
            <>
              <span style={{ flex: 1, fontSize: 13, color: "var(--muted)", letterSpacing: "-0.005em" }}>Delete permanently?</span>
              {/* Widths come from a class, not inline styles: an inline
                  background beats `.ldr-secondary:hover`, which is why the old
                  confirm button had no hover at all. */}
              <button onClick={() => setDeleteConfirm(false)} className="ldr-secondary wide">Cancel</button>
              <button onClick={handleDelete} className="ldr-secondary wide danger confirm">Delete</button>
            </>
          )}
        </footer>

      </aside>
    </div>,
    document.body
  );
}
