import { useState } from "react";

const TagIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8.6 1.9L14.1 7.4a1.2 1.2 0 010 1.7l-4.9 4.9a1.2 1.2 0 01-1.7 0L2 8.5V2.6a.7.7 0 01.7-.7h5.9z"
      stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <circle cx="5.3" cy="5.3" r="1.05" fill="currentColor" />
  </svg>
);

const Chevron = ({ open }) => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"
    style={{ flex: "none", transform: open ? "rotate(180deg)" : "none", transition: "transform 140ms ease" }}>
    <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Topics with no links in the active tab are already absent from `topics`. */
const VISIBLE = 8;

/** Mirrors the server's cap (api/routers/links.TagFilter). Enforced here too so
 *  the 11th click is an inert chip with an explanation, not a 422 that surfaces
 *  as "nothing matches this combination". */
export const MAX_TAGS = 10;

/**
 * Topic filtering as one panel: the tab bar, the search box, the topic chips and
 * the active selection all inside a single card, because they narrow one list.
 *
 * Two things make this more than the old single-select rail:
 *
 * - **Multi-select with Any/All.** Union and intersection answer different
 *   questions — "anything about rust or LLMs" versus "the one link about both" —
 *   and neither contains the other, so the choice is exposed rather than assumed.
 *   Both are resolved server-side (`?tag=a&tag=b&tag_logic=`), never by filtering
 *   an already-ranked page client-side.
 * - **Collapsible.** A long tail of chips above every list is a permanent tax on
 *   readers who don't filter, so the panel folds away and the toggle carries a
 *   badge with the live selection count.
 *
 * `topics` arrives already scoped to the active tab (`GET /api/topics?queue=`),
 * so a chip's count is what the list below will show once it is clicked. Nothing
 * here recomputes a count — that is the one way the number and the list could
 * disagree. `query` narrows which chips are shown, so the search box doubles as
 * a topic finder; it never touches the counts.
 */
