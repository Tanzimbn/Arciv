import { useState } from "react";
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

function NavLink({ label, active, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        border: 0, background: "transparent", cursor: "pointer",
        padding: "6px 2px", fontSize: 13.5,
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
        position: "absolute", left: 2, right: 2, bottom: 1, height: 2, borderRadius: 2,
        background: "var(--accent)", opacity: active ? 1 : 0,
        transition: "opacity .12s",
      }} />
    </button>
  );
}

function IconBtn({ onClick, title, children }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 32, height: 32, display: "grid", placeItems: "center",
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
export default function TopNav({ active, onNavigate, onSave, onLogout, dark, onToggleDark, saver }) {
  const { isMobile } = useBreakpoint();

  const links = (
    <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 16 : 20 }}>
      <NavLink label="Library" active={active === "library"} onClick={() => onNavigate("/")} />
      <NavLink label="Feeds" active={active === "feeds"} onClick={() => onNavigate("/feeds")} />
      <NavLink label="Settings" active={active === "settings"} onClick={() => onNavigate("/settings")} />
    </div>
  );

  return (
    <div style={{
      position: "sticky", top: isMobile ? 8 : 12, zIndex: 30,
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
        border: "1px solid var(--line)",
        borderRadius: 16,
        boxShadow: "0 4px 24px rgba(0,0,0,.07)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 22 }}>
          <button
            onClick={() => onNavigate("/")}
            title="Library"
            style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center" }}
          >
            <span style={{ fontFamily: "var(--font-serif)", fontSize: isMobile ? 19 : 20, fontWeight: 400, letterSpacing: "-0.02em", color: "var(--ink)" }}>
              arciv<em style={{ fontStyle: "normal", color: "var(--accent)" }}>.</em>
            </span>
          </button>

          {!isMobile && links}
          {!isMobile && saver && (
            <div style={{ flex: 1, minWidth: 260 }}>{saver}</div>
          )}
          {(isMobile || !saver) && <div style={{ flex: 1 }} />}

          <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
            <NotificationBell />
            <IconBtn onClick={onToggleDark} title={dark ? "Light mode" : "Dark mode"}>
              {dark ? <SunIcon /> : <MoonIcon />}
            </IconBtn>
            {onLogout && (
              <IconBtn onClick={onLogout} title="Log out"><LogoutIcon /></IconBtn>
            )}
          </div>

          {!saver && <button
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

        {/* Narrow screens give the field its own full-width row — squeezed in
            beside the brand and icons there is no room to read a URL. */}
        {isMobile && saver && <div>{saver}</div>}

        {/* Narrow screens put the routes on their own row rather than dropping
            them, so Feeds and Settings stay one tap away. */}
        {isMobile && (
          <div style={{ display: "flex", justifyContent: "center" }}>{links}</div>
        )}
      </header>
    </div>
  );
}
