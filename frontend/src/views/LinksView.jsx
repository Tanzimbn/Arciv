import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errMessage } from "../api/client.js";
import ByokOnboarding from "../components/ByokOnboarding.jsx";
import LinkCard from "../components/LinkCard.jsx";
import LinkDetailDrawer from "../components/LinkDetailDrawer.jsx";
import QueueTabs from "../components/QueueTabs.jsx";
import { MAX_TAGS, TopicsFilter } from "../components/TopicsFilter.jsx";
import TopNav, { FOCUS_URL_FLAG } from "../components/TopNav.jsx";
import { normaliseTag } from "../api/tags.js";
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

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);

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
          <span style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", marginTop: 2 }}>{domain}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, fontFamily: "var(--font-mono)", color: i < step ? "var(--try)" : i === step ? "var(--ink-2)" : "var(--muted-2)", opacity: i > step ? 0.4 : 1, transition: "opacity .2s, color .2s" }}>
            <span style={{ width: 14, height: 14, borderRadius: 99, border: `1px solid ${i < step ? "var(--try)" : i === step ? "var(--accent)" : "var(--line)"}`, background: i < step ? "var(--try)" : i === step ? "var(--accent-tint)" : "var(--surface-2)", color: i < step ? "var(--on-color)" : i === step ? "var(--accent)" : "transparent", display: "grid", placeItems: "center", fontSize: 8, flexShrink: 0, transition: "all .2s" }}>
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

