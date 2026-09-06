import { useCallback, useLayoutEffect, useRef, useState } from "react";
import NotificationBell from "./NotificationBell.jsx";
import { useBreakpoint } from "../hooks/useBreakpoint.js";

const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
);

const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const LogoutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </svg>
);

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/** Sessions where the CTA was pressed from another route land on the dashboard
 *  wanting the field focused; the flag survives the navigation, a ref cannot. */
export const FOCUS_URL_FLAG = "arciv_focus_url";

function NavLink({ label, active, onClick, touch }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        border: 0, background: "transparent", cursor: "pointer",
        /* A pointer can hit a 12px-tall label; a thumb cannot. On touch the
           padding grows the hit area to ~44px without changing the type. */
        padding: touch ? "13px 14px" : "6px 2px",
        minHeight: touch ? 44 : undefined,
        fontSize: 13.5,
        fontWeight: active ? 600 : 500,
        color: active ? "var(--ink)" : hov ? "var(--ink-2)" : "var(--muted)",
        letterSpacing: "-0.005em", whiteSpace: "nowrap",
        transition: "color .12s",
        position: "relative",
      }}
    >
      {label}
      {/* The active route needs marking — the reference bar can rely on the
          page itself for that, an app cannot. */}
      <span style={{
        position: "absolute", left: touch ? 14 : 2, right: touch ? 14 : 2,
        bottom: touch ? 7 : 1, height: 2, borderRadius: 2,
        background: "var(--accent)", opacity: active ? 1 : 0,
        transition: "opacity .12s",
      }} />
    </button>
  );
}

function IconBtn({ onClick, title, children, touch }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: touch ? 40 : 32, height: touch ? 40 : 32, display: "grid", placeItems: "center",
        border: 0, borderRadius: 9, cursor: "pointer", flexShrink: 0,
        background: hov ? "var(--accent-tint)" : "transparent",
        color: hov ? "var(--accent)" : "var(--ink-2)",
        transition: "background .15s, color .15s",
      }}
    >
      {children}
    </button>
  );
}

/**
 * One nav bar for every route: a centred pill that hugs its content.
 *
 * Replaces two separate headers — the dashboard's (brand + inline URL field +
 * icon cluster) and SubpageNav's (brand + "Back to dashboard" + theme toggle).
 * Having two meant Feeds and Settings could only be reached from the dashboard
 * and only by icon, while the dashboard had no way back to itself; text links
 * for the three routes fix both.
 *
 * `saver` is the paste-a-URL field, supplied by whichever route can actually
 * save (the dashboard). It sits between the route links and the icon cluster,
 * so the primary action is reachable without scrolling back to the top of the
 * page. A route that passes it does not get the "Save link" CTA as well: that
 * button exists only to focus this field, so next to the field it would be two
 * controls for one action. Routes without a saver keep the CTA, which sends
 * them to the dashboard and focuses it there.
 *
 * `onNavigate` is App's router, so these are real path changes: the URL, the
 * back button and a bookmark all agree with what's on screen.
 */
/** Below this the field is too narrow to read a URL in, so it takes its own row. */
const SAVER_MIN = 260;
/** Re-stacking on the exact pixel it unstacked flickers; cross back 24px later. */
const SAVER_HYSTERESIS = 24;

