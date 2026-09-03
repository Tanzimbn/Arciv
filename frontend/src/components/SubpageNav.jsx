import { useEffect, useState } from "react";
import TopNav, { FOCUS_URL_FLAG } from "./TopNav.jsx";

/**
 * The subpage header is the same bar as the dashboard's.
 *
 * It used to be its own component — brand, a "Back to dashboard" button and a
 * theme toggle — which meant Feeds and Settings could not reach each other, and
 * the two headers drifted apart in styling. `TopNav` carries the routes, so
 * this only supplies the page's identity and the dark-mode state.
 */
export default function SubpageNav({ active, onNavigate, onLogout }) {
  const [dark, setDark] = useState(() => localStorage.getItem("arciv_dark") === "1");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.body.classList.toggle("dark", dark);
    localStorage.setItem("arciv_dark", dark ? "1" : "0");
  }, [dark]);

  return (
    <TopNav
      active={active}
      onNavigate={onNavigate}
      // Saving happens on the dashboard, so the CTA routes there and asks it to
      // focus the field once it mounts.
      onSave={() => { sessionStorage.setItem(FOCUS_URL_FLAG, "1"); onNavigate("/"); }}
      onLogout={onLogout}
      dark={dark}
      onToggleDark={() => setDark(d => !d)}
    />
  );
}