export function TopicsFilter({
  topics,
  loading,
  selected,
  onToggle,
  onClear,
  logic,
  onLogicChange,
  open,
  onToggleOpen,
  query = "",
  showAll,
  onToggleShowAll,
  tabsSlot,
  searchSlot,
}) {
  const [toggleHov, setToggleHov] = useState(false);
  const n = selected.length;
  const q = query.trim().toLowerCase();
  const matching = q ? topics.filter(t => t.key.includes(q)) : topics;
  const hasMore = matching.length > VISIBLE;
  const shown = showAll ? matching : matching.slice(0, VISIBLE);

  // Selected chips stay visible even when the query or the "+N more" cut would
  // hide them — a filter you cannot see is a filter you cannot undo.
  const pinned = matching === topics
    ? []
    : topics.filter(t => selected.includes(t.key) && !matching.some(m => m.key === t.key));
  const chips = [...shown, ...pinned.filter(p => !shown.some(s => s.key === p.key))];

  const accentSoft = "color-mix(in oklab, var(--accent) 12%, transparent)";
  const accentLine = "color-mix(in oklab, var(--accent) 42%, transparent)";

  return (
    <div style={{
      marginBottom: 20,
      border: "1px solid var(--line)", borderRadius: 16,
      background: "var(--surface)", boxShadow: "var(--shadow-card)",
      overflow: "hidden",
    }}>
      {tabsSlot && (
        <div style={{ padding: 8, borderBottom: "1px solid var(--line-2)" }}>{tabsSlot}</div>
      )}

      {/* Search + Topics toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>{searchSlot}</div>
        <button
          onClick={onToggleOpen}
          aria-expanded={open}
          title={open ? "Hide topics" : "Show topics"}
          onMouseEnter={() => setToggleHov(true)}
          onMouseLeave={() => setToggleHov(false)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8, flex: "none",
            height: 40, padding: "0 13px", borderRadius: 10, cursor: "pointer",
            fontSize: 13, fontWeight: 500,
            // Hover reads as the accent, like the Settings button in the nav.
            // With a selection the button is already accent-tinted, so hover
            // deepens the tint rather than restating it.
            border: `1px solid ${n || toggleHov ? accentLine : "var(--line)"}`,
            background: n
              ? (toggleHov ? "color-mix(in oklab, var(--accent) 22%, transparent)" : accentSoft)
              : (toggleHov ? "var(--accent-tint)" : "var(--surface)"),
            color: n ? "var(--ink)" : (toggleHov ? "var(--accent)" : "var(--muted)"),
            transition: "background .15s, color .15s, border-color .15s",
          }}
        >
          <TagIcon size={15} />
          <span>Topics</span>
          {n > 0 && (
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              minWidth: 18, height: 18, padding: "0 5px", borderRadius: 99,
              background: "var(--accent)", color: "var(--accent-ink)",
              fontSize: 11, fontWeight: 600,
            }}>
              {n}
            </span>
          )}
          <Chevron open={open} />
        </button>
      </div>

      {open && (
        <div style={{ padding: "0 12px 12px", animation: "arciv-topics-in 150ms ease-out" }}>
          <div style={{
            border: "1px solid var(--line)", borderRadius: 13,
            background: "var(--surface-2)", padding: 13,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 7,
                  fontSize: 11, fontWeight: 600, letterSpacing: ".1em",
                  textTransform: "uppercase", color: "var(--muted)",
                }}>
                  <TagIcon /> Topics
                </span>

                {/* Any/All — disabled below two selections, where both agree. */}
                <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, background: "var(--surface)", border: "1px solid var(--line-2)" }}>
                  {[["any", "Any"], ["all", "All"]].map(([id, label]) => {
                    const on = logic === id;
                    return (
                      <button
                        key={id}
                        onClick={() => onLogicChange(id)}
                        disabled={n < 2}
                        title={n < 2
                          ? "Pick two or more topics to combine them"
                          : id === "any" ? "Show links matching any selected topic"
                                         : "Show only links matching every selected topic"}
                        style={{
                          height: 22, padding: "0 10px", borderRadius: 6, border: 0,
                          fontSize: 11.5, fontWeight: 600,
                          cursor: n < 2 ? "default" : "pointer",
                          background: on ? "var(--btn-dark)" : "transparent",
                          color: on ? "var(--btn-dark-text)" : "var(--muted)",
                          opacity: n < 2 && !on ? 0.5 : 1,
                          transition: "background .12s, color .12s",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {n > 0 && (
                <button
                  onClick={onClear}
                  style={{
                    height: 26, padding: "0 10px", borderRadius: 8, cursor: "pointer",
                    border: "1px solid var(--line)", background: "transparent",
                    color: "var(--muted)", fontSize: 12,
                    transition: "color .12s, border-color .12s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = "var(--read)"; e.currentTarget.style.borderColor = "var(--read)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "var(--muted)"; e.currentTarget.style.borderColor = "var(--line)"; }}
                >
                  Clear {n}
                </button>
              )}
            </div>

            <div style={{ marginTop: 13, display: "flex", flexWrap: "wrap", gap: 7 }}>
              {loading && topics.length === 0 && (
                <span style={{ fontSize: 12.5, color: "var(--muted-2)", fontFamily: "var(--font-mono)" }}>loading…</span>
              )}
              {!loading && topics.length === 0 && (
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  No repeated topics in this tab yet — chips appear once two links share a tag.
                </span>
              )}

              {chips.map(t => {
                const on = selected.includes(t.key);
                const full = !on && n >= MAX_TAGS;
                return (
                  <button
                    key={t.key}
                    onClick={() => { if (!full) onToggle(t.key); }}
                    aria-pressed={on}
                    disabled={full}
                    title={
                      full ? `At most ${MAX_TAGS} topics at once — remove one first`
                           : on ? `Remove "${t.label}"`
                                : `Add ${t.count} link${t.count !== 1 ? "s" : ""} tagged ${t.label}`
                    }
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 7,
                      height: 32, padding: "0 12px", borderRadius: 99,
                      cursor: full ? "default" : "pointer", opacity: full ? 0.45 : 1,
                      fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap",
                      border: `1px solid ${on ? "transparent" : "var(--line)"}`,
                      background: on ? "var(--accent)" : "var(--surface)",
                      color: on ? "var(--accent-ink)" : "var(--ink-2)",
                      boxShadow: on ? "0 0 0 3px color-mix(in oklab, var(--accent) 14%, transparent)" : "none",
                      transition: "background .12s, color .12s, border-color .12s, box-shadow .12s",
                    }}
                    onMouseEnter={e => { if (!on && !full) e.currentTarget.style.background = "var(--surface-2)"; }}
                    onMouseLeave={e => { if (!on) e.currentTarget.style.background = "var(--surface)"; }}
                  >
                    <span style={{
                      fontSize: on ? 11 : 12,
                      color: on ? "var(--accent-ink)" : "var(--muted-2)",
                    }}>
                      {on ? "✓" : "#"}
                    </span>
                    <span>{t.label}</span>
                    <span style={{
                      fontSize: 11, fontFamily: "var(--font-mono)",
                      color: on ? "color-mix(in oklab, var(--accent-ink) 75%, transparent)" : "var(--muted)",
                    }}>
                      {t.count}
                    </span>
                  </button>
                );
              })}

              {hasMore && (
                <button
                  onClick={onToggleShowAll}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    height: 32, padding: "0 12px", borderRadius: 99, cursor: "pointer",
                    border: "1px dashed var(--muted-2)", background: "transparent",
                    color: "var(--muted)", fontSize: 12.5, fontWeight: 500,
                    transition: "color .12s, border-color .12s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.borderColor = "var(--accent)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "var(--muted)"; e.currentTarget.style.borderColor = "var(--muted-2)"; }}
                >
                  {showAll ? "Show less" : `+${matching.length - VISIBLE} more`}
                </button>
              )}
            </div>

            {!loading && topics.length > 0 && matching.length === 0 && (
              <div style={{ marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
                No topic matches “{query.trim()}”.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Active selection — readable when the panel is folded away, and every
          chip removable from here, so a fold can never hide a live filter. */}
      {n > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "11px 13px", borderTop: "1px solid var(--line-2)",
          background: "color-mix(in oklab, var(--accent) 5%, transparent)",
        }}>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            {n === 1
              ? "Filtered by 1 topic"
              : `Filtered by ${n} topics · ${logic === "all" ? "must match all" : "match any"}`}
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {selected.map(key => {
              const t = topics.find(x => x.key === key);
              return (
                <button
                  key={key}
                  onClick={() => onToggle(key)}
                  title={`Remove "${t?.label ?? key}"`}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 7,
                    height: 26, padding: "0 9px 0 11px", borderRadius: 99, cursor: "pointer",
                    border: `1px solid ${accentLine}`, background: accentSoft,
                    color: "var(--ink-2)", fontSize: 12, fontWeight: 500,
                    transition: "background .12s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "color-mix(in oklab, var(--accent) 22%, transparent)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = accentSoft; }}
                >
                  <span>{t?.label ?? key}</span>
                  <span style={{ color: "var(--accent)", fontSize: 13, lineHeight: 1 }}>×</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
