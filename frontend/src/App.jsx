import { useState } from "react";
import FeedsView from "./views/FeedsView.jsx";
import LinksView from "./views/LinksView.jsx";
import LoginView from "./views/LoginView.jsx";
import SettingsView from "./views/SettingsView.jsx";

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("arciv_token"));
  const [view, setView] = useState("links");

  function handleLogin(t) {
    localStorage.setItem("arciv_token", t);
    setToken(t);
  }

  function handleLogout() {
    localStorage.removeItem("arciv_token");
    setToken(null);
    setView("links");
  }

  if (!token) return <LoginView onLogin={handleLogin} />;
  if (view === "settings") return <SettingsView onBack={() => setView("links")} />;
  if (view === "feeds") return <FeedsView onBack={() => setView("links")} />;
  return (
    <LinksView
      onLogout={handleLogout}
      onSettings={() => setView("settings")}
      onFeeds={() => setView("feeds")}
    />
  );
}
