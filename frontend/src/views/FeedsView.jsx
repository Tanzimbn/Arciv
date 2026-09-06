import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import SubpageNav from "../components/SubpageNav.jsx";
import { useBreakpoint } from "../hooks/useBreakpoint.js";

/* ── Icons ────────────────────────────────────────────────── */
const I = {
  rss:     () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.5" fill="currentColor"/></svg>,
  bell:    () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>,
  refresh: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/></svg>,
  pause:   () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>,
  play:    () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>,
  more:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/></svg>,
  external:() => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg>,
  sparkle: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 14 9l7 2-7 2-2 7-2-7-7-2 7-2 2-7Z"/></svg>,
  trash:   () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>,
};

/* ── Status config ────────────────────────────────────────── */
const STATUS = {
  active:   { label: "Active",   bg: "var(--good-tint)",   color: "var(--good)",   pulse: true },
  paused:   { label: "Paused",   bg: "var(--warn-tint)",   color: "var(--warn)",   pulse: false },
  degraded: { label: "Degraded", bg: "var(--warn-tint)",   color: "var(--warn)",   pulse: true },
  dead:     { label: "Dead",     bg: "var(--bad-tint)",    color: "var(--bad)",    pulse: false },
  error:    { label: "Error",    bg: "var(--bad-tint)",    color: "var(--bad)",    pulse: false },
};

/* ── Deterministic letter-avatar color ───────────────────── */
const AVATAR_COLORS = ["#6d3aff","#ff6b3d","#14a974","#2a6fdb","#b18800","#cc1a6f","#0f8ab8","#ac130d"];
function avatarColor(str) { return AVATAR_COLORS[(str?.length ?? 0) % AVATAR_COLORS.length]; }

/* ── FILTERS ──────────────────────────────────────────────── */
const FILTERS = [
  { id: "all",     label: "All",    match: () => true },
  { id: "active",  label: "Active", match: s => s.status === "active" },
  { id: "paused",  label: "Paused", match: s => s.status === "paused" },
  { id: "error",   label: "Errors", match: s => s.status === "degraded" || s.status === "dead" },
];

/* ── Tiny icon button ────────────────────────────────────── */
function IconBtn({ onClick, title, children }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        width: 30, height: 30, display: "grid", placeItems: "center",
        border: 0, borderRadius: 7, cursor: "pointer",
        background: h ? "var(--surface-2)" : "transparent",
        color: h ? "var(--ink-2)" : "var(--muted)",
        transition: "background .1s, color .1s",
      }}>
      {children}
    </button>
  );
}

