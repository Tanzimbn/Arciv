import { useState } from "react";
import { useBreakpoint } from "../hooks/useBreakpoint.js";

const QUEUE_META = {
  "watch-later": { label: "Watch Later", color: "var(--watch)", tint: "var(--watch-tint)" },
  "read-later":  { label: "Read Later",  color: "var(--read)",  tint: "var(--read-tint)"  },
  "try-later":   { label: "Try Later",   color: "var(--try)",   tint: "var(--try-tint)"   },
  inbox:         { label: "Inbox",       color: "var(--inbox)", tint: "var(--inbox-tint)" },
  archive:       { label: "Archive",     color: "var(--archive)",tint:"var(--archive-tint)"},
};

const LETTER_COLORS = ["#6d3aff","#ff6b3d","#14a974","#2a6fdb","#b18800"];

function FaviconOrLetter({ url, favColor, letter, size = 14 }) {
  return url ? (
    <img src={url} alt="" style={{ width: size, height: size, borderRadius: 3, objectFit: "contain", flexShrink: 0 }}
      onError={e => e.target.style.display = "none"} />
  ) : (
    <span style={{ width: size, height: size, borderRadius: 3, background: favColor, display: "grid", placeItems: "center", fontSize: size * 0.6, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
      {letter}
    </span>
  );
}

export default function LinkCard({ link, layout = "grid", onDone, onDelete, onRetryAI }) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const { isMobile } = useBreakpoint();

  const isList = layout === "list";
  const isArchive = link.status === "done";
  const queue = isArchive ? "archive" : (link.queue || "inbox");
  const meta = QUEUE_META[queue] || QUEUE_META.inbox;

  let domain = link.canonical_url;
  try { domain = new URL(link.canonical_url).hostname.replace(/^www\./, ""); } catch {}

  const letter = domain[0]?.toUpperCase() || "?";
  const favColor = LETTER_COLORS[domain.length % LETTER_COLORS.length];
  const savedDate = new Date(link.saved_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const isPending = link.ai_status === "pending" || link.ai_status === "processing";
  const isFailed = link.ai_status === "failed";
  const summary = link.ai_summary || link.description;

  // ── List layout ────────────────────────────────────────────────
  if (isList) {
    // Mobile: minimal row — favicon | title | queue dot | delete
    if (isMobile) {
      return (
        <article
          className="arciv-card"
          style={{
            background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12,
            boxShadow: "var(--shadow-card)", display: "flex", alignItems: "center",
            gap: 10, padding: "10px 12px", opacity: isArchive ? 0.75 : 1,
          }}
        >
          {/* Favicon / letter avatar */}
          <div style={{
            width: 28, height: 28, borderRadius: 7, flexShrink: 0,
            background: link.favicon_url ? "var(--surface-2)" : favColor,
            border: "1px solid var(--line)",
            display: "grid", placeItems: "center",
          }}>
            <FaviconOrLetter url={link.favicon_url} favColor={favColor} letter={letter} size={16} />
          </div>

          {/* Title */}
          <a
            href={link.url} target="_blank" rel="noopener noreferrer"
            style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: "var(--ink)", lineHeight: 1.3, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {link.title || link.url}
          </a>

          {/* Status dot */}
          {isPending && (
            <div style={{ position: "relative", width: 7, height: 7, flexShrink: 0 }}>
              <span style={{ position: "absolute", inset: 0, borderRadius: 99, background: "var(--inbox)", opacity: 0.4, animation: "arciv-ping 1.4s cubic-bezier(0,0,.2,1) infinite" }} />
              <span style={{ position: "absolute", inset: 0, borderRadius: 99, background: "var(--inbox)" }} />
            </div>
          )}

          {/* Queue dot */}
          <span style={{ width: 8, height: 8, borderRadius: 99, background: meta.color, flexShrink: 0, opacity: 0.85 }} />

          {/* Delete */}
          <button
            onClick={() => onDelete(link.id)} title="Delete"
            style={{ width: 30, height: 30, display: "grid", placeItems: "center", border: 0, background: "transparent", borderRadius: 6, color: "var(--muted)", cursor: "pointer", flexShrink: 0 }}
            onTouchStart={e => { e.currentTarget.style.background = "var(--read-tint)"; e.currentTarget.style.color = "var(--read)"; }}
            onTouchEnd={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--muted)"; }}
          >
            ✕
          </button>
        </article>
      );
    }

    // Desktop list: full row
    return (
      <article
        className="arciv-card"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12,
          boxShadow: hovered ? "0 4px 16px rgba(0,0,0,.08)" : "var(--shadow-card)",
          display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
          transition: "box-shadow .15s", opacity: isArchive ? 0.75 : 1,
          minWidth: 0, overflow: "hidden",
        }}
      >
        {/* Domain pill */}
        <div style={{
          display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
          background: "var(--surface-2)", border: "1px solid var(--line)",
          borderRadius: 99, padding: "3px 8px 3px 4px",
        }}>
          <FaviconOrLetter url={link.favicon_url} favColor={favColor} letter={letter} />
          <span style={{ fontSize: 10.5, fontWeight: 500, color: "var(--ink-2)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110 }}>
            {domain}
          </span>
        </div>

        {/* Title */}
        <a
          href={link.url} target="_blank" rel="noopener noreferrer"
          style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: "var(--ink)", lineHeight: 1.3, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          onMouseEnter={e => e.currentTarget.style.color = meta.color}
          onMouseLeave={e => e.currentTarget.style.color = "var(--ink)"}
        >
          {link.title || link.url}
        </a>

        {/* AI classifying dot */}
        {isPending && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
            <div style={{ position: "relative", width: 7, height: 7 }}>
              <span style={{ position: "absolute", inset: 0, borderRadius: 99, background: "var(--inbox)", opacity: 0.4, animation: "arciv-ping 1.4s cubic-bezier(0,0,.2,1) infinite" }} />
              <span style={{ position: "absolute", inset: 0, borderRadius: 99, background: "var(--inbox)" }} />
            </div>
            <span style={{ fontSize: 10.5, color: "var(--inbox)", fontWeight: 500 }}>AI classifying…</span>
          </div>
        )}
        {isFailed && (
          <span style={{ fontSize: 10.5, color: "var(--read)", background: "var(--read-tint)", borderRadius: 99, padding: "2px 8px", fontWeight: 500, flexShrink: 0 }}>AI failed</span>
        )}

        {/* Tags (max 2) */}
        {link.ai_tags?.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            {link.ai_tags.slice(0, 2).map(tag => (
              <span key={tag} style={{ fontSize: 10, padding: "2px 7px", background: "var(--accent-tint)", color: "var(--accent)", borderRadius: 99, fontWeight: 500 }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Queue chip */}
        <div style={{
          background: meta.tint, color: meta.color, border: `1px solid ${meta.color}30`,
          borderRadius: 99, padding: "3px 8px", fontSize: 10.5, fontWeight: 600,
          display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: 99, background: meta.color, opacity: 0.9 }} />
          {meta.label}
        </div>

        {/* Date */}
        <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace", flexShrink: 0 }}>{savedDate}</span>

        {/* AI badge */}
        {link.ai_status === "done" && (
          <span style={{ fontSize: 10.5, color: "var(--accent)", background: "var(--accent-tint)", borderRadius: 99, padding: "1px 7px", display: "flex", alignItems: "center", gap: 3, fontWeight: 500, flexShrink: 0 }}>
            ✦ AI
          </span>
        )}

        {/* Actions — rendered only when hovered to avoid occupying space at opacity 0 */}
        {hovered && (
          <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
            {isFailed && (
              <button onClick={() => onRetryAI(link.id)} style={{ fontSize: 10.5, padding: "3px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "var(--accent)", fontWeight: 600, cursor: "pointer" }}>
                ↺ Retry AI
              </button>
            )}
            {!isArchive && (
              <button onClick={() => onDone(link.id)} title="Mark done" style={{ width: 26, height: 26, display: "grid", placeItems: "center", border: 0, background: "var(--try-tint)", borderRadius: 6, color: "var(--try)", cursor: "pointer" }}>✓</button>
            )}
            <button onClick={() => onDelete(link.id)} title="Delete" style={{ width: 26, height: 26, display: "grid", placeItems: "center", border: 0, background: "var(--read-tint)", borderRadius: 6, color: "var(--read)", cursor: "pointer" }}>✕</button>
          </div>
        )}
      </article>
    );
  }

  // ── Grid layout ────────────────────────────────────────────────
  const GridActions = (
    <div style={{ display: "flex", alignItems: "center", gap: 2, opacity: hovered ? 1 : 0, transition: "opacity .15s", flexShrink: 0 }}>
      {isFailed && (
        <button onClick={() => onRetryAI(link.id)} style={{ fontSize: 10.5, padding: "3px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "var(--accent)", fontWeight: 600, cursor: "pointer" }}>
          ↺ Retry AI
        </button>
      )}
      {!isArchive && (
        <button onClick={() => onDone(link.id)} title="Mark done" style={{ width: 26, height: 26, display: "grid", placeItems: "center", border: 0, background: "transparent", borderRadius: 6, color: "var(--muted)", cursor: "pointer" }}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--try-tint)"; e.currentTarget.style.color = "var(--try)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--muted)"; }}>
          ✓
        </button>
      )}
      <button onClick={() => onDelete(link.id)} title="Delete" style={{ width: 26, height: 26, display: "grid", placeItems: "center", border: 0, background: "transparent", borderRadius: 6, color: "var(--muted)", cursor: "pointer" }}
        onMouseEnter={e => { e.currentTarget.style.background = "var(--read-tint)"; e.currentTarget.style.color = "var(--read)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--muted)"; }}>
        ✕
      </button>
    </div>
  );

  return (
    <article
      className="arciv-card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16,
        boxShadow: hovered ? "0 4px 16px rgba(0,0,0,.08)" : "var(--shadow-card)",
        display: "flex", flexDirection: "column",
        transition: "box-shadow .15s, transform .15s",
        transform: hovered ? "translateY(-1px)" : "none",
        opacity: isArchive ? 0.75 : 1,
      }}
    >
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>

        {/* Domain pill + type chip row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            background: "var(--surface-2)", border: "1px solid var(--line)",
            borderRadius: 99, padding: "3px 8px 3px 4px", minWidth: 0, flexShrink: 0,
          }}>
            <FaviconOrLetter url={link.favicon_url} favColor={favColor} letter={letter} />
            <span style={{ fontSize: 10.5, fontWeight: 500, color: "var(--ink-2)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
              {domain}
            </span>
          </div>
          <div style={{
            background: meta.tint, color: meta.color, border: `1px solid ${meta.color}30`,
            borderRadius: 99, padding: "3px 8px", fontSize: 10.5, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: 99, background: meta.color, opacity: 0.9 }} />
            {meta.label}
          </div>
        </div>

        {/* Title */}
        <a
          href={link.url} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", lineHeight: 1.35, letterSpacing: "-0.01em", textDecoration: "none", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          onMouseEnter={e => e.currentTarget.style.color = meta.color}
          onMouseLeave={e => e.currentTarget.style.color = "var(--ink)"}
        >
          {link.title || link.url}
        </a>

        {/* Summary */}
        {summary && (
          <p
            onClick={() => setExpanded(v => !v)}
            style={{
              fontSize: 12, color: "var(--muted)", lineHeight: 1.5, margin: 0, cursor: "pointer",
              display: expanded ? "block" : "-webkit-box",
              WebkitLineClamp: expanded ? undefined : 2,
              WebkitBoxOrient: expanded ? undefined : "vertical",
              overflow: expanded ? "visible" : "hidden",
              fontStyle: link.ai_summary ? "italic" : "normal",
            }}
            title={expanded ? "Click to collapse" : "Click to read more"}
          >
            {isFailed
              ? "AI processing failed — link saved without classification."
              : link.fetch_status === "unreachable"
              ? "Could not fetch this URL — saved but may be broken."
              : summary}
          </p>
        )}

        {/* AI status */}
        {(isPending || isFailed) && (
          isFailed ? (
            <span style={{
              fontSize: 10.5, borderRadius: 99, padding: "2px 8px", alignSelf: "flex-start", fontWeight: 500,
              color: "var(--read)", background: "var(--read-tint)", border: "1px solid color-mix(in oklab, var(--read) 30%, transparent)",
            }}>AI failed</span>
          ) : (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "var(--inbox-tint)", border: "1px solid color-mix(in oklab, var(--inbox) 25%, transparent)",
              borderRadius: 10, padding: "7px 10px",
            }}>
              <div style={{ position: "relative", width: 8, height: 8, flexShrink: 0 }}>
                <span style={{ position: "absolute", inset: 0, borderRadius: 99, background: "var(--inbox)", opacity: 0.4, animation: "arciv-ping 1.4s cubic-bezier(0,0,.2,1) infinite" }} />
                <span style={{ position: "absolute", inset: 0, borderRadius: 99, background: "var(--inbox)" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--inbox)", lineHeight: 1 }}>AI is classifying this link</span>
                <span style={{ fontSize: 10.5, color: "var(--muted)", lineHeight: 1.3 }}>Summarising and routing to the right queue — usually takes a few seconds.</span>
              </div>
            </div>
          )
        )}

        {/* Tags */}
        {link.ai_tags?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {link.ai_tags.map(tag => (
              <span key={tag} style={{ fontSize: 10, padding: "2px 7px", background: "var(--accent-tint)", color: "var(--accent)", borderRadius: 99, fontWeight: 500 }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>{savedDate}</span>
            {link.ai_status === "done" && (
              <span style={{ fontSize: 10.5, color: "var(--accent)", background: "var(--accent-tint)", borderRadius: 99, padding: "1px 7px", display: "flex", alignItems: "center", gap: 3, fontWeight: 500 }}>✦ AI</span>
            )}
            {link.fetch_status === "unreachable" && (
              <span style={{ fontSize: 10.5, color: "var(--read)", background: "var(--read-tint)", borderRadius: 99, padding: "1px 7px", fontWeight: 500 }}>unreachable</span>
            )}
          </div>
          {GridActions}
        </div>
      </div>
    </article>
  );
}
