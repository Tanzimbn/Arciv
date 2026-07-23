import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errMessage } from "../api/client.js";
import LinkCard from "../components/LinkCard.jsx";
import LinkDetailDrawer from "../components/LinkDetailDrawer.jsx";
import NotificationBell from "../components/NotificationBell.jsx";
import QueueTabs from "../components/QueueTabs.jsx";
import UrlInputBar from "../components/UrlInputBar.jsx";
import { useBreakpoint } from "../hooks/useBreakpoint.js";

const TAB_SUBTITLES = {
  all:           "Everything you've saved, classified by AI.",
  "watch-later": "Videos, talks, and recordings — queued for when you have time.",
  "read-later":  "Long-reads, articles, and essays for later.",
  "try-later":   "Tools, products, and services you want to give a spin.",
  inbox:         "Links AI couldn't classify. Sort manually or retry.",
  archive:       "Links you've marked done. Your personal trail.",
};

const TAB_LABELS = {
  all: "All", "watch-later": "Watch Later", "read-later": "Read Later",
  "try-later": "Try Later", inbox: "Inbox", archive: "Archive",
};

const SunIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
  </svg>
);

const MoonIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

const FeedsIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 11a9 9 0 019 9"/><path d="M4 4a16 16 0 0116 16"/><circle cx="5" cy="19" r="1" fill="currentColor" stroke="none"/>
  </svg>
);

const SettingsIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
);

const LogoutIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);

function NavIconBtn({ onClick, title, children, hoverBg, hoverColor }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 34, height: 34, display: "grid", placeItems: "center",
        border: 0, borderRadius: 8, cursor: "pointer",
        background: hov ? (hoverBg || "var(--surface-2)") : "transparent",
        color: hov ? (hoverColor || "var(--ink)") : "var(--ink-2)",
        transition: "background .15s, color .15s, transform .08s",
        flexShrink: 0,
      }}
      onMouseDown={e => { e.currentTarget.style.transform = "translateY(1px)"; }}
      onMouseUp={e => { e.currentTarget.style.transform = "translateY(0)"; }}
    >
      {children}
    </button>
  );
}

// Animated classifying card shown while save API call is in flight
function ClassifyingCard({ url, onComplete }) {
  const STEPS = ["Fetching page metadata", "Reading content", "Classifying with AI", "Saving to your library"];
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= STEPS.length) {
      onComplete?.();
      return;
    }
    const t = setTimeout(() => setStep(s => s + 1), step === 0 ? 600 : 750);
    return () => clearTimeout(t);
  }, [step, onComplete]);

  let domain = url;
  try { domain = new URL(url.startsWith("http") ? url : "https://" + url).hostname.replace(/^www\./, ""); } catch {}

  return (
    <article className="arciv-classifying" style={{ borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ width: 20, height: 20, flexShrink: 0, border: "2px solid var(--accent-tint-2)", borderTopColor: "var(--accent)", borderRadius: 99, animation: "spin 0.7s linear infinite" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", display: "block" }}>Classifying…</b>
          <span style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", marginTop: 2 }}>{domain}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, fontFamily: "monospace", color: i < step ? "var(--try)" : i === step ? "var(--ink-2)" : "var(--muted-2)", opacity: i > step ? 0.4 : 1, transition: "opacity .2s, color .2s" }}>
            <span style={{ width: 14, height: 14, borderRadius: 99, border: `1px solid ${i < step ? "var(--try)" : i === step ? "var(--accent)" : "var(--line)"}`, background: i < step ? "var(--try)" : i === step ? "var(--accent-tint)" : "var(--surface-2)", color: i < step ? "#fff" : i === step ? "var(--accent)" : "transparent", display: "grid", placeItems: "center", fontSize: 8, flexShrink: 0, transition: "all .2s" }}>
              {i < step ? "✓" : ""}
            </span>
            {s}
          </div>
        ))}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
    </article>
  );
}

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function EmptyState({ queue }) {
  return (
    <div style={{ gridColumn: "1/-1", display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", gap: 12 }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--accent-tint)", display: "grid", placeItems: "center", color: "var(--accent)", fontSize: 22 }}>🔗</div>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.01em" }}>Nothing in this queue yet</h3>
      <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", textAlign: "center", maxWidth: 300, lineHeight: 1.5 }}>
        {queue ? "No links in this bucket yet." : "Paste a URL above and AI will sort it into the right bucket for you."}
      </p>
    </div>
  );
}

