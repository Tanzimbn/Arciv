import { useEffect, useRef, useState } from "react";

const TABS = [
  { key: null,           label: "All",         color: "var(--muted)",   desc: "Everything you've saved" },
  { key: "watch-later", label: "Watch Later",  color: "var(--watch)",   desc: "Videos queued for when you have time" },
  { key: "read-later",  label: "Read Later",   color: "var(--read)",    desc: "Long-reads, articles, and essays" },
  { key: "try-later",   label: "Try Later",    color: "var(--try)",     desc: "Tools and products to explore" },
  { key: "inbox",       label: "Inbox",        color: "var(--inbox)",   desc: "Links AI couldn't classify — sort manually or retry" },
  { key: "archive",     label: "Archive",      color: "var(--archive)", desc: "Links you've marked done — your personal trail" },
];

export default function QueueTabs({ active, onChange, counts = {}, flat = false }) {
  const scrollRef = useRef(null);
  const activeRef = useRef(null);
  const [fades, setFades] = useState({ left: false, right: false });

  function updateFades() {
    const el = scrollRef.current;
    if (!el) return;
    setFades({
      left:  el.scrollLeft > 4,
      right: el.scrollLeft < el.scrollWidth - el.clientWidth - 4,
    });
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateFades();
    el.addEventListener("scroll", updateFades, { passive: true });
    const ro = new ResizeObserver(updateFades);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", updateFades); ro.disconnect(); };
  }, []);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <div style={{ position: "relative" }}>
      {fades.left && (
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: 48, zIndex: 2,
          background: "linear-gradient(to right, var(--surface) 30%, transparent)",
          borderRadius: "12px 0 0 12px", pointerEvents: "none",
        }} />
      )}
      {fades.right && (
        <div style={{
          position: "absolute", right: 0, top: 0, bottom: 0, width: 48, zIndex: 2,
          background: "linear-gradient(to left, var(--surface) 30%, transparent)",
          borderRadius: "0 12px 12px 0", pointerEvents: "none",
        }} />
      )}
      <div ref={scrollRef} style={{
        display: "flex", alignItems: "center", gap: 4, overflowX: "auto",
        scrollbarWidth: "none",
        // `flat` drops the pill: inside the topics filter card these tabs are the
        // card's first row, and a bordered pill within a bordered card reads as
        // two containers for one control.
        background: flat ? "transparent" : "var(--surface)",
        border: flat ? 0 : "1px solid var(--line)",
        borderRadius: flat ? 0 : 12,
        padding: flat ? 0 : 4,
        boxShadow: flat ? "none" : "var(--shadow-card)",
      }}>
        {TABS.map(({ key, label, color }) => {
          const isActive = active === key;
          const count = counts[key ?? "all"] ?? 0;
          return (
            <button
              key={String(key)}
              ref={isActive ? activeRef : null}
              onClick={() => onChange(key)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 8, border: 0, cursor: "pointer",
                fontSize: 13, fontWeight: isActive ? 600 : 500,
                background: isActive ? "var(--btn-dark)" : "transparent",
                color: isActive ? "var(--btn-dark-text)" : "var(--muted)",
                transition: "background .12s, color .12s",
                whiteSpace: "nowrap", flexShrink: 0,
              }}
              onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.color = "var(--ink-2)"; }}}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--muted)"; }}}
            >
              {key !== null && (
                <span style={{ width: 7, height: 7, borderRadius: 99, background: color, flexShrink: 0, opacity: isActive ? 0.85 : 0.7 }} />
              )}
              {label}
              <span style={{
                fontSize: 10.5, fontFamily: "var(--font-mono)", fontWeight: 500,
                padding: "1px 5px", borderRadius: 5,
                // Derived from the pill's own ink, not hardcoded white: the
                // emphasis pill inverts in dark mode (--btn-dark is light
                // there), so a white count on it was white-on-white. The
                // inactive wash follows --ink for the same reason — a dark
                // rgba wash is invisible on a dark surface.
                background: isActive
                  ? "color-mix(in oklab, var(--btn-dark-text) 15%, transparent)"
                  : "color-mix(in oklab, var(--ink) 7%, transparent)",
                color: isActive
                  ? "color-mix(in oklab, var(--btn-dark-text) 80%, transparent)"
                  : "var(--muted)",
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
