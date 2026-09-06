import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, errMessage } from "../api/client.js";
import { useScrollLock } from "../hooks/useScrollLock.js";

const KIND_META = {
  new_feed_items: { bg: "var(--try-tint)",   fg: "var(--try)",   label: "Feed update" },
  feed_dead:      { bg: "var(--read-tint)",  fg: "var(--read)",  label: "Feed error" },
  ai_config:      { bg: "var(--warn-tint)",  fg: "var(--warn)",  label: "AI setup" },
  default:        { bg: "var(--surface-2)",  fg: "var(--muted)", label: "Notification" },
};

const DOMAIN_COLORS = ["#6d3aff", "#ff6b3d", "#14a974", "#2a6fdb", "#b18800", "#cc1a6f"];

function domainColor(domain) {
  let h = 0;
  for (const c of domain) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return DOMAIN_COLORS[h % DOMAIN_COLORS.length];
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// The feed poll writes one grouped notification per feed:
//   source: <site url>
//
//   • <post title>
//     <post url>
// …so the rows below are parsed back out of that body. Kept tolerant: a body it
// cannot parse falls through to prose rather than rendering an empty list.
function parsePosts(body) {
  if (!body) return [];
  const posts = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^[•·]\s/.test(lines[i])) continue;
    const title = lines[i].slice(2).trim();
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const url = lines[j].trim();
      if (url.startsWith("http")) {
        posts.push({ title, url, host: hostOf(url) });
        i = j;
        break;
      }
    }
  }
  return posts;
}

const parseMoreCount = (body) => Number(body?.match(/\.\.\. and (\d+) more/)?.[1] ?? 0);
const parseSourceUrl = (body) => body?.match(/^source:\s*(\S+)/)?.[1] ?? null;

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso);
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const ExternalIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor"
    strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden="true">
    <path d="M5.6 2.3H2.6a.8.8 0 00-.8.8v8.3a.8.8 0 00.8.8h8.3a.8.8 0 00.8-.8v-3M8.2 1.8H12.2V5.8M12.2 1.8L6.6 7.4" />
  </svg>
);

const BookmarkIcon = ({ filled }) => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill={filled ? "currentColor" : "none"}
    stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden="true">
    <path d="M3.4 1.9h7.2a.6.6 0 01.6.6v9.2L7 9.5l-4.2 2.2V2.5a.6.6 0 01.6-.6z" />
  </svg>
);

const MuteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 6.6a4 4 0 018 0c0 3.1 1.2 4 1.2 4H2.8S4 9.7 4 6.6" />
    <path d="M6.6 13a1.6 1.6 0 002.8 0" />
    <path d="M2.4 2.4l11.2 11.2" />
  </svg>
);

const FeedIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <path d="M2 12.5a1.4 1.4 0 102.8 0 1.4 1.4 0 00-2.8 0M2 7.6a6.4 6.4 0 016.4 6.4M2 3.1A11 11 0 0113 14" />
  </svg>
);

const iconBtn = {
  display: "flex", alignItems: "center", justifyContent: "center",
  width: 30, height: 30, borderRadius: 9, cursor: "pointer",
  border: "1px solid var(--line)", background: "var(--surface-2)",
  color: "var(--muted)", transition: "background .12s, color .12s",
};

/**
 * Notification detail — the grouped feed update, opened out into something you
 * can act on.
 *
 * The feed tracker deliberately saves nothing on its own (see CLAUDE.md): it
 * tells you what appeared and leaves the choice to you. That makes this panel
 * the place where the choice happens, so each parsed post carries Save and Open
 * rather than being a bare link. Save is the ordinary `POST /api/links`, so a
 * post saved here runs the same AI pipeline as one pasted into the bar.
 *
 * A duplicate comes back 409 and is treated as *already saved*, because that is
 * what it means — the link is in the library, which is what the button claims.
 *
 * Pause is offered only when the body's `source:` line matches one of the
 * caller's feeds. The poll writes that line as `feed.site_url or feed.feed_url`,
 * so the match is exact rather than a guess at the domain.
 */