export default function LinksView({ onLogout, onSettings, onFeeds }) {
  const [allLinks, setAllLinks] = useState([]);
  const [activeQueue, setActiveQueue] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pendingUrl, setPendingUrl] = useState(null);
  const [saveError, setSaveError] = useState("");
  const savedLinkRef = useRef(null);
  const animDoneRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [toast, setToast] = useState(null);
  const [dark, setDark] = useState(() => localStorage.getItem("arciv_dark") === "1");
  const [layout, setLayout] = useState(() => localStorage.getItem("arciv_layout") || "grid");
  const [selectedLink, setSelectedLink] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [semanticResults, setSemanticResults] = useState(null); // null = no semantic results (fall back to substring)
  const [searching, setSearching] = useState(false);
  const [username, setUsername] = useState(null);

  // apply body classes
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.body.classList.toggle("dark", dark);
    localStorage.setItem("arciv_dark", dark ? "1" : "0");
  }, [dark]);

  useEffect(() => {
    document.body.classList.remove("layout-grid", "layout-list");
    document.body.classList.add(`layout-${layout}`);
    localStorage.setItem("arciv_layout", layout);
  }, [layout]);


  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [active, archived, me] = await Promise.all([
        api.getLinks({ limit: 500 }),
        api.getLinks({ queue: "archive", limit: 500 }),
        api.getMe(),
      ]);
      setAllLinks([...active, ...archived]);
      if (me?.username) setUsername(me.username);
    } catch {
      // token may be expired
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Silent refresh (no loading spinner) — used to poll for background AI results.
  const refreshSilently = useCallback(async () => {
    try {
      const [active, archived] = await Promise.all([
        api.getLinks({ limit: 500 }),
        api.getLinks({ queue: "archive", limit: 500 }),
      ]);
      setAllLinks([...active, ...archived]);
    } catch {
      // ignore — transient; next tick retries
    }
  }, []);

  // While any link is still being classified, poll so the card flips from
  // "AI is classifying" to its real queue/summary without a manual reload.
  const hasPending = useMemo(
    () => allLinks.some(l => l.ai_status === "pending" || l.ai_status === "processing"),
    [allLinks]
  );
  useEffect(() => {
    if (!hasPending) return;
    let ticks = 0;
    const id = setInterval(() => {
      ticks += 1;
      refreshSilently();
      if (ticks >= 45) clearInterval(id); // ~3 min cap (e.g. shared-key daily cap leaves it pending)
    }, 4000);
    return () => clearInterval(id);
  }, [hasPending, refreshSilently]);

  // Debounced semantic search. Server returns relevance-ranked, whole-library
  // results; on error/503 we fall back to client-side substring filtering.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setSemanticResults(null); setSearching(false); return; }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await api.searchLinks(q);
        if (!cancelled) setSemanticResults(res);
      } catch {
        if (!cancelled) setSemanticResults(null); // fall back to substring
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [searchQuery]);

  // Visible links. With a query: semantic results when available, else an
  // instant substring match over the whole library (also the fallback while the
  // request is in flight or if search is unavailable). Without: the queue view.
  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      if (semanticResults) return semanticResults;
      return allLinks.filter(l =>
        l.title?.toLowerCase().includes(q) ||
        l.canonical_url?.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q) ||
        l.ai_summary?.toLowerCase().includes(q) ||
        l.ai_tags?.some(t => t.toLowerCase().includes(q))
      );
    }
    if (activeQueue === "archive") return allLinks.filter(l => l.status === "done");
    if (activeQueue === null) return allLinks.filter(l => l.status !== "done");
    return allLinks.filter(l => l.queue === activeQueue && l.status !== "done");
  }, [allLinks, activeQueue, searchQuery, semanticResults]);

  // Counts per tab
  const counts = useMemo(() => ({
    all: allLinks.filter(l => l.status !== "done").length,
    "watch-later": allLinks.filter(l => l.queue === "watch-later" && l.status !== "done").length,
    "read-later": allLinks.filter(l => l.queue === "read-later" && l.status !== "done").length,
    "try-later": allLinks.filter(l => l.queue === "try-later" && l.status !== "done").length,
    inbox: allLinks.filter(l => l.queue === "inbox" && l.status !== "done").length,
    archive: allLinks.filter(l => l.status === "done").length,
  }), [allLinks]);

  // Stats (last 7 days)
  const stats = useMemo(() => {
    const now = Date.now();
    const week = 7 * 86400000;
    const thisWeek = allLinks.filter(l => now - new Date(l.saved_at) < week);
    const classified = allLinks.filter(l => l.ai_status === "done" || l.ai_status === "skipped");
    const done = allLinks.filter(l => l.status === "done");
    return {
      saved: thisWeek.length,
      classified: allLinks.length ? Math.round((classified.length / allLinks.length) * 100) : 0,
      done: done.length,
      inbox: counts.inbox,
    };
  }, [allLinks, counts]);

  const weekActivity = useMemo(() => {
    // Local calendar date (saved_at is UTC; Date() converts to local). Using
    // toISOString here would shift the day by the tz offset and miss saves.
    const localDay = (d) => {
      const x = new Date(d);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    };
    const now = new Date();
    const todayDow = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(now.getDate() - todayDow);
    return Array.from({ length: 7 }, (_, i) => {
      if (i > todayDow) return 0;
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      const dayStr = localDay(day);
      return allLinks.filter(l => l.saved_at && localDay(l.saved_at) === dayStr).length;
    });
  }, [allLinks]);

  const lastWeekTotal = useMemo(() => {
    const now = new Date();
    const todayDow = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(now.getDate() - todayDow);
    const lastMon = new Date(monday);
    lastMon.setDate(monday.getDate() - 7);
    const lastSun = new Date(lastMon);
    lastSun.setDate(lastMon.getDate() + 6);
    lastSun.setHours(23, 59, 59, 999);
    return allLinks.filter(l => {
      if (!l.saved_at) return false;
      const d = new Date(l.saved_at);
      return d >= lastMon && d <= lastSun;
    }).length;
  }, [allLinks]);

  function showToast(msg, color) {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 2200);
  }

  function commitSaved() {
    if (!savedLinkRef.current || !animDoneRef.current) return;
    const link = savedLinkRef.current;
    savedLinkRef.current = null;
    animDoneRef.current = false;
    setAllLinks(prev => [link, ...prev]);
    showToast(`Saved to ${TAB_LABELS[link.queue] || "Inbox"}`, "var(--accent)");
    setActiveQueue(link.queue || null);
    setPendingUrl(null);
    setSaving(false);
  }

  function handleClassifyComplete() {
    animDoneRef.current = true;
    commitSaved();
  }

  async function handleSave(url) {
    setSaveError("");
    setSaving(true);
    setPendingUrl(url);
    savedLinkRef.current = null;
    animDoneRef.current = false;
    try {
      const link = await api.createLink(url);
      savedLinkRef.current = link;
      commitSaved();
    } catch (err) {
      if (err.status === 409) {
        setSaveError(err.data?.detail?.message ?? "Already saved.");
      } else if (err.status === 429) {
        // Rate limited — surface the backend's "max N per minute" detail so the
        // user knows to slow down, not that the save is broken.
        setSaveError(errMessage(err, "Too many requests — slow down a moment."));
      } else {
        setSaveError("Failed to save link.");
      }
      setPendingUrl(null);
      setSaving(false);
    }
  }

  async function handleDone(id) {
    try {
      const updated = await api.updateLink(id, { status: "done" });
      setAllLinks(prev => prev.map(l => l.id === id ? updated : l));
      setActiveQueue("archive");
      showToast("Moved to Archive", "var(--archive)");
    } catch {}
  }

  async function handleRetryAI(id) {
    try {
      const updated = await api.retryAI(id);
      setAllLinks(prev => prev.map(l => l.id === id ? updated : l));
    } catch {}
  }

  async function handleDeleteConfirmed(id) {
    setDeleteConfirm(null);
    try {
      await api.deleteLink(id);
      setAllLinks(prev => prev.filter(l => l.id !== id));
    } catch {}
  }

  function handleLinkUpdate(updated) {
    setAllLinks(prev => prev.map(l => l.id === updated.id ? updated : l));
    setSelectedLink(updated);
  }

  function handleLinkDelete(id) {
    setAllLinks(prev => prev.filter(l => l.id !== id));
    setSelectedLink(null);
  }

  async function handleLinkRetryAI(id) {
    try {
      const updated = await api.retryAI(id);
      setAllLinks(prev => prev.map(l => l.id === id ? updated : l));
      return updated;
    } catch { return null; }
  }

  const { isMobile } = useBreakpoint();

  const _now = new Date();
  const todayIdx = (_now.getDay() + 6) % 7;
  const totalWeek = weekActivity.reduce((a, b) => a + b, 0);
  const maxDay = Math.max(...weekActivity, 1);
  const hr = _now.getHours();
  const timeGreeting = hr < 5 ? "Still up" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
  const dateLine = _now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }).toUpperCase();
  const weekNo = (() => {
    const d = new Date(Date.UTC(_now.getFullYear(), _now.getMonth(), _now.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const ys = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - ys) / 86400000) + 1) / 7);
  })();
  const inboxCount = counts.inbox || 0;
  const archiveCount = counts.archive || 0;
  const autoPct = stats.classified;

  const effectiveLayout = isMobile ? "grid" : layout;
  const tabTitle = TAB_LABELS[activeQueue ?? "all"] || "All";
  const tabSub = TAB_SUBTITLES[activeQueue ?? "all"];
  const initials = username
    ? username.split("_").slice(0, 2).map(w => w[0].toUpperCase()).join("")
    : "AR";

  const ArcivMark = (
    <div style={{
      width: 34, height: 34, borderRadius: 10, flexShrink: 0,
      background: "radial-gradient(120% 100% at 30% 20%, rgba(255,255,255,.35), transparent 55%), linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 65%, #1a0c4a))",
      display: "grid", placeItems: "center",
      boxShadow: "0 1px 0 rgba(255,255,255,.6) inset, 0 -3px 8px rgba(0,0,0,.18) inset, 0 4px 14px -2px color-mix(in oklab, var(--accent) 60%, transparent), 0 1px 2px rgba(0,0,0,.08)",
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ filter: "drop-shadow(0 1px 0 rgba(0,0,0,.12))" }}>
        <path d="M4 18h16M7 18 12 6l5 12M9.5 14h5"/>
      </svg>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* ── Topbar ── */}
      <div style={{ position: "sticky", top: isMobile ? 8 : 12, zIndex: 30, padding: isMobile ? "0 10px" : "0 16px" }}>
      <header style={{
        display: "flex", flexDirection: "column",
        padding: isMobile ? "10px 14px" : "10px 16px",
        background: "color-mix(in oklab, var(--nav) 82%, transparent)",
        backdropFilter: "blur(24px) saturate(170%)",
        WebkitBackdropFilter: "blur(24px) saturate(170%)",
        border: "1px solid var(--line)",
        borderRadius: isMobile ? 16 : 18,
        boxShadow: "0 1px 0 rgba(255,255,255,.55) inset, 0 4px 24px rgba(0,0,0,.07)",
        gap: isMobile ? 8 : 0,
      }}>
        {/* Main nav row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
            {ArcivMark}
            {!isMobile && (
              <span style={{ fontFamily: "'Instrument Serif', serif", fontSize: 20, fontWeight: 400, letterSpacing: "-0.02em", color: "var(--ink)" }}>
                arciv<em style={{ color: "var(--accent)" }}>.</em>
              </span>
            )}
          </div>

          {/* URL input — desktop only, inline */}
          {!isMobile && (
            <>
              <div style={{ width: 1, height: 20, background: "var(--line)", flexShrink: 0 }} />
              <div style={{ flex: 1, maxWidth: 560 }}>
                <UrlInputBar onSave={handleSave} loading={saving} />
              </div>
              {saveError && <span style={{ fontSize: 11.5, color: "var(--read)", whiteSpace: "nowrap", flexShrink: 0 }}>{saveError}</span>}
            </>
          )}

          <div style={{ flex: 1 }} />

          {/* Right cluster — nav pill */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 2,
            padding: 4, borderRadius: 11, flexShrink: 0,
            background: "color-mix(in oklab, var(--surface) 70%, transparent)",
            border: "1px solid var(--line)",
            boxShadow: "0 1px 0 rgba(255,255,255,.5) inset, 0 1px 2px rgba(22,21,19,.03)",
          }}>
            <NotificationBell />
            <NavIconBtn onClick={onFeeds} title="Feed Tracker" hoverBg="var(--watch-tint)" hoverColor="var(--watch)">
              <FeedsIcon />
            </NavIconBtn>
            <NavIconBtn onClick={onSettings} title="Settings" hoverBg="var(--accent-tint)" hoverColor="var(--accent)">
              <SettingsIcon />
            </NavIconBtn>
            <NavIconBtn onClick={() => setDark(d => !d)} title={dark ? "Light mode" : "Dark mode"}>
              {dark ? <SunIcon /> : <MoonIcon />}
            </NavIconBtn>
            <div style={{ width: 1, height: 18, background: "var(--line)", margin: "0 3px", flexShrink: 0 }} />
            <button
              title={username ?? "Account"}
              style={{
                width: 34, height: 34, borderRadius: 99, border: 0, padding: 0,
                cursor: "default",
                background: "radial-gradient(120% 100% at 30% 25%, rgba(255,255,255,.4), transparent 55%), linear-gradient(135deg, var(--accent), #b58dff)",
                display: "grid", placeItems: "center", color: "#fff",
                fontSize: 12, fontWeight: 600, flexShrink: 0,
                boxShadow: "0 0 0 2px var(--nav), 0 0 0 3px var(--line), 0 2px 6px rgba(109,58,255,.25)",
                transition: "transform .12s, box-shadow .15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 0 0 2px var(--nav), 0 0 0 3px var(--accent), 0 4px 10px rgba(109,58,255,.3)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 0 0 2px var(--nav), 0 0 0 3px var(--line), 0 2px 6px rgba(109,58,255,.25)"; }}
            >
              {initials}
            </button>
            <NavIconBtn onClick={onLogout} title="Log out" hoverBg="var(--read-tint)" hoverColor="var(--read)">
              <LogoutIcon />
            </NavIconBtn>
          </div>
        </div>

        {/* Mobile: URL input as second row */}
        {isMobile && (
          <div>
            <UrlInputBar onSave={handleSave} loading={saving} />
            {saveError && <span style={{ display: "block", fontSize: 11.5, color: "var(--read)", marginTop: 4 }}>{saveError}</span>}
          </div>
        )}
      </header>
      </div>

      {/* ── Page ── */}
      <main className="arciv-page-pad" style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 28px 80px" }}>

        {/* Hero */}
        <section className="arciv-hero" aria-label="Welcome">
          <div className="arciv-hero-greet">
            <div className="arciv-hero-eyebrow">
              <span className={`arciv-hero-pulse${inboxCount > 0 ? " warn" : ""}`} />
              <span>{dateLine}</span>
              <span className="arciv-hero-sep" />
              <span>WEEK {weekNo}</span>
              <span className="arciv-hero-sep" />
              <span>{allLinks.filter(l => l.status !== "done").length} LINKS · {inboxCount === 0 ? "INBOX ZERO" : `${inboxCount} TO TRIAGE`}</span>
            </div>
            <h1 className="arciv-hero-title">
              {timeGreeting}, <em>{username ?? "there"}</em>.
            </h1>
            <p className="arciv-hero-sub">
              {totalWeek > 0
                ? <><b>{totalWeek}</b> save{totalWeek !== 1 ? "s" : ""} this week</>
                : "Nothing saved yet this week"}
              {", "}<b>{autoPct}%</b> classified by AI
              {inboxCount === 0
                ? <>, and an <b>empty inbox</b>.</>
                : <> — <b>{inboxCount}</b> still to triage.</>}
            </p>
          </div>

          <div className="arciv-hero-panel" role="img" aria-label={`${totalWeek} links saved this week`}>
            <div className="arciv-hp-h">
              <span className="arciv-hp-label">This week</span>
              <span className="arciv-hp-total">{totalWeek}<em>saves</em></span>
            </div>
            <div>
              <div className="arciv-hp-bars">
                {weekActivity.map((n, i) => {
                  const pct = Math.max((n / maxDay) * 100, n === 0 ? 4 : 10);
                  return (
                    <div key={i} className={`arciv-hp-col${n === 0 ? " empty" : ""}${i === todayIdx ? " today" : ""}`}>
                      <div className="arciv-hp-bar" style={{ height: `${pct}%` }} title={`${DAY_LABELS[i]} · ${n} saved`} />
                    </div>
                  );
                })}
              </div>
              <div className="arciv-hp-days">
                {DAY_LABELS.map((d, i) => (
                  <span key={i} className={`arciv-hp-day${i === todayIdx ? " today" : ""}`}>{d}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Stats bar */}
        <div className="arciv-stats-bar">
          {[
            { key: "saved", label: "Saved this week", num: totalWeek,
              icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>,
              color: "var(--accent)",
              delta: totalWeek > lastWeekTotal ? { dir: "up", text: `+${totalWeek - lastWeekTotal} vs. last week` }
                   : totalWeek < lastWeekTotal ? { dir: "down", text: `-${lastWeekTotal - totalWeek} vs. last week` }
                   : { dir: "flat", text: "same as last week" } },
            { key: "auto", label: "Auto-classified", num: autoPct, suffix: "%",
              icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z"/></svg>,
              color: "var(--try)",
              delta: autoPct >= 90 ? { dir: "up", text: "on target" } : { dir: "flat", text: "review inbox" } },
            { key: "done", label: "Marked done", num: archiveCount,
              icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
              color: "var(--watch)",
              delta: archiveCount > 0 ? { dir: "up", text: `${archiveCount} total` } : { dir: "flat", text: "nothing yet" } },
            { key: "inbox", label: "In inbox", num: inboxCount,
              icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>,
              color: "var(--inbox)",
              delta: inboxCount === 0 ? { dir: "up", text: "inbox zero" } : { dir: "down", text: `${inboxCount} to triage` } },
          ].map(s => (
            <div key={s.key} className="arciv-stat-item">
              <div className="arciv-stat-head">
                <span className="arciv-stat-label">{s.label}</span>
                <div className="arciv-stat-ico" style={{ background: `color-mix(in oklab, ${s.color} 14%, transparent)`, color: s.color }}>
                  {s.icon}
                </div>
              </div>
              <div className="arciv-stat-num">
                {s.num}{s.suffix && <em>{s.suffix}</em>}
              </div>
              <div className="arciv-stat-delta">
                <span className={`arciv-stat-arrow ${s.delta.dir}`}>
                  {s.delta.dir === "up" ? (
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
                  ) : s.delta.dir === "down" ? (
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="7" x2="17" y2="17"/><polyline points="17 7 17 17 7 17"/></svg>
                  ) : (
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                  )}
                </span>
                {s.delta.text}
              </div>
            </div>
          ))}
        </div>

        {/* Page head */}
        <div className="arciv-page-head" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 22, gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: "'Instrument Serif', serif", fontWeight: 400, fontSize: isMobile ? 28 : 36, color: "var(--ink)", letterSpacing: "-0.02em", lineHeight: 1 }}>
              {tabTitle}
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 13, color: "var(--muted)", flexWrap: "wrap" }}>
              <span>{tabSub}</span>
              <span style={{ width: 3, height: 3, borderRadius: 99, background: "var(--muted-2)" }} />
              {searchQuery.trim() ? (
                <span style={{ fontFamily: "monospace" }}>
                  {searching
                    ? "searching…"
                    : `${visible.length} ${semanticResults ? "result" : "match"}${visible.length !== 1 ? "s" : ""}`}
                </span>
              ) : (
                <span style={{ fontFamily: "monospace" }}>{visible.length} link{visible.length !== 1 ? "s" : ""}</span>
              )}
            </div>
          </div>

          {/* Grid/List toggle — hidden on mobile */}
          {!isMobile && <div style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden", background: "var(--surface)", flexShrink: 0 }}>
            {["grid", "list"].map(l => (
              <button key={l} onClick={() => setLayout(l)} title={l} style={{ width: 32, height: 32, display: "grid", placeItems: "center", border: 0, cursor: "pointer", background: layout === l ? "var(--btn-dark)" : "transparent", color: layout === l ? "var(--btn-dark-text)" : "var(--muted)", transition: "background .12s, color .12s" }}>
                {l === "grid" ? (
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                    <rect x="0" y="0" width="7" height="7" rx="1.5"/><rect x="9" y="0" width="7" height="7" rx="1.5"/>
                    <rect x="0" y="9" width="7" height="7" rx="1.5"/><rect x="9" y="9" width="7" height="7" rx="1.5"/>
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                    <rect x="0" y="1" width="16" height="3" rx="1.5"/><rect x="0" y="7" width="16" height="3" rx="1.5"/><rect x="0" y="13" width="16" height="3" rx="1.5"/>
                  </svg>
                )}
              </button>
            ))}
          </div>}
        </div>

        {/* Tabs */}
        <div style={{ marginBottom: 12 }}>
          <QueueTabs active={activeQueue} onChange={setActiveQueue} counts={counts} />
        </div>

        {/* Search */}
        <div style={{ marginBottom: 20, position: "relative" }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", pointerEvents: "none", display: "flex" }}>
            <SearchIcon />
          </span>
          <input
            type="text"
            placeholder="Search your library by meaning…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: "100%", height: 40, paddingLeft: 36, paddingRight: searchQuery ? 36 : 12,
              border: "1px solid var(--line)", borderRadius: 10,
              background: "var(--surface)", color: "var(--ink)",
              fontSize: 13, outline: "none", boxShadow: "var(--shadow-card)",
              transition: "border-color .15s",
            }}
            onFocus={e => { e.currentTarget.style.borderColor = "var(--accent)"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "var(--line)"; }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "2px 4px", borderRadius: 4 }}
            >
              ×
            </button>
          )}
        </div>

        {/* Cards */}
        {loading ? (
          <div className="arciv-cards-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {[...Array(6)].map((_, i) => (
              <div key={i} style={{ height: 200, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, animation: "pulse 1.5s ease-in-out infinite", opacity: 0.6, animationDelay: `${i * 80}ms` }} />
            ))}
            <style>{`@keyframes pulse{0%,100%{opacity:.6}50%{opacity:.35}}`}</style>
          </div>
        ) : (
          <div className="arciv-cards-grid arciv-grid" style={{ display: "grid", gridTemplateColumns: effectiveLayout === "list" ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))", gap: effectiveLayout === "list" ? 8 : 14 }}>
            {pendingUrl && <ClassifyingCard url={pendingUrl} onComplete={handleClassifyComplete} />}
            {visible.length === 0 && !pendingUrl ? (
              searchQuery.trim() ? (
                <div style={{ gridColumn: "1/-1", display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", gap: 12 }}>
                  <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--surface-2)", display: "grid", placeItems: "center", fontSize: 22 }}>🔍</div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--ink)" }}>No matches found</h3>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", textAlign: "center", maxWidth: 280 }}>
                    No links match <em>"{searchQuery}"</em> — try a different term.
                  </p>
                </div>
              ) : (
                <EmptyState queue={activeQueue} />
              )
            ) : (
              visible.map(link => (
                <LinkCard
                  key={link.id}
                  link={link}
                  layout={effectiveLayout}
                  onDone={handleDone}
                  onDelete={id => setDeleteConfirm(id)}
                  onRetryAI={handleRetryAI}
                  onOpen={setSelectedLink}
                />
              ))
            )}
          </div>
        )}
      </main>

      {/* Toast */}
      {toast && (
        <div className="arciv-toast">
          <span style={{ width: 8, height: 8, borderRadius: 99, background: toast.color, flexShrink: 0 }} />
          {toast.msg}
        </div>
      )}

      {/* Delete modal */}
      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 20, padding: 24, maxWidth: 320, width: "100%", boxShadow: "var(--shadow-pop)" }}>
            <div style={{ width: 40, height: 40, borderRadius: 99, background: "var(--read-tint)", display: "grid", placeItems: "center", margin: "0 auto 12px", color: "var(--read)", fontSize: 18 }}>🗑</div>
            <p style={{ textAlign: "center", fontWeight: 700, fontSize: 14, color: "var(--ink)", margin: "0 0 4px" }}>Delete this link?</p>
            <p style={{ textAlign: "center", fontSize: 12.5, color: "var(--muted)", margin: "0 0 20px" }}>This action cannot be undone.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ flex: 1, padding: "9px 0", border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface-2)", color: "var(--ink-2)", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => handleDeleteConfirmed(deleteConfirm)} style={{ flex: 1, padding: "9px 0", border: 0, borderRadius: 10, background: "var(--read)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Link detail drawer */}
      <LinkDetailDrawer
        link={selectedLink}
        onClose={() => setSelectedLink(null)}
        onUpdate={handleLinkUpdate}
        onDelete={handleLinkDelete}
        onRetryAI={handleLinkRetryAI}
      />
    </div>
  );
}
