import { useState } from "react";
import { api, getToken, setTokens, clearTokens } from "./api/client.js";
import FeedsView from "./views/FeedsView.jsx";
import LinksView from "./views/LinksView.jsx";
import LoginView from "./views/LoginView.jsx";
import SettingsView from "./views/SettingsView.jsx";
import VerifyEmailView from "./views/VerifyEmailView.jsx";
import ForgotPasswordView from "./views/ForgotPasswordView.jsx";
import ResetPasswordView from "./views/ResetPasswordView.jsx";

function goHome() {
  // Drop token query params / auth paths and return to the SPA root.
  window.history.replaceState({}, "", "/");
  window.location.reload();
}

export default function App() {
  const path = window.location.pathname;
  const [token, setToken] = useState(() => getToken());
  const [view, setView] = useState("links");

  // Token-driven pages are reachable without auth (opened from email links).
  if (path === "/verify-email") return <VerifyEmailView onDone={goHome} />;
  if (path === "/reset-password") return <ResetPasswordView onDone={goHome} />;
  if (path === "/forgot-password") return <ForgotPasswordView onDone={goHome} />;

  function handleLogin(tokens) {
    setTokens(tokens);
    setToken(tokens.access_token);
  }

  async function handleLogout() {
    await api.logout();
    clearTokens();
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