/* ── Source row ──────────────────────────────────────────── */
function SourceRow({ feed, onTogglePause, onCheckNow, onDelete, isMobile }) {
  const [hovered, setHovered] = useState(false);
  const st = STATUS[feed.status] ?? STATUS.error;

  const domain = (() => { try { return new URL(feed.feed_url).hostname.replace(/^www\./, ""); } catch { return feed.feed_url; } })();
  const letter = (feed.title?.[0] || domain[0] || "?").toUpperCase();
  const color = avatarColor(feed.title || domain);

  const lastChecked = feed.last_checked_at
    ? (() => {
        const diff = Date.now() - new Date(feed.last_checked_at);
        const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
        if (m < 1) return "just now";
        if (m < 60) return `${m}m ago`;
        if (h < 24) return `${h}h ago`;
        return `${d}d ago`;
      })()
    : "never";

  const Avatar = (
    <div style={{
      width: isMobile ? 36 : 42, height: isMobile ? 36 : 42, borderRadius: 10, flexShrink: 0,
      display: "grid", placeItems: "center",
      background: feed.favicon_url ? "var(--surface-2)" : color,
      boxShadow: "0 1px 0 rgba(255,255,255,.3) inset",
    }}>
      {feed.favicon_url
        ? <img src={feed.favicon_url} alt="" style={{ width: isMobile ? 20 : 24, height: isMobile ? 20 : 24, objectFit: "contain", borderRadius: 4 }} onError={e => { e.target.style.display = "none"; e.target.parentNode.style.background = color; e.target.parentNode.textContent = letter; }} />
        : <span style={{ color: "#fff", fontWeight: 700, fontSize: isMobile ? 13 : 15, fontFamily: "var(--font-mono)" }}>{letter}</span>}
    </div>
  );

  const StatusDot = (
    <span style={{
      width: 8, height: 8, borderRadius: 99, background: st.color, flexShrink: 0,
      boxShadow: st.pulse ? "0 0 0 3px color-mix(in oklab, currentColor 22%, transparent)" : "none",
      animation: st.pulse ? "arciv-ping-slow 2s ease-in-out infinite" : "none",
    }} />
  );

  if (isMobile) {
    return (
      <div style={{
        background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14,
        padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10,
        boxShadow: "var(--shadow-card)",
      }}>
        {/* Row 1: avatar + title/domain + status dot */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {Avatar}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {feed.title || domain}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
              {domain}
            </div>
          </div>
          {/* Status pill (dot + label) */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: 99, background: st.bg, color: st.color, fontSize: 11, fontWeight: 500, flexShrink: 0 }}>
            {StatusDot}
            {st.label}
          </div>
        </div>

        {/* Row 2: meta + actions */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
            {feed.total_items_received} posts · {lastChecked}
            {feed.consecutive_failures > 0 && (
              <span style={{ color: "var(--bad)", fontWeight: 500 }}> · {feed.consecutive_failures} failure{feed.consecutive_failures !== 1 ? "s" : ""}</span>
            )}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
            <IconBtn onClick={() => onTogglePause(feed)} title={feed.status === "paused" ? "Resume" : "Pause"}>
              {feed.status === "paused" ? <I.play /> : <I.pause />}
            </IconBtn>
            <IconBtn onClick={() => onDelete(feed.id)} title="Remove"><I.trash /></IconBtn>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16,
        padding: "14px 16px", display: "flex", alignItems: "center", gap: 14,
        boxShadow: hovered ? "var(--shadow-pop)" : "var(--shadow-card)",
        borderColor: hovered ? "rgba(31,28,21,.14)" : "var(--line)",
        transform: hovered ? "translateY(-1px)" : "none",
        transition: "transform .12s, box-shadow .15s, border-color .15s",
      }}
    >
      {Avatar}

      {/* Main info */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.01em" }}>
            {feed.title || domain}
          </span>
          {feed.category && (
            <span style={{ fontSize: 10.5, color: "var(--muted)", background: "var(--surface-2)", padding: "2px 7px", borderRadius: 99, border: "1px solid var(--line)", fontWeight: 500 }}>
              {feed.category}
            </span>
          )}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {domain}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
          <span>{feed.total_items_received} posts</span>
          <span style={{ width: 3, height: 3, borderRadius: 99, background: "var(--muted-2)", flexShrink: 0 }} />
          <span>last checked {lastChecked}</span>
          {feed.consecutive_failures > 0 && (
            <>
              <span style={{ width: 3, height: 3, borderRadius: 99, background: "var(--muted-2)", flexShrink: 0 }} />
              <span style={{ color: "var(--bad)", fontWeight: 500 }}>{feed.consecutive_failures} failure{feed.consecutive_failures !== 1 ? "s" : ""}</span>
            </>
          )}
        </div>
      </div>

      {/* Status pill */}
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 99, background: st.bg, color: st.color, fontSize: 11.5, fontWeight: 500, flexShrink: 0 }}>
        {StatusDot}
        {st.label}
      </div>

      {/* Actions — rendered only on hover */}
      {hovered && (
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <IconBtn onClick={() => onTogglePause(feed)} title={feed.status === "paused" ? "Resume" : "Pause"}>
            {feed.status === "paused" ? <I.play /> : <I.pause />}
          </IconBtn>
          <IconBtn onClick={() => onCheckNow(feed)} title="Check now"><I.refresh /></IconBtn>
          <IconBtn onClick={() => window.open(feed.site_url, "_blank", "noopener")} title="Open site"><I.external /></IconBtn>
          <IconBtn onClick={() => onDelete(feed.id)} title="Remove"><I.trash /></IconBtn>
        </div>
      )}
    </div>
  );
}

/* ── Pill button ─────────────────────────────────────────── */
function Pill({ active, onClick, children }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        border: 0, cursor: "pointer",
        font: "inherit", fontSize: 12.5, fontWeight: 500,
        color: active ? "var(--bg)" : (h ? "var(--ink-2)" : "var(--muted)"),
        padding: "6px 10px", borderRadius: 8,
        background: active ? "var(--ink)" : (h ? "var(--surface-2)" : "transparent"),
        display: "inline-flex", alignItems: "center", gap: 6,
        transition: "background .12s, color .12s",
      }}>
      {children}
    </button>
  );
}