export default function LinksView({ onLogout, onNavigate }) {
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
  // The one discovery filter: topic keys from the panel, combined by `tagLogic`
  // ("any" = union, "all" = intersection). Resolved server-side (see the effect
  // below) because membership must reflect the whole library, not the 500-row
  // page the dashboard happens to hold.
  const [activeTags, setActiveTags] = useState([]);
  const [tagLogic, setTagLogic] = useState("any");
  const [tagResults, setTagResults] = useState(null);
  const [topics, setTopics] = useState([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [showAllTopics, setShowAllTopics] = useState(false);
  const [topicsOpen, setTopicsOpen] = useState(false);

  const toggleTag = useCallback((key) => {
    setActiveTags(prev => {
      if (prev.includes(key)) return prev.filter(k => k !== key);
      // The server rejects more than MAX_TAGS keys; refusing here keeps that
      // from arriving as an empty result set with no cause on screen.
      return prev.length >= MAX_TAGS ? prev : [...prev, key];
    });
  }, []);
  // A stable primitive to depend on: a fresh array literal every render would
  // re-fire the fetch effects forever.
  const tagKey = activeTags.join("\u0000");
  const [username, setUsername] = useState(null);
  // BYOK onboarding — prompt a keyless user (with no shared key to fall back on)
  // to add a provider key, else their saved links never get classified.
  const [needsByok, setNeedsByok] = useState(false);
  const [showByok, setShowByok] = useState(false);
  const [byokDismissed, setByokDismissed] = useState(false);
  const urlRef = useRef(null);

  // Pressing "Save link" from Feeds or Settings routes here first; the flag is
  // what survives that navigation.
  useEffect(() => {
    if (sessionStorage.getItem(FOCUS_URL_FLAG)) {
      sessionStorage.removeItem(FOCUS_URL_FLAG);
      urlRef.current?.focus();
    }
  }, []);

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
      // Only the two link calls are load-bearing. The username and the BYOK
      // check are decoration, so they each swallow their own failure rather
      // than rejecting the Promise.all and leaving the library rendered empty.
      const [active, archived, me, settings] = await Promise.all([
        api.getLinks({ limit: 500 }),
        api.getLinks({ queue: "archive", limit: 500 }),
        api.getMe().catch(() => null),
        api.getSettings().catch(() => null),
      ]);
      setAllLinks([...active, ...archived]);
      if (me?.username) setUsername(me.username);
      // No personal key and no shared key => AI can't classify anything.
      const needs = !!settings && !settings.ai_api_key_masked && !settings.shared_ai_available;
      setNeedsByok(needs);
      // Auto-open the modal once per browser; the banner is the durable path back.
      if (needs && !localStorage.getItem("arciv_byok_prompted")) {
        localStorage.setItem("arciv_byok_prompted", "1");
        setShowByok(true);
      }
    } catch {
      // token may be expired
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Links can be saved from outside this view — the notification drawer turns a
  // feed update into saves. Without this the dashboard behind it would keep
  // showing a library that no longer matches.
  useEffect(() => {
    const h = () => fetchAll();
    window.addEventListener("arciv:links-changed", h);
    return () => window.removeEventListener("arciv:links-changed", h);
  }, [fetchAll]);

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

  // Topics are derived from ai_tags on read, so they change whenever a tag does
  // — a background classify landing, an edit in the drawer. Keying the refetch
  // on a signature of the tags themselves means no mutation site has to remember
  // to invalidate this.
  const tagSignature = useMemo(
    () => allLinks.map(l => (l.ai_tags ?? []).join(",")).join("|"),
    [allLinks]
  );
  useEffect(() => {
    let cancelled = false;
    setTopicsLoading(true);
    api
      // Scoped to the active tab, so the rail on Try Later lists Try Later's
      // topics with Try Later's counts. The server applies the same queue/status
      // rule the link list does (api/utils/link_query.apply_queue_scope), so a
      // chip's number is exactly what clicking it will show.
      // Ask for the full tail in one request: "+N more" and the query-narrowing
      // in the panel are then instant, and min_count=1 is what makes a
      // one-link topic findable by typing its name.
      .getTopics({ queue: activeQueue ?? undefined, min_count: 1, limit: 500 })
      .then(r => { if (!cancelled) setTopics(r); })
      .catch(() => { if (!cancelled) setTopics([]); })
      .finally(() => { if (!cancelled) setTopicsLoading(false); });
    return () => { cancelled = true; };
  }, [tagSignature, activeQueue]);

  // A topic that exists in one tab usually doesn't in the next, so a selection
  // carried across tabs would leave the panel with no active chip and the list
  // empty, with nothing on screen explaining why.
  useEffect(() => { setActiveTags([]); setShowAllTopics(false); }, [activeQueue]);

  // Below two topics, Any and All describe the same set. Resetting to "any"
  // keeps a stale "must match all" out of the summary line after a Clear.
  useEffect(() => { if (activeTags.length < 2) setTagLogic("any"); }, [activeTags.length]);

  // Topic browsing (no search query) is a server query: the tag must resolve
  // over the whole library, not over whatever subset is loaded client-side.
  useEffect(() => {
    if (!activeTags.length || searchQuery.trim()) { setTagResults(null); return; }
    let cancelled = false;
    api
      .getLinks({
        tag: activeTags,
        tag_logic: tagLogic,
        queue: activeQueue ?? undefined,
        limit: 500,
      })
      .then(r => { if (!cancelled) setTagResults(r); })
      .catch(() => { if (!cancelled) setTagResults([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagKey, tagLogic, activeQueue, searchQuery]);

  // Debounced semantic search. Server returns relevance-ranked, whole-library
  // results; on error/503 we fall back to client-side substring filtering.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setSemanticResults(null); setSearching(false); return; }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        // Tags go to the server with the query so ranking happens over the
        // filtered set — not "top 30 overall, then keep the 3 that match".
        const res = await api.searchLinks(q, { tag: activeTags, tag_logic: tagLogic });
        if (!cancelled) setSemanticResults(res);
      } catch {
        if (!cancelled) setSemanticResults(null); // fall back to substring
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, tagKey, tagLogic]);

  // Client-side twin of the server tag filter, used only on the offline
  // substring fallback below. Comparison goes through the shared normaliser so a
  // "React Native" tag still matches the "react-native" key the rail supplied.
  const matchesTag = useCallback(
    (l) => {
      if (!activeTags.length) return true;
      const keys = (l.ai_tags ?? []).map(normaliseTag);
      return tagLogic === "all"
        ? activeTags.every(k => keys.includes(k))
        : activeTags.some(k => keys.includes(k));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tagKey, tagLogic]
  );

  // Visible links. With a query: semantic results when available, else an
  // instant substring match over the whole library (also the fallback while the
  // request is in flight or if search is unavailable). Without: the queue view.
  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      if (semanticResults) return semanticResults;
      // Degraded path: semantic search is down, so match substrings locally. The
      // active topic still has to hold here or the fallback would quietly widen
      // the result set the user asked to narrow.
      return allLinks.filter(l =>
        matchesTag(l) && (
          l.title?.toLowerCase().includes(q) ||
          l.canonical_url?.toLowerCase().includes(q) ||
          l.description?.toLowerCase().includes(q) ||
          l.ai_summary?.toLowerCase().includes(q) ||
          l.ai_tags?.some(t => t.toLowerCase().includes(q))
        )
      );
    }
    if (activeTags.length) return tagResults ?? [];
    if (activeQueue === "archive") return allLinks.filter(l => l.status === "done");
    if (activeQueue === null) return allLinks.filter(l => l.status !== "done");
    return allLinks.filter(l => l.queue === activeQueue && l.status !== "done");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLinks, activeQueue, searchQuery, semanticResults, tagKey, tagResults, matchesTag]);

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

  const toastTimer = useRef(null);
  function showToast(msg, color, duration = 2200) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, color });
    toastTimer.current = setTimeout(() => setToast(null), duration);
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
        // Dedup is specific to the URL just typed — inline by the input fits.
        setSaveError(err.data?.detail?.message ?? "Already saved.");
      } else if (err.status === 403) {
        // Account-level quota (storage / link count). Surface the backend's
        // actionable detail as a prominent, longer-lived red toast — the inline
        // "Failed to save link" was ambiguous about the real cause + the fix.
        showToast(errMessage(err, "Storage or link limit reached."), "var(--bad)", 5200);
      } else if (err.status === 429) {
        // Rate limited — same treatment: a toast, not a "broken save" message.
        showToast(errMessage(err, "Too many requests — slow down a moment."), "var(--bad)", 4200);
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
  const inboxCount = counts.inbox || 0;
  const archiveCount = counts.archive || 0;
  const autoPct = stats.classified;

  const effectiveLayout = isMobile ? "grid" : layout;
  const tabTitle = TAB_LABELS[activeQueue ?? "all"] || "All";
  const tabSub = TAB_SUBTITLES[activeQueue ?? "all"];
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <TopNav
        active="library"
        onNavigate={onNavigate}
        onSave={() => urlRef.current?.focus()}
        onLogout={onLogout}
        dark={dark}
        onToggleDark={() => setDark(d => !d)}
        /* Desktop keeps the field in the bar; the phone cannot spare the width,
           so there it moves into the page and the bar shows its "Save" CTA
           instead — the same button the other routes use, focusing the field
           rather than navigating. The error hangs off the bar rather than
           displacing it, so a 409 does not shove the page down. */
        saver={isMobile ? null : (
          <div style={{ position: "relative" }}>
            <UrlInputBar onSave={handleSave} loading={saving} inputRef={urlRef} />
            {saveError && (
              <span style={{
                position: "absolute", left: 14, top: "100%", marginTop: 3,
                fontSize: 12, color: "var(--read)", whiteSpace: "nowrap",
              }}>{saveError}</span>
            )}
          </div>
        )}
      />

      {/* ── Page ── */}
      <main className="arciv-page-pad" style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 28px 80px" }}>

        {/* Phone only — see the note on `saver` above. It leads the page because
            saving is the dashboard's primary action. */}
        {isMobile && (
          <div style={{ marginBottom: 20 }}>
            <UrlInputBar onSave={handleSave} loading={saving} inputRef={urlRef} />
            {saveError && (
              <span style={{ display: "block", fontSize: 12, color: "var(--read)", marginTop: 6 }}>{saveError}</span>
            )}
          </div>
        )}

        {/* BYOK nudge — only when AI is unavailable (no personal + no shared key) */}
        {needsByok && !byokDismissed && (
          <div style={{
            display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
            padding: "13px 16px", marginBottom: 20,
            background: "var(--accent-tint)",
            border: "1px solid color-mix(in oklab, var(--accent) 25%, transparent)",
            borderRadius: 14,
          }}>
            <span style={{ color: "var(--accent)", display: "flex", flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", margin: 0 }}>
                Turn on AI classification
              </p>
              <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "2px 0 0", lineHeight: 1.4 }}>
                Add your AI provider key so Arciv can sort your links automatically.
              </p>
            </div>
            <button type="button" onClick={() => setShowByok(true)}
              style={{
                padding: "8px 15px", border: 0, borderRadius: 9, flexShrink: 0,
                fontSize: 13, fontWeight: 700, cursor: "pointer",
                background: "var(--accent)", color: "var(--accent-ink)",
              }}>
              Add key
            </button>
            <button type="button" onClick={() => setByokDismissed(true)} aria-label="Dismiss"
              style={{
                width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                border: 0, background: "transparent", color: "var(--muted)",
                cursor: "pointer", display: "grid", placeItems: "center", fontSize: 15,
              }}>
              ✕
            </button>
          </div>
        )}

        {/* Hero */}
        <section className="arciv-hero" aria-label="Welcome">
          <div className="arciv-hero-greet">
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
            <h1 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: isMobile ? 28 : 36, color: "var(--ink)", letterSpacing: "-0.02em", lineHeight: 1 }}>
              {tabTitle}
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 13, color: "var(--muted)", flexWrap: "wrap" }}>
              <span>{tabSub}</span>
              <span style={{ width: 3, height: 3, borderRadius: 99, background: "var(--muted-2)" }} />
              {searchQuery.trim() ? (
                <span style={{ fontFamily: "var(--font-mono)" }}>
                  {searching
                    ? "searching…"
                    : `${visible.length} ${semanticResults ? "result" : "match"}${visible.length !== 1 ? "s" : ""}`}
                </span>
              ) : (
                <span style={{ fontFamily: "var(--font-mono)" }}>{visible.length} link{visible.length !== 1 ? "s" : ""}</span>
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

        {/* Discovery — tabs, search and topics in one card, because all three
            narrow the same list. Topic chips are multi-select and combine by
            Any/All; the selection is resolved server-side so it holds over the
            whole library rather than the page held in memory. */}
        <TopicsFilter
          topics={topics}
          loading={topicsLoading}
          selected={activeTags}
          onToggle={toggleTag}
          onClear={() => setActiveTags([])}
          logic={tagLogic}
          onLogicChange={setTagLogic}
          open={topicsOpen}
          onToggleOpen={() => setTopicsOpen(v => !v)}
          query={searchQuery}
          showAll={showAllTopics}
          onToggleShowAll={() => setShowAllTopics(v => !v)}
          tabsSlot={<QueueTabs active={activeQueue} onChange={setActiveQueue} counts={counts} flat />}
          searchSlot={
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", pointerEvents: "none", display: "flex" }}>
                <SearchIcon />
              </span>
              <input
                type="text"
                placeholder="Search your library by meaning, or type a topic…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: "100%", height: 40, paddingLeft: 36, paddingRight: searchQuery ? 36 : 12,
                  border: "1px solid var(--line)", borderRadius: 10,
                  background: "var(--surface)", color: "var(--ink)",
                  fontSize: 13, outline: "none",
                  transition: "border-color .15s",
                }}
                onFocus={e => { e.currentTarget.style.borderColor = "var(--accent)"; }}
                onBlur={e => { e.currentTarget.style.borderColor = "var(--line)"; }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  title="Clear search"
                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "2px 4px", borderRadius: 4 }}
                >
                  ×
                </button>
              )}
            </div>
          }
        />

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
              /* A topic combination that matches nothing needs the way out named
                 — an empty grid under a filter bar reads as "you have nothing
                 saved", which is rarely what happened. */
              activeTags.length ? (
                <div style={{ gridColumn: "1/-1", border: "1px dashed var(--line)", borderRadius: 15, padding: 40, textAlign: "center" }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink)" }}>
                    Nothing matches this combination
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
                    {tagLogic === "all" && activeTags.length > 1
                      ? <>Try switching to <strong style={{ color: "var(--accent)", fontWeight: 600 }}>Any</strong>, or clear a topic.</>
                      : searchQuery.trim()
                        ? <>No link matches both the search and {activeTags.length > 1 ? "these topics" : "this topic"}.</>
                        : <>Clear the topic to see the rest of this tab.</>}
                  </div>
                </div>
              ) : searchQuery.trim() ? (
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
                  aiAvailable={!needsByok}
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
              <button onClick={() => handleDeleteConfirmed(deleteConfirm)} style={{ flex: 1, padding: "9px 0", border: 0, borderRadius: 10, background: "var(--read)", color: "var(--on-color)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* BYOK onboarding */}
      {showByok && (
        <ByokOnboarding
          onDone={async (added) => {
            setShowByok(false);
            if (added) {
              setNeedsByok(false);
              showToast("AI classification is on", "var(--accent)");
              // Re-pull settings so the banner/flag reflect the saved key.
              try {
                const s = await api.getSettings();
                setNeedsByok(!s.ai_api_key_masked && !s.shared_ai_available);
              } catch {
                /* keep optimistic state */
              }
            }
          }}
        />
      )}

      {/* Link detail drawer */}
      <LinkDetailDrawer
        link={selectedLink}
        onClose={() => setSelectedLink(null)}
        onUpdate={handleLinkUpdate}
        onDelete={handleLinkDelete}
        onRetryAI={handleLinkRetryAI}
        onOpenLink={setSelectedLink}
        aiAvailable={!needsByok}
      />
    </div>
  );
}
