import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const KIND_META = {
  new_feed_items: { bg: "var(--try-tint)",   fg: "var(--try)",   label: "Feed Update", icon: "📡" },
  feed_dead:      { bg: "var(--read-tint)",  fg: "var(--read)",  label: "Feed Error",  icon: "⚠️" },
  default:        { bg: "var(--surface-2)",  fg: "var(--muted)", label: "Notification", icon: "🔔" },
};

const DOMAIN_COLORS = ["#6d3aff","#ff6b3d","#14a974","#2a6fdb","#b18800","#cc1a6f"];

function domainColor(domain) {
  let h = 0;
  for (const c of domain) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return DOMAIN_COLORS[h % DOMAIN_COLORS.length];
}

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
          let domain = urlLine;
          try { domain = new URL(urlLine).hostname.replace(/^www\./, ""); } catch {}
          posts.push({ title, url: urlLine, domain });
          i = j;
          break;
        }
      }
    }
  }
  return posts;
}

function parseMoreCount(body) {
  if (!body) return 0;
  const m = body.match(/\.\.\. and (\d+) more/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseSourceUrl(body) {
  if (!body) return null;
  const m = body.match(/^source:\s*(\S+)/);
  return m ? m[1] : null;
}

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso);
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const ExternalIcon = ({ style }) => (
  <svg style={style} className="arciv-drawer-link-ext" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);

export default function NotifDrawer({ notif, onClose }) {
  const [data, setData] = useState(notif);
  const open = !!notif;

  useEffect(() => {
    if (notif) { setData(notif); return; }
    const t = setTimeout(() => setData(null), 360);
    return () => clearTimeout(t);
  }, [notif]);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!data) return null;

  const meta = KIND_META[data.type] || KIND_META.default;
  const posts = parsePosts(data.body);
  const moreCount = parseMoreCount(data.body);
  const sourceUrl = parseSourceUrl(data.body);
  const postLabel = data.type === "new_feed_items" ? "post" : "item";
  const totalPosts = posts.length + moreCount;

  return createPortal(
    <div className={`ldr-root${open ? " open" : ""}`}>
      <div className="ldr-scrim" onClick={onClose} />
      <aside className="ldr" role="dialog" aria-modal="true">

        {/* Hero */}
        <div className="ldr-hero">
          <div className="ldr-hero-grad" style={{
            background: `linear-gradient(135deg, color-mix(in oklab, ${meta.fg} 10%, var(--surface-2)) 0%, var(--surface-2) 70%)`,
          }} />
          <div className="ldr-hero-overlay" />
          <button className="ldr-x" onClick={onClose} title="Close (Esc)">×</button>
          <div className="ldr-hero-bottom">
            <div className="ldr-hero-chips">
              <div className="ldr-domain">
                <span style={{ fontSize: 15, lineHeight: 1 }}>{meta.icon}</span>
                <span>{meta.label}</span>
              </div>
              <div className="ldr-queue" style={{ background: meta.bg, color: meta.fg, borderColor: `color-mix(in oklab, ${meta.fg} 25%, transparent)` }}>
                {relativeTime(data.created_at)}
              </div>
            </div>
          </div>
        </div>

        {/* Scroll body */}
        <div className="ldr-scroll">

          {/* Title block */}
          <div className="ldr-title-block">
            <h2 className="ldr-title">{data.title}</h2>
            {sourceUrl && (
              <div className="ldr-sub">
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}
                  onMouseEnter={e => { e.currentTarget.style.textDecoration = "underline"; }}
                  onMouseLeave={e => { e.currentTarget.style.textDecoration = "none"; }}
                >
                  <ExternalIcon style={{ opacity: 1, color: "var(--accent)" }} />
                  {sourceUrl.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              </div>
            )}
          </div>

          {/* Posts section */}
          {posts.length > 0 ? (
            <section className="ldr-section">
              <div className="ldr-section-h">
                <div className="ldr-section-label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>
                  </svg>
                  {totalPosts} new {postLabel}{totalPosts !== 1 ? "s" : ""}
                  {moreCount > 0 && ` · showing ${posts.length}`}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {posts.map((post, i) => {
                  const letter = post.domain[0]?.toUpperCase() ?? "?";
                  const color = domainColor(post.domain);
                  return (
                    <a key={i} href={post.url} target="_blank" rel="noopener noreferrer" className="arciv-drawer-link">
                      <span className="arciv-drawer-fav" style={{ background: color }}>{letter}</span>
                      <div className="arciv-drawer-link-txt">
                        <div className="arciv-drawer-link-title">{post.title}</div>
                        <div className="arciv-drawer-link-meta"><span>{post.domain}</span></div>
                      </div>
                      <ExternalIcon />
                    </a>
                  );
                })}
              </div>
            </section>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
              {data.body || "No additional details."}
            </p>
          )}

          {/* More count callout */}
          {moreCount > 0 && (
            <div style={{
              background: "var(--try-tint)",
              border: "1px solid color-mix(in oklab, var(--try) 20%, transparent)",
              borderRadius: 12, padding: "12px 14px",
            }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.01em" }}>
                + {moreCount} more new {postLabel}{moreCount !== 1 ? "s" : ""}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                Go to <strong style={{ color: "var(--ink-2)" }}>Feed Tracker</strong> to browse all new posts from this source.
              </p>
            </div>
          )}

          <div style={{ height: 4 }} />
        </div>

      </aside>
    </div>,
    document.body
  );
}