/* ── Count badge ─────────────────────────────────────────── */
function Cnt({ active, n }) {
  return (
    <span style={{
      fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 500,
      padding: "1px 6px", borderRadius: 99,
      background: active ? "color-mix(in oklab, var(--bg) 18%, transparent)" : "rgba(31,28,21,.06)",
      color: active ? "var(--bg)" : "var(--muted)",
    }}>{n}</span>
  );
}

/* ── Delete confirm modal ────────────────────────────────── */
function DeleteModal({ onConfirm, onCancel }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(31,28,21,.4)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "0 16px" }}>
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 20, padding: 28, maxWidth: 320, width: "100%", boxShadow: "var(--shadow-pop)" }}>
        <div style={{ width: 44, height: 44, borderRadius: 99, background: "var(--bad-tint)", display: "grid", placeItems: "center", margin: "0 auto 12px" }}>
          <I.trash />
        </div>
        <p style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", textAlign: "center", margin: 0 }}>Remove this source?</p>
        <p style={{ fontSize: 12.5, color: "var(--muted)", textAlign: "center", margin: "6px 0 20px" }}>Saved links from it will not be deleted.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel}
            style={{ flex: 1, padding: "9px 0", fontSize: 13, fontWeight: 600, color: "var(--ink-2)", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 10, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={onConfirm}
            style={{ flex: 1, padding: "9px 0", fontSize: 13, fontWeight: 700, color: "var(--on-color)", background: "var(--bad)", border: 0, borderRadius: 10, cursor: "pointer" }}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main view ───────────────────────────────────────────── */
export default function FeedsView({ onNavigate, onLogout }) {
  const [feeds, setFeeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoverResult, setDiscoverResult] = useState(null);
  const [discoverError, setDiscoverError] = useState("");
  const [subscribing, setSubscribing] = useState(false);
  const [filter, setFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [categoryInput, setCategoryInput] = useState("");

  useEffect(() => {
    api.getFeeds()
      .then(setFeeds)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2400); };

  const counts = useMemo(() => {
    const c = {};
    for (const f of FILTERS) c[f.id] = feeds.filter(f.match).length;
    return c;
  }, [feeds]);

  const visible = useMemo(() => {
    const f = FILTERS.find(x => x.id === filter);
    return feeds.filter(f.match);
  }, [feeds, filter]);

  async function handleDiscover(e) {
    e?.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setDiscovering(true); setDiscoverError(""); setDiscoverResult(null);
    try {
      setDiscoverResult(await api.discoverFeed(trimmed));
    } catch (err) {
      setDiscoverError(err.data?.detail || "No feed found at this URL.");
    } finally {
      setDiscovering(false);
    }
  }

  async function handleSubscribe() {
    if (!discoverResult) return;
    setSubscribing(true);
    try {
      const feed = await api.subscribeFeed({
        site_url: url,
        feed_url: discoverResult.feed_url,
        title: discoverResult.title,
        favicon_url: discoverResult.favicon_url,
        category: categoryInput.trim() || null,
      });
      setFeeds(prev => [feed, ...prev]);
      setDiscoverResult(null); setUrl(""); setCategoryInput("");
      showToast("Feed added · you'll be notified when new posts arrive");
    } catch (err) {
      setDiscoverError(err.data?.detail || "Failed to subscribe.");
    } finally {
      setSubscribing(false);
    }
  }

  async function handleTogglePause(feed) {
    const newStatus = feed.status === "paused" ? "active" : "paused";
    try {
      const updated = await api.updateFeed(feed.id, { status: newStatus });
      setFeeds(prev => prev.map(f => f.id === feed.id ? updated : f));
    } catch {}
  }

  async function handleCheckNow(feed) {
    try {
      await api.checkFeedNow(feed.id);
      showToast("Check queued · poll will run shortly");
    } catch {}
  }

  async function handleDelete(id) {
    setDeleteTarget(null);
    try {
      await api.deleteFeed(id);
      setFeeds(prev => prev.filter(f => f.id !== id));
      showToast("Feed removed");
    } catch {}
  }

  async function handleRefreshAll() {
    const active = feeds.filter(f => f.status === "active");
    await Promise.allSettled(active.map(f => api.checkFeedNow(f.id)));
    showToast(`Queued ${active.length} feed${active.length !== 1 ? "s" : ""} for refresh`);
  }

  const { isMobile } = useBreakpoint();

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", fontFamily: "var(--font-sans)" }}>
      {/* CSS for ping animation */}
      <style>{`
        @keyframes arciv-ping-slow {
          0%,100% { box-shadow: 0 0 0 3px color-mix(in oklab, currentColor 22%, transparent); }
          50%      { box-shadow: 0 0 0 6px color-mix(in oklab, currentColor 0%, transparent); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <SubpageNav active="feeds" onNavigate={onNavigate} onLogout={onLogout} />

      {/* Page */}
      <main className="arciv-page-pad" style={{ maxWidth: 1080, margin: "0 auto", padding: isMobile ? "20px 16px 80px" : "32px 28px 80px" }}>
        {/* Page heading */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: isMobile ? 32 : 44, lineHeight: 1.02, letterSpacing: "-0.01em", margin: 0, color: "var(--ink)" }}>
            Feed Tracker
          </h1>
          <div style={{ marginTop: 4, fontSize: 13.5, color: "var(--muted)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>RSS, Atom, and newsletter sources.</span>
            <span style={{ width: 3, height: 3, borderRadius: 99, background: "var(--muted-2)" }} />
            <span>{feeds.length} source{feeds.length !== 1 ? "s" : ""}</span>
          </div>
        </div>

        {/* Add source card */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: isMobile ? "14px 16px" : "18px 20px", marginBottom: 24, boxShadow: "var(--shadow-card)", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 4 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>Add source</span>
            {!isMobile && <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted-2)" }}>auto-detects RSS · Atom · Substack</span>}
          </div>

          <form onSubmit={handleDiscover} style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10, alignItems: isMobile ? "stretch" : "stretch" }}>
            <div style={{
              flex: 1, display: "flex", alignItems: "center", gap: 10,
              height: 44, padding: "0 14px", borderRadius: 12,
              background: inputFocused ? "var(--surface)" : "var(--surface-2)",
              border: `1px solid ${inputFocused ? "var(--accent)" : "var(--line)"}`,
              boxShadow: inputFocused ? "0 0 0 4px var(--accent-tint)" : "none",
              transition: "border-color .15s, box-shadow .15s, background .15s",
            }}>
              <span style={{ color: "var(--muted-2)", flexShrink: 0, display: "flex" }}><I.rss /></span>
              <input
                type="url"
                value={url}
                onChange={e => { setUrl(e.target.value); setDiscoverResult(null); setDiscoverError(""); }}
                onKeyDown={e => e.key === "Enter" && handleDiscover()}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder="https://blog.example.com or RSS URL"
                disabled={discovering}
                style={{ flex: 1, border: 0, outline: 0, background: "transparent", font: "inherit", fontSize: 14, color: "var(--ink)", padding: 0 }}
              />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted)", padding: "3px 7px", borderRadius: 5, background: "var(--surface)", border: "1px solid var(--line)", flexShrink: 0 }}>⌘ V</span>
            </div>
            <button type="submit" disabled={!url.trim() || discovering}
              style={{
                height: 44, padding: "0 22px", border: 0, borderRadius: 12, cursor: !url.trim() || discovering ? "default" : "pointer",
                font: "inherit", fontWeight: 500, fontSize: 14,
                background: !url.trim() || discovering ? "var(--accent-tint-2)" : "var(--accent)",
                color: !url.trim() || discovering ? "#a08bd9" : "var(--accent-ink)",
                display: "inline-flex", alignItems: "center", gap: 8,
                transition: "background .15s",
              }}
              onMouseEnter={e => { if (url.trim() && !discovering) e.currentTarget.style.background = "var(--accent-deep)"; }}
              onMouseLeave={e => { if (url.trim() && !discovering) e.currentTarget.style.background = "var(--accent)"; }}
            >
              {discovering ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin .8s linear infinite" }}>
                    <circle cx="12" cy="12" r="9" strokeOpacity=".3" /><path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
                  </svg>
                  Discovering…
                </>
              ) : <><I.sparkle /> Discover</>}
            </button>
          </form>

          {/* Quick-fill chips */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
            <span>Try:</span>
            {[
              { label: "news.ycombinator.com", url: "https://news.ycombinator.com/rss" },
              { label: "overreacted.io",        url: "https://overreacted.io" },
              { label: "stratechery.com",       url: "https://stratechery.com/feed" },
            ].map(({ label, url: u }) => (
              <button key={label} onClick={() => { setUrl(u); setDiscoverResult(null); setDiscoverError(""); }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "4px 9px 4px 8px", borderRadius: 99,
                  background: "var(--surface-2)", border: "1px solid var(--line)", color: "var(--ink-2)",
                  fontFamily: "var(--font-mono)", fontSize: 11, cursor: "pointer",
                  transition: "background .12s, border-color .12s, color .12s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--accent-tint)"; e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.borderColor = "var(--line)"; e.currentTarget.style.color = "var(--ink-2)"; }}
              >{label}</button>
            ))}
          </div>

          {discoverError && (
            <div style={{ background: "var(--bad-tint)", border: "1px solid color-mix(in oklab, var(--bad) 30%, transparent)", borderRadius: 10, padding: "8px 12px" }}>
              <p style={{ fontSize: 12.5, color: "var(--bad)", margin: 0 }}>{discoverError}</p>
            </div>
          )}

          {discoverResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, background: "var(--accent-tint)", border: "1px solid color-mix(in oklab, var(--accent) 25%, transparent)", borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--surface)", border: "1px solid var(--line)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                  {discoverResult.favicon_url
                    ? <img src={discoverResult.favicon_url} alt="" style={{ width: 20, height: 20, objectFit: "contain" }} onError={e => e.target.style.display = "none"} />
                    : <span style={{ fontSize: 16 }}>📡</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{discoverResult.title}</p>
                  <p style={{ fontSize: 12, color: "var(--muted)", margin: "2px 0 0" }}>{discoverResult.item_count} existing posts found</p>
                </div>
                <button onClick={handleSubscribe} disabled={subscribing}
                  style={{
                    padding: "8px 18px", border: 0, borderRadius: 9, cursor: subscribing ? "default" : "pointer",
                    font: "inherit", fontWeight: 600, fontSize: 13.5,
                    background: subscribing ? "var(--accent-tint-2)" : "var(--accent)",
                    color: subscribing ? "var(--accent)" : "var(--accent-ink)",
                    flexShrink: 0,
                  }}>{subscribing ? "Adding…" : "Subscribe"}</button>
              </div>
              {/* Optional category */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", flexShrink: 0 }}>Category</span>
                <input
                  value={categoryInput}
                  onChange={e => setCategoryInput(e.target.value)}
                  placeholder="e.g. Newsletter, Blog, Podcast (optional)"
                  style={{ flex: 1, border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", fontSize: 13, color: "var(--ink)", background: "var(--surface)", outline: "none", fontFamily: "inherit" }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Filter + sort toolbar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <div className="arciv-scroll-x" style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 5 }}>
            {FILTERS.map(f => (
              <Pill key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}<Cnt active={filter === f.id} n={counts[f.id]} />
              </Pill>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={handleRefreshAll}
              style={{ height: 32, padding: "0 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink-2)", font: "inherit", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", transition: "background .12s" }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--surface-2)"}
              onMouseLeave={e => e.currentTarget.style.background = "var(--surface)"}
            >
              <I.refresh /> Refresh all
            </button>
          </div>
        </div>

        {/* Sources list */}
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{ height: 76, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, opacity: 0.5 + i * 0.1 }} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: "center", padding: "64px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 14 }}>📡</div>
            <p style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-2)", margin: 0 }}>
              {filter === "all" ? "No feeds yet" : `No ${filter} feeds`}
            </p>
            <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "6px 0 0" }}>
              {filter === "all" ? "Add a blog or RSS source above to start tracking." : "Change the filter to see other feeds."}
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visible.map(feed => (
              <SourceRow
                key={feed.id}
                feed={feed}
                isMobile={isMobile}
                onTogglePause={handleTogglePause}
                onCheckNow={handleCheckNow}
                onDelete={id => setDeleteTarget(id)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Delete confirm */}
      {deleteTarget && (
        <DeleteModal
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)",
          background: "var(--ink)", color: "var(--bg)", borderRadius: 12, padding: "10px 14px",
          display: "flex", alignItems: "center", gap: 10,
          boxShadow: "var(--shadow-pop)", fontSize: 13, zIndex: 100,
          animation: "arciv-toastin .25s ease-out",
          whiteSpace: "nowrap",
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--good)", flexShrink: 0 }} />
          {toast}
        </div>
      )}
    </div>
  );
}