export default function NotifDrawer({ notif, onClose }) {
  const [data, setData] = useState(notif);
  // url -> "saving" | "saved" | "error"
  const [saveState, setSaveState] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [feed, setFeed] = useState(null);
  const [pausing, setPausing] = useState(false);
  const open = !!notif;

  useEffect(() => {
    if (notif) {
      setData(notif);
      setSaveState({});
      setSaveError(null);
      setFeed(null);
      return;
    }
    const t = setTimeout(() => setData(null), 360);
    return () => clearTimeout(t);
  }, [notif]);

  // Same as the link drawer: the page behind must not scroll.
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  const sourceUrl = parseSourceUrl(data?.body);

  // Match the notification to its feed row, which is what makes Pause possible.
  useEffect(() => {
    if (!open || !sourceUrl) return;
    let cancelled = false;
    api.getFeeds()
      .then(feeds => {
        if (cancelled) return;
        setFeed(feeds.find(f => f.site_url === sourceUrl || f.feed_url === sourceUrl) ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, sourceUrl]);

  const savePost = useCallback(async (url) => {
    setSaveState(s => ({ ...s, [url]: "saving" }));
    try {
      await api.createLink(url);
      setSaveState(s => ({ ...s, [url]: "saved" }));
      // The dashboard holds its own copy of the library; tell it to refetch
      // rather than leaving a link saved here missing from the list behind.
      window.dispatchEvent(new CustomEvent("arciv:links-changed"));
      return true;
    } catch (err) {
      // Already in the library is the outcome the button promises, not a failure.
      if (err?.status === 409) {
        setSaveState(s => ({ ...s, [url]: "saved" }));
        return true;
      }
      setSaveState(s => ({ ...s, [url]: "error" }));
      setSaveError(errMessage(err, "Could not save that link."));
      return false;
    }
  }, []);

  const togglePause = useCallback(async () => {
    if (!feed) return;
    setPausing(true);
    try {
      const updated = await api.updateFeed(feed.id, {
        status: feed.status === "paused" ? "active" : "paused",
      });
      setFeed(updated);
    } catch (err) {
      setSaveError(errMessage(err, "Could not change that feed."));
    } finally {
      setPausing(false);
    }
  }, [feed]);

  if (!data) return null;

  const meta = KIND_META[data.type] || KIND_META.default;
  const posts = parsePosts(data.body);
  const moreCount = parseMoreCount(data.body);
  const unsaved = posts.filter(p => saveState[p.url] !== "saved");
  const paused = feed?.status === "paused";
  const sourceHost = sourceUrl ? hostOf(sourceUrl) : null;
  const tileLetter = (sourceHost ?? data.title)[0]?.toUpperCase() ?? "?";
  const tileColor = domainColor(sourceHost ?? data.type);

  const saveAll = async () => {
    setSaveError(null);
    for (const p of unsaved) {
      const ok = await savePost(p.url);
      // A 429 means the per-minute cap is spent; carrying on would just collect
      // more of the same error.
      if (!ok) break;
    }
  };

  return createPortal(
    <div className={`ldr-root${open ? " open" : ""}`}>
      <div className="ldr-scrim" onClick={onClose} />
      <aside className="ldr" role="dialog" aria-modal="true" aria-label="Notification detail">

        {/* Header: what kind, when, and the two things you can do to the source */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          padding: "13px 16px", borderBottom: "1px solid var(--line)", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0,
              height: 26, padding: "0 10px", borderRadius: 8,
              background: meta.bg, color: meta.fg, fontSize: 12, fontWeight: 600,
            }}>
              <FeedIcon /> {meta.label}
            </span>
            <span style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {relativeTime(data.created_at)} ·{" "}
              {new Date(data.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {feed && (
              <button
                onClick={togglePause}
                disabled={pausing}
                title={paused ? "Resume this feed" : "Pause this feed"}
                style={{
                  ...iconBtn,
                  color: paused ? "var(--inbox)" : "var(--muted)",
                  opacity: pausing ? 0.5 : 1,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--surface)"; e.currentTarget.style.color = "var(--ink)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.color = paused ? "var(--inbox)" : "var(--muted)"; }}
              >
                <MuteIcon />
              </button>
            )}
            <button
              onClick={onClose}
              title="Close (Esc)"
              style={iconBtn}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--surface)"; e.currentTarget.style.color = "var(--ink)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.color = "var(--muted)"; }}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <path d="M3 3l8 8M11 3l-8 8" />
              </svg>
            </button>
          </div>
        </div>

        <div className="ldr-scroll">

          {/* What happened, and where */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 13 }}>
            <div style={{
              width: 42, height: 42, flexShrink: 0, borderRadius: 12,
              background: tileColor, color: "#fff",
              fontSize: 17, fontWeight: 700,
              display: "grid", placeItems: "center",
            }}>
              {tileLetter}
            </div>
            <div style={{ minWidth: 0, display: "grid", gap: 6 }}>
              <h2 className="ldr-title">{data.title}</h2>
              {sourceUrl && (
                <a
                  href={sourceUrl} target="_blank" rel="noopener noreferrer"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    fontFamily: "var(--font-mono)", fontSize: 12.5,
                    color: "var(--accent)", textDecoration: "none", width: "fit-content",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.textDecoration = "underline"; }}
                  onMouseLeave={e => { e.currentTarget.style.textDecoration = "none"; }}
                >
                  <ExternalIcon />
                  {sourceHost}
                </a>
              )}
            </div>
          </div>

          {posts.length > 0 ? (
            <section style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
                  {posts.length + moreCount} new post{posts.length + moreCount !== 1 ? "s" : ""}
                  {moreCount > 0 && ` · showing ${posts.length}`}
                </span>
                <button
                  onClick={saveAll}
                  disabled={unsaved.length === 0}
                  style={{
                    height: 27, padding: "0 10px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                    cursor: unsaved.length === 0 ? "default" : "pointer",
                    border: `1px solid ${unsaved.length === 0 ? "transparent" : "var(--line)"}`,
                    background: unsaved.length === 0 ? "var(--accent-tint)" : "transparent",
                    color: unsaved.length === 0 ? "var(--accent)" : "var(--muted)",
                    transition: "background .12s, color .12s",
                  }}
                  onMouseEnter={e => { if (unsaved.length) { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.color = "var(--ink)"; } }}
                  onMouseLeave={e => { if (unsaved.length) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--muted)"; } }}
                >
                  {unsaved.length === 0 ? "All saved" : `Save all ${unsaved.length}`}
                </button>
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                {posts.map(post => {
                  const state = saveState[post.url];
                  const saved = state === "saved";
                  return (
                    <div
                      key={post.url}
                      style={{
                        padding: "12px 12px 10px", borderRadius: 13,
                        border: "1px solid var(--line)", background: "var(--surface-2)",
                        transition: "background .12s, border-color .12s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
                        <span style={{
                          width: 7, height: 7, marginTop: 6, flexShrink: 0, borderRadius: "50%",
                          background: saved ? "var(--accent)" : "var(--try)",
                          boxShadow: `0 0 0 3px color-mix(in oklab, ${saved ? "var(--accent)" : "var(--try)"} 16%, transparent)`,
                          transition: "background .12s, box-shadow .12s",
                        }} />
                        <div style={{ minWidth: 0, flex: 1, display: "grid", gap: 4 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.42, color: "var(--ink)", textWrap: "pretty" }}>
                            {post.title}
                          </div>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {post.host}
                          </div>
                        </div>
                      </div>

                      <div style={{ marginTop: 9, paddingLeft: 18, display: "flex", alignItems: "center", gap: 7 }}>
                        <button
                          onClick={() => { if (!saved && state !== "saving") savePost(post.url); }}
                          disabled={saved || state === "saving"}
                          title={saved ? "Already in your library" : "Save to your library"}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 6,
                            height: 28, padding: "0 10px", borderRadius: 8,
                            fontSize: 12, fontWeight: 500,
                            cursor: saved || state === "saving" ? "default" : "pointer",
                            border: `1px solid ${saved ? "transparent" : "var(--line)"}`,
                            background: saved ? "var(--accent)" : "var(--surface)",
                            color: saved ? "var(--accent-ink)" : "var(--ink-2)",
                            opacity: state === "saving" ? 0.6 : 1,
                            transition: "background .12s, color .12s, border-color .12s",
                          }}
                        >
                          <BookmarkIcon filled={saved} />
                          {saved ? "Saved" : state === "saving" ? "Saving…" : "Save"}
                        </button>
                        <a
                          href={post.url} target="_blank" rel="noopener noreferrer"
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 6,
                            height: 28, padding: "0 10px", borderRadius: 8,
                            fontSize: 12, fontWeight: 500, textDecoration: "none",
                            border: "1px solid transparent", background: "transparent",
                            color: "var(--muted)", transition: "background .12s, color .12s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "var(--surface)"; e.currentTarget.style.color = "var(--ink)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--muted)"; }}
                        >
                          <ExternalIcon /> Open
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>

              {moreCount > 0 && (
                <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
                  {moreCount} more post{moreCount !== 1 ? "s" : ""} arrived than this update lists.
                  Open the source to see the rest.
                </p>
              )}
            </section>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {data.body || "No additional details."}
            </p>
          )}

          {saveError && (
            <p style={{
              margin: 0, padding: "10px 12px", borderRadius: 10,
              background: "var(--bad-tint)", border: "1px solid color-mix(in oklab, var(--bad) 25%, transparent)",
              fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5,
            }}>
              {saveError}
            </p>
          )}

          {paused && (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
              This feed is paused — it won't be polled until you resume it.
            </p>
          )}

          <div style={{ height: 4 }} />
        </div>
      </aside>
    </div>,
    document.body
  );
}
