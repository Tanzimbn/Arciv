import { useState } from "react";
import LoginView from "./views/LoginView.jsx";
import LinksView from "./views/LinksView.jsx";

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("arciv_token"));

  function handleLogin(t) {
    localStorage.setItem("arciv_token", t);
    setToken(t);
  }

  function handleLogout() {
    localStorage.removeItem("arciv_token");
    setToken(null);
  }

  if (!token) return <LoginView onLogin={handleLogin} />;
  return <LinksView onLogout={handleLogout} />;
}