export default function TopNav({ active, onNavigate, onSave, onLogout, dark, onToggleDark, saver }) {
  const { isMobile } = useBreakpoint();
  const rowRef = useRef(null);
  const brandRef = useRef(null);
  const linksRef = useRef(null);
  const iconsRef = useRef(null);
  const ctaRef = useRef(null);
  const [stacked, setStacked] = useState(false);
  const [linksOwnRow, setLinksOwnRow] = useState(false);

  const gap = isMobile ? 8 : 22;

  /* Whether the field fits is a question about the row's own content — the
     brand, three route labels and the icon cluster — not about the viewport, so
     a media query is the wrong instrument: the labels change width with font
     and language, and the icon count changes with `onLogout`. Measure the three
     fixed blocks and stack when what is left cannot hold a readable field. */
  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const brand = brandRef.current?.offsetWidth ?? 0;
    const routes = linksRef.current?.offsetWidth ?? 0;
    const icons = iconsRef.current?.offsetWidth ?? 0;

    /* Mobile does not carry the field at all — the page owns it there — so the
       only question left is the routes, and on a phone they always get their
       own row: brand + three labels + three 40px targets cannot share 355px. */
    if (isMobile) {
      setStacked(false);
      setLinksOwnRow(true);
      return;
    }
    if (saver) {
      const free = row.clientWidth - brand - routes - icons - gap * 3;
      setStacked(prev => (prev ? free < SAVER_MIN + SAVER_HYSTERESIS : free < SAVER_MIN));
      setLinksOwnRow(false);
      return;
    }
    /* The routes without a field have the CTA in that slot instead, and a
       button cannot wrap. So here it is the routes that take the second row —
       which is what a narrow screen did before any of this was measured. */
    const need = brand + routes + icons + (ctaRef.current?.offsetWidth ?? 0) + gap * 3;
    setStacked(false);
    setLinksOwnRow(prev =>
      prev ? need > row.clientWidth - SAVER_HYSTERESIS : need > row.clientWidth,
    );
  }, [gap, saver, isMobile]);

  useLayoutEffect(() => {
    measure();
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [measure]);

  const links = (
    <div
      ref={linksRef}
      style={{
        display: "flex", alignItems: "center", flexShrink: 0,
        /* On its own row the three routes spread across the full width — equal
           thumb-sized targets rather than a cluster floating in the middle. */
        gap: isMobile ? 0 : 20,
        width: isMobile ? "100%" : undefined,
        justifyContent: isMobile ? "space-around" : undefined,
      }}
    >
      <NavLink label="Library" active={active === "library"} onClick={() => onNavigate("/")} touch={isMobile} />
      <NavLink label="Feeds" active={active === "feeds"} onClick={() => onNavigate("/feeds")} touch={isMobile} />
      <NavLink label="Settings" active={active === "settings"} onClick={() => onNavigate("/settings")} touch={isMobile} />
    </div>
  );

  return (
    <div style={{
      /* Flush with the top edge, not floating below it: the bar hangs from the
         viewport rather than sitting on the page, so there is no strip of
         background above it to scroll content through. */
      position: "sticky", top: 0, zIndex: 30,
      padding: isMobile ? "0 10px" : "0 16px",
      display: "flex", justifyContent: "center",
    }}>
      <header style={{
        display: "flex", flexDirection: "column", gap: 8,
        width: isMobile || saver ? "100%" : "fit-content", maxWidth: 1180,
        padding: isMobile ? "8px 10px" : "8px 8px 8px 18px",
        background: "color-mix(in oklab, var(--nav) 86%, transparent)",
        backdropFilter: "blur(24px) saturate(170%)",
        WebkitBackdropFilter: "blur(24px) saturate(170%)",
        /* Only the bottom corners round, and the top border is dropped — both
           edges are off-screen, and rounding them would leave two slivers of
           page showing above the bar. */
        border: "1px solid var(--line)",
        borderTop: 0,
        borderRadius: "0 0 16px 16px",
        boxShadow: "0 4px 24px rgba(0,0,0,.07)",
      }}>
        {/* Brand, routes and icons hold this row at every width; only the
            field ever leaves it. */}
        <div ref={rowRef} style={{ display: "flex", alignItems: "center", gap }}>
          <button
            ref={brandRef}
            onClick={() => onNavigate("/")}
            title="Library"
            style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center" }}
          >
            <span style={{ fontFamily: "var(--font-serif)", fontSize: isMobile ? 19 : 20, fontWeight: 400, letterSpacing: "-0.02em", color: "var(--ink)" }}>
              arciv<em style={{ fontStyle: "normal", color: "var(--accent)" }}>.</em>
            </span>
          </button>

          {!linksOwnRow && links}
          {saver && !stacked && (
            <div style={{ flex: 1, minWidth: SAVER_MIN }}>{saver}</div>
          )}
          {(!saver || stacked) && <div style={{ flex: 1 }} />}

          <div ref={iconsRef} style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
            <NotificationBell />
            <IconBtn onClick={onToggleDark} title={dark ? "Light mode" : "Dark mode"} touch={isMobile}>
              {dark ? <SunIcon /> : <MoonIcon />}
            </IconBtn>
            {onLogout && (
              <IconBtn onClick={onLogout} title="Log out" touch={isMobile}><LogoutIcon /></IconBtn>
            )}
          </div>

          {!saver && <button
            ref={ctaRef}
            onClick={onSave}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, flexShrink: 0,
              height: 36, padding: isMobile ? "0 12px" : "0 15px",
              border: 0, borderRadius: 10, cursor: "pointer",
              background: "var(--btn-dark)", color: "var(--btn-dark-text)",
              fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.005em",
              transition: "background .15s, transform .08s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--btn-dark-hover)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "var(--btn-dark)"; }}
            onMouseDown={e => { e.currentTarget.style.transform = "translateY(1px)"; }}
            onMouseUp={e => { e.currentTarget.style.transform = "translateY(0)"; }}
          >
            <PlusIcon />
            {isMobile ? "Save" : "Save link"}
          </button>}
        </div>

        {/* When the row cannot hold it, the field drops to a full-width row of
            its own rather than shrinking to a slot too narrow to read. */}
        {saver && stacked && <div>{saver}</div>}

        {/* Routes stay one tap away rather than being dropped when they cannot
            share the row with the CTA. */}
        {linksOwnRow && (
          <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>{links}</div>
        )}
      </header>
    </div>
  );
}
