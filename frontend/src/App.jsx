import { useCallback, useEffect, useState } from "react";
import { api, getToken, setTokens, clearTokens } from "./api/client.js";
import FeedsView from "./views/FeedsView.jsx";
import LinksView from "./views/LinksView.jsx";
import LoginView from "./views/LoginView.jsx";
import SettingsView from "./views/SettingsView.jsx";
import VerifyEmailView from "./views/VerifyEmailView.jsx";
import ForgotPasswordView from "./views/ForgotPasswordView.jsx";
import ResetPasswordView from "./views/ResetPasswordView.jsx";
import AdminView from "./views/AdminView.jsx";
import LegalView from "./views/LegalView.jsx";
import NotFoundView from "./views/NotFoundView.jsx";

// The URL is the source of truth for which view is showing, so a deep link, a
// bookmark, a reload and the browser Back button all agree on where you are.
// Settings and Feeds used to be plain React state with the URL frozen at "/",
// which meant every in-app navigation was unlinkable and any path outside the
// list below fell through to the root app — rendering the sign-in page whenever
// the token had lapsed, which reads as "every deep link logs me out".
//
// react-router-dom is in package.json but unused; a switch is enough for four
// routes. `navigate` is handed to every view so the shared TopNav can move
// between them without each one re-deriving the router.
const AUTHED_ROUTES = ["/", "/feeds", "/settings", "/admin"];
const PUBLIC_ROUTES = [
  "/terms",
  "/privacy",
  "/verify-email",
  "/reset-password",
  "/forgot-password",
];

// Trailing slashes are cosmetic: /feeds/ is /feeds.
function currentPath() {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

export default function App() {
  const [path, setPath] = useState(currentPath);
  const [token, setToken] = useState(() => getToken());

  const navigate = useCallback((to) => {
    if (currentPath() !== to) window.history.pushState({}, "", to);
    setPath(to);
  }, []);

  // Back/forward move between views instead of leaving the app.
  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Drop token query params and return to the root view.
  function goHome() {
    window.history.replaceState({}, "", "/");
    window.location.reload();
  }

  // An unrecognised path gets a 404 page with the typed URL left intact,
  // whether or not anyone is signed in — bouncing to "/" would dress a broken
  // link up as a working one, and showing the sign-in form would imply the page
  // exists behind auth.
  if (!AUTHED_ROUTES.includes(path) && !PUBLIC_ROUTES.includes(path)) {
    return <NotFoundView onHome={() => navigate("/")} />;
  }

  // Public pages — reachable without auth.
  if (path === "/terms") return <LegalView type="terms" />;
  if (path === "/privacy") return <LegalView type="privacy" />;

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
    navigate("/");
  }

  // Signing in stays on the requested path, so a link to /feeds still opens
  // Feeds once the user is through the login form.
  if (!token) return <LoginView onLogin={handleLogin} />;

  if (path === "/admin") return <AdminView onNavigate={navigate} onLogout={handleLogout} />;
  if (path === "/settings") return <SettingsView onNavigate={navigate} onLogout={handleLogout} />;
  if (path === "/feeds") return <FeedsView onNavigate={navigate} onLogout={handleLogout} />;
  return <LinksView onLogout={handleLogout} onNavigate={navigate} />;
}
