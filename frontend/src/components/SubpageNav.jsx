import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useBreakpoint } from "../hooks/useBreakpoint.js";

const ArcivMark = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 18h16M7 18 12 6l5 12M9.5 14h5"/>
  </svg>
);

const BackIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 19l-7-7 7-7"/>
  </svg>
);

const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
  </svg>
);

const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

export default function SubpageNav({ onBack }) {
  const { isMobile } = useBreakpoint();
  const [dark, setDark] = useState(() => localStorage.getItem("arciv_dark") === "1");
  const [backHovered, setBackHovered] = useState(false);
  const [themeHovered, setThemeHovered] = useState(false);
  const [username, setUsername] = useState(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.body.classList.toggle("dark", dark);
    localStorage.setItem("arciv_dark", dark ? "1" : "0");
  }, [dark]);

  useEffect(() => {
    api.getMe().then(me => { if (me?.username) setUsername(me.username); }).catch(() => {});
  }, []);

  const initials = username
    ? username.split("_").slice(0, 2).map(w => w[0].toUpperCase()).join("")
    : "AR";

  return (
    <div style={{ position: "sticky", top: isMobile ? 8 : 12, zIndex: 30, padding: isMobile ? "0 10px" : "0 16px" }}>
    <header style={{
      display: "flex", alignItems: "center", gap: isMobile ? 8 : 14,
      padding: isMobile ? "10px 14px" : "10px 16px",
      background: "color-mix(in oklab, var(--nav) 82%, transparent)",
      backdropFilter: "blur(24px) saturate(170%)",
      WebkitBackdropFilter: "blur(24px) saturate(170%)",
      border: "1px solid var(--line)",
      borderRadius: isMobile ? 16 : 18,
      boxShadow: "0 1px 0 rgba(255,255,255,.55) inset, 0 4px 24px rgba(0,0,0,.07)",
    }}>
      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 10,
          background: "radial-gradient(120% 100% at 30% 20%, rgba(255,255,255,.35), transparent 55%), linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 65%, #1a0c4a))",
          display: "grid", placeItems: "center",
          boxShadow: "0 1px 0 rgba(255,255,255,.6) inset, 0 -3px 8px rgba(0,0,0,.18) inset, 0 4px 14px -2px color-mix(in oklab, var(--accent) 60%, transparent), 0 1px 2px rgba(0,0,0,.08)",
        }}>
          <ArcivMark />
        </div>
        {!isMobile && (
          <span style={{ fontWeight: 600, fontSize: 17, letterSpacing: "-0.02em", color: "var(--ink)" }}>
            arciv<em style={{ fontStyle: "normal", color: "var(--accent)" }}>.</em>
          </span>
        )}
      </div>

      {/* Back to dashboard */}
      <button
        onClick={onBack}
        onMouseEnter={() => setBackHovered(true)}
        onMouseLeave={() => setBackHovered(false)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 13.5, fontWeight: 500,
          color: backHovered ? "var(--ink)" : "var(--ink-2)",
          border: "1px solid var(--line)",
          background: backHovered ? "var(--surface-2)" : "var(--surface)",
          padding: isMobile ? "7px 10px" : "7px 12px 7px 10px",
          borderRadius: 9, cursor: "pointer",
          transition: "background .12s, color .12s",
        }}
      >
        <BackIcon />
        {!isMobile && "Back to dashboard"}
      </button>

      <div style={{ flex: 1 }} />

      {/* Dark / light toggle */}
      <button
        onClick={() => setDark(d => !d)}
        title={dark ? "Switch to light mode" : "Switch to dark mode"}
        onMouseEnter={() => setThemeHovered(true)}
        onMouseLeave={() => setThemeHovered(false)}
        style={{
          width: 36, height: 36, display: "grid", placeItems: "center",
          border: 0, borderRadius: 8, cursor: "pointer",
          background: themeHovered ? "rgba(31,28,21,.05)" : "transparent",
          color: "var(--ink-2)", transition: "background .12s",
        }}
      >
        {dark ? <SunIcon /> : <MoonIcon />}
      </button>

      {/* Avatar */}
      <div
        title={username ?? "Account"}
        style={{
          width: 32, height: 32, borderRadius: 99, flexShrink: 0,
          background: "radial-gradient(120% 100% at 30% 25%, rgba(255,255,255,.4), transparent 55%), linear-gradient(135deg, var(--accent), #b58dff)",
          display: "grid", placeItems: "center", color: "#fff",
          fontSize: 11, fontWeight: 600,
          boxShadow: "0 0 0 2px var(--nav), 0 0 0 3px var(--line)",
        }}
      >
        {initials}
      </div>
    </header>
    </div>
  );
}
