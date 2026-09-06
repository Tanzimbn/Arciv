import { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useBreakpoint } from "../hooks/useBreakpoint.js";
import NotifDrawer from "./NotifDrawer.jsx";

const KIND_STYLE = {
  new_feed_items: { bg: "var(--try-tint)",    fg: "var(--try)",    icon: "📡" },
  feed_dead:      { bg: "var(--read-tint)",   fg: "var(--read)",   icon: "⚠️" },
  ai_classified:  { bg: "var(--accent-tint)", fg: "var(--accent)", icon: "✦" },
  default:        { bg: "var(--surface-2)",   fg: "var(--muted)",  icon: "•" },
};

function parsePosts(body) {
  if (!body) return [];
  const posts = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("• ") || line.startsWith("· ")) {
      const title = line.slice(2).trim();
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const urlLine = lines[j].trim();
        if (urlLine.startsWith("http")) {
          posts.push({ title, url: urlLine });
          i = j;
          break;
        }
      }
    }
  }
  return posts;
}

function formatTime(d) {
  const diff = Date.now() - new Date(d);
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), dy = Math.floor(diff / 86400000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (dy < 7) return `${dy}d ago`;
  return new Date(d).toLocaleDateString();
}

export default function NotificationBell() {
  const { isMobile } = useBreakpoint();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedNotif, setSelectedNotif] = useState(null);
  const panelRef = useRef(null);

  useEffect(() => {
    const fetch = async () => {
      try { const d = await api.getUnreadCount(); setUnreadCount(d.count); } catch {}
    };
    fetch();
    const iv = setInterval(fetch, 30000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const h = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setIsOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [isOpen]);

  const handleToggle = async () => {
    if (!isOpen) {
      setLoading(true);
      try { setNotifications(await api.getNotifications()); } catch {}
      setLoading(false);
    }
    setIsOpen(o => !o);
    if (!isOpen) setUnreadCount(0);
  };

  const handleClickNotification = async (n) => {
    setSelectedNotif(n.is_read ? n : { ...n, is_read: true });
    setIsOpen(false);
    if (!n.is_read) {
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
      setUnreadCount(c => Math.max(0, c - 1));
      try { await api.readNotification(n.id); } catch {}
    }
  };


  const handleMarkAllRead = async () => {
    try {
      await api.readAllNotifications();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {}
  };

  const closeDetail = () => setSelectedNotif(null);

  return (
    <div style={{ position: "relative" }} ref={panelRef}>

      {/* ── Bell button ── */}
      <button
        onClick={handleToggle}
        style={{ position: "relative", width: 36, height: 36, display: "grid", placeItems: "center", border: 0, background: "transparent", borderRadius: 8, cursor: "pointer", color: "var(--muted)", transition: "background .15s, color .15s" }}
        onMouseEnter={e => { e.currentTarget.style.background = "var(--accent-tint)"; e.currentTarget.style.color = "var(--accent)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--muted)"; }}
      >
        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
        </svg>
        {unreadCount > 0 && (
          <span style={{ position: "absolute", top: 5, right: 5, minWidth: 14, height: 14, padding: "0 3px", background: "var(--accent)", color: "var(--accent-ink)", fontSize: 7, fontWeight: 700, borderRadius: 99, display: "grid", placeItems: "center", border: "2px solid var(--bg)" }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* ── Notification dropdown ── */}
      {isOpen && (
        <div style={{ position: isMobile ? "fixed" : "absolute", right: isMobile ? 16 : 0, left: isMobile ? 16 : "auto", top: isMobile ? 70 : 44, width: isMobile ? "auto" : 360, zIndex: 50, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden", boxShadow: "var(--shadow-pop)" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--surface-2)" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>Notifications</span>
            {notifications.some(n => !n.is_read) && (
              <button onClick={handleMarkAllRead} style={{ fontSize: 11.5, color: "var(--accent)", background: "none", border: 0, cursor: "pointer", fontWeight: 500 }}>
                Mark all read
              </button>
            )}
          </div>
          <div style={{ maxHeight: 380, overflowY: "auto" }}>
            {loading ? (
              <div style={{ padding: "32px 16px", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>Loading…</div>
            ) : notifications.length === 0 ? (
              <div style={{ padding: "40px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>🔔</div>
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>All caught up!</p>
              </div>
            ) : notifications.map(n => {
              const s = KIND_STYLE[n.type] || KIND_STYLE.default;
              const postCount = parsePosts(n.body).length;
              return (
                <div key={n.id} onClick={() => handleClickNotification(n)}
                  style={{ display: "flex", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--line-2)", cursor: "pointer", background: !n.is_read ? "color-mix(in oklab, var(--accent-tint) 30%, transparent)" : "transparent" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--surface-2)"}
                  onMouseLeave={e => e.currentTarget.style.background = !n.is_read ? "color-mix(in oklab, var(--accent-tint) 30%, transparent)" : "transparent"}
                >
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: s.bg, color: s.fg, display: "grid", placeItems: "center", fontSize: 13, flexShrink: 0 }}>
                    {s.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.45, margin: 0 }}>{n.title}</p>
                    {postCount > 0 && (
                      <p style={{ fontSize: 11.5, color: "var(--accent)", margin: "3px 0 0", fontWeight: 500 }}>
                        {postCount} post{postCount !== 1 ? "s" : ""} — click to view
                      </p>
                    )}
                    <p style={{ fontSize: 11, color: "var(--muted-2)", margin: "4px 0 0", fontFamily: "var(--font-mono)" }}>{formatTime(n.created_at)}</p>
                  </div>
                  {!n.is_read && <div style={{ width: 7, height: 7, borderRadius: 99, background: "var(--accent)", flexShrink: 0, marginTop: 5 }} />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Notification detail drawer ── */}
      <NotifDrawer notif={selectedNotif} onClose={closeDetail} />

    </div>
  );
}
