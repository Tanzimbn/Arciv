import { useEffect, useState } from "react";
import { api, clearTokens } from "../api/client.js";
import SubpageNav from "../components/SubpageNav.jsx";
import { useBreakpoint } from "../hooks/useBreakpoint.js";

const PROVIDERS = [
  { id: "gemini",    label: "Gemini",    icon: "✦", color: "#1a73e8" },
  { id: "groq",      label: "Groq",      icon: "⚡", color: "#f55036" },
  { id: "anthropic", label: "Anthropic", icon: "◈", color: "#cc785c" },
  { id: "openai",    label: "OpenAI",    icon: "⬡", color: "#10a37f" },
  { id: "ollama",    label: "Ollama",    icon: "⬢", color: "#6b6964" },
];

/* ── Icons ────────────────────────────────────────────────── */
const I = {
  user:   () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
  key:    () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6M15.5 7.5l3 3"/></svg>,
  bell:   () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>,
  bot:    () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M12 11V7"/><circle cx="12" cy="5" r="2"/><path d="M8 15h.01M16 15h.01"/></svg>,
  check:  () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 6"/></svg>,
  copy:   () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
  trash:  () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>,
  zap:    () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
};

/* ── Section card ─────────────────────────────────────────── */
function Section({ icon, title, children }) {
  return (
    <section style={{
      background: "var(--surface)", border: "1px solid var(--line)",
      borderRadius: 18, overflow: "hidden", boxShadow: "var(--shadow-card)",
    }}>
      <div style={{
        padding: "14px 20px", borderBottom: "1px solid var(--line-2)",
        background: "var(--surface-2)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ color: "var(--accent)", display: "flex", opacity: 0.85 }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-2)", letterSpacing: "-0.01em" }}>{title}</span>
      </div>
      <div style={{ padding: "18px 20px" }}>{children}</div>
    </section>
  );
}

/* ── Field label ──────────────────────────────────────────── */
function FieldLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
      {children}
    </div>
  );
}

/* ── Provider picker ──────────────────────────────────────── */
function ProviderPicker({ value, onChange, isMobile }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 3 : 5}, 1fr)`, gap: 8 }}>
      {PROVIDERS.map(p => {
        const active = value === p.id;
        return (
          <button key={p.id} type="button" onClick={() => onChange(p.id)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              padding: "12px 8px", borderRadius: 12, cursor: "pointer",
              border: `1.5px solid ${active ? p.color : "var(--line)"}`,
              background: active ? `color-mix(in oklab, ${p.color} 10%, var(--surface))` : "var(--surface-2)",
              transition: "border-color .15s, background .15s",
            }}
            onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor = "var(--muted-2)"; e.currentTarget.style.background = "var(--surface)"; }}}
            onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor = "var(--line)"; e.currentTarget.style.background = "var(--surface-2)"; }}}
          >
            <span style={{ fontSize: 18, lineHeight: 1, color: active ? p.color : "var(--muted)" }}>{p.icon}</span>
            <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, color: active ? p.color : "var(--muted)", letterSpacing: "0.01em" }}>{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Text input ───────────────────────────────────────────── */
function Field({ type = "text", value, onChange, placeholder, focused, onFocus, onBlur }) {
  return (
    <input type={type} value={value} onChange={onChange} placeholder={placeholder}
      onFocus={onFocus} onBlur={onBlur}
      style={{
        width: "100%", border: `1.5px solid ${focused ? "var(--accent)" : "var(--line)"}`,
        borderRadius: 10, padding: "10px 13px", fontSize: 13.5,
        color: "var(--ink)", background: focused ? "var(--surface)" : "var(--surface-2)",
        outline: "none", boxSizing: "border-box", fontFamily: "inherit",
        boxShadow: focused ? "0 0 0 3px var(--accent-tint)" : "none",
        transition: "border-color .15s, box-shadow .15s, background .15s",
      }}
    />
  );
}

/* ── Toggle row ───────────────────────────────────────────── */
function ToggleRow({ checked, onChange, label, description, last }) {
  const [h, setH] = useState(false);
  return (
    <div
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      onClick={onChange}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 16, padding: "14px 0", cursor: "pointer",
        borderBottom: last ? "none" : "1px solid var(--line-2)",
        background: h ? "transparent" : "transparent",
        transition: "opacity .1s",
      }}
    >
      <div>
        <p style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)", margin: 0 }}>{label}</p>
        {description && <p style={{ fontSize: 12, color: "var(--muted)", margin: "3px 0 0", lineHeight: 1.4 }}>{description}</p>}
      </div>
      <div style={{
        width: 44, height: 24, borderRadius: 99, flexShrink: 0,
        background: checked ? "var(--accent)" : "var(--line)",
        position: "relative", transition: "background .2s",
      }}>
        <div style={{
          position: "absolute", top: 3, left: checked ? 22 : 3,
          width: 18, height: 18, borderRadius: 99,
          background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.25)",
          transition: "left .2s",
        }} />
      </div>
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────── */
export default function SettingsView({ onBack }) {
  const { isMobile } = useBreakpoint();
  const [settings, setSettings] = useState(null);
  const [provider, setProvider] = useState("gemini");
  const [apiKey, setApiKey] = useState("");
  const [notifyTelegram, setNotifyTelegram] = useState(false);
  const [notifyInApp, setNotifyInApp] = useState(true);
  const [usernameInput, setUsernameInput] = useState("");
  const [savedUsername, setSavedUsername] = useState("");
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameError, setUsernameError] = useState("");
  const [usernameSuccess, setUsernameSuccess] = useState("");
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [telegramToken, setTelegramToken] = useState("");
  const [generatingToken, setGeneratingToken] = useState(false);
  const [focused, setFocused] = useState(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    api.getSettings().then(s => {
      setSettings(s);
      setProvider(s.ai_provider || "gemini");
      setNotifyTelegram(s.feed_notify_telegram);
      setNotifyInApp(s.feed_notify_inapp);
      setUsernameInput(s.username ?? "");
      setSavedUsername(s.username ?? "");
    });
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setError(""); setSuccess("");
    try {
      const patch = { ai_provider: provider, feed_notify_telegram: notifyTelegram, feed_notify_inapp: notifyInApp };
      if (apiKey) patch.ai_api_key = apiKey;
      const updated = await api.updateSettings(patch);
      setSettings(updated); setApiKey(""); setSuccess("Settings saved.");
    } catch { setError("Failed to save settings."); }
    finally { setSaving(false); }
  }

  async function handleTest() {
    setTesting(true); setTestResult(null);
    try { setTestResult(await api.testAI()); }
    catch { setTestResult({ success: false, message: "Request failed." }); }
    finally { setTesting(false); }
  }

  async function handleClearKey() {
    try { setSettings(await api.updateSettings({ ai_api_key: "" })); }
    catch { setError("Failed to clear key."); }
  }

  async function handleSaveUsername() {
    const val = usernameInput.trim();
    if (!/^[a-z][a-z0-9_]{1,28}[a-z0-9]$/.test(val) || val.includes("__")) {
      setUsernameError("Use 3–30 chars: lowercase letters, numbers, underscores. Must start and end with a letter or number.");
      return;
    }
    setUsernameSaving(true); setUsernameError(""); setUsernameSuccess("");
    try {
      await api.updateSettings({ username: val });
      setSavedUsername(val);
      setUsernameSuccess("Username saved.");
      setTimeout(() => setUsernameSuccess(""), 3000);
    } catch (err) {
      setUsernameError(err?.data?.detail === "Username already taken." ? "Username already taken." : "Failed to save username.");
    } finally { setUsernameSaving(false); }
  }

  async function handleGenerateTelegramToken() {
    setGeneratingToken(true); setError("");
    try {
      const r = await api.generateTelegramToken();
      setTelegramToken(r.token);
      setSuccess("Token generated — send it to the Arciv bot to link your account.");
    } catch { setError("Failed to generate token."); }
    finally { setGeneratingToken(false); }
  }

  function handleCopyToken() {
    navigator.clipboard.writeText(telegramToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleExport() {
    setExporting(true); setError(""); setSuccess("");
    try {
      await api.exportData();
      setSuccess("Export downloaded.");
    } catch { setError("Failed to export your data."); }
    finally { setExporting(false); }
  }

  async function handleDeleteAccount() {
    if (!deletePassword) { setDeleteError("Enter your password to confirm."); return; }
    setDeleting(true); setDeleteError("");
    try {
      await api.deleteAccount(deletePassword);
      // Account and all data are gone — drop the session and return to login.
      clearTokens();
      window.location.href = "/";
    } catch (err) {
      setDeleteError(err?.status === 403 ? "Password is incorrect." : "Failed to delete account.");
      setDeleting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", fontFamily: "Inter, sans-serif" }}>
      <SubpageNav onBack={onBack} />

      {/* Page */}
      <main className="arciv-page-pad" style={{ maxWidth: 720, margin: "0 auto", padding: isMobile ? "20px 16px 80px" : "36px 28px 80px" }}>
        {/* Heading */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontWeight: 400, fontSize: isMobile ? 32 : 44, lineHeight: 1.02, letterSpacing: "-0.01em", margin: 0, color: "var(--ink)" }}>
            Settings
          </h1>
          <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "6px 0 0" }}>
            Configure your AI provider, notifications, and integrations.
          </p>
        </div>

        {settings === null ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[120, 180, 100].map((h, i) => (
              <div key={i} style={{ height: h, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 18, opacity: 0.5 }} />
            ))}
          </div>
        ) : (
          <>
          <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Profile */}
            <Section icon={<I.user />} title="Profile">
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <FieldLabel>Username</FieldLabel>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <Field
                      value={usernameInput}
                      onChange={e => { setUsernameInput(e.target.value.toLowerCase()); setUsernameError(""); setUsernameSuccess(""); }}
                      placeholder="your_username"
                      focused={usernameFocused}
                      onFocus={() => setUsernameFocused(true)}
                      onBlur={() => setUsernameFocused(false)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveUsername}
                    disabled={usernameSaving || usernameInput.trim() === savedUsername}
                    style={{
                      padding: "0 18px", border: 0, borderRadius: 10, fontSize: 13, fontWeight: 600,
                      cursor: (usernameSaving || usernameInput.trim() === savedUsername) ? "default" : "pointer",
                      background: (usernameSaving || usernameInput.trim() === savedUsername) ? "var(--surface-2)" : "var(--btn-dark)",
                      color: (usernameSaving || usernameInput.trim() === savedUsername) ? "var(--muted)" : "var(--btn-dark-text)",
                      transition: "background .15s, color .15s", whiteSpace: "nowrap", flexShrink: 0,
                    }}
                  >
                    {usernameSaving ? "Saving…" : "Save"}
                  </button>
                </div>
                <div style={{ fontSize: 12, color: usernameError ? "var(--bad)" : usernameSuccess ? "var(--good)" : "var(--muted)", lineHeight: 1.5 }}>
                  {usernameError || usernameSuccess || `${savedUsername || "—"} · a–z 0–9 _ · 3–30 chars`}
                </div>
              </div>
            </Section>

            {/* AI Classification */}
            <Section icon={<I.zap />} title="AI Classification">
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <FieldLabel>Provider</FieldLabel>
                  <ProviderPicker value={provider} isMobile={isMobile} onChange={p => { setProvider(p); setTestResult(null); }} />
                </div>

                <div>
                  <FieldLabel>API Key</FieldLabel>
                  {settings.ai_api_key_masked && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 13px", marginBottom: 8,
                      background: "var(--surface-2)", borderRadius: 10, border: "1.5px solid var(--line-2)",
                    }}>
                      <I.key />
                      <span style={{ fontSize: 12.5, color: "var(--muted)", fontFamily: "monospace", flex: 1, letterSpacing: "0.05em" }}>{settings.ai_api_key_masked}</span>
                      <button type="button" onClick={handleClearKey}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--bad)", background: "var(--bad-tint)", border: "1px solid color-mix(in oklab, var(--bad) 25%, transparent)", borderRadius: 6, padding: "3px 9px", cursor: "pointer", fontWeight: 600 }}>
                        <I.trash /> Clear
                      </button>
                    </div>
                  )}
                  <Field
                    type="password" value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder={settings.ai_api_key_masked ? "Enter new key to replace current" : "Paste your API key here"}
                    focused={focused === "apikey"}
                    onFocus={() => setFocused("apikey")} onBlur={() => setFocused(null)}
                  />
                </div>

                {/* Test row */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 2 }}>
                  <button type="button" onClick={handleTest} disabled={testing}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "8px 14px", fontSize: 13, fontWeight: 600,
                      border: "1.5px solid var(--line)", borderRadius: 10,
                      background: "var(--surface-2)", color: "var(--ink-2)",
                      cursor: testing ? "default" : "pointer", transition: "background .12s, border-color .12s",
                    }}
                    onMouseEnter={e => { if (!testing) { e.currentTarget.style.background = "var(--accent-tint)"; e.currentTarget.style.borderColor = "var(--accent)"; }}}
                    onMouseLeave={e => { if (!testing) { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.borderColor = "var(--line)"; }}}
                  >
                    {testing
                      ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin .8s linear infinite" }}><circle cx="12" cy="12" r="9" strokeOpacity=".3"/><path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round"/></svg> Testing…</>
                      : <><I.zap /> Test connection</>}
                  </button>
                  {testResult && (
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "7px 12px", borderRadius: 9, fontSize: 12.5, fontWeight: 600,
                      background: testResult.success ? "var(--good-tint)" : "var(--bad-tint)",
                      color: testResult.success ? "var(--good)" : "var(--bad)",
                      border: `1px solid color-mix(in oklab, ${testResult.success ? "var(--good)" : "var(--bad)"} 25%, transparent)`,
                    }}>
                      <I.check />
                      {testResult.message}
                    </div>
                  )}
                </div>
              </div>
            </Section>

            {/* Notifications */}
            <Section icon={<I.bell />} title="Notifications">
              <div>
                <ToggleRow
                  checked={notifyInApp}
                  onChange={() => setNotifyInApp(v => !v)}
                  label="In-app notifications"
                  description="Show alerts in the notification bell while you're using Arciv"
                  last={!settings.telegram_enabled}
                />
                {settings.telegram_enabled && (
                  <ToggleRow
                    checked={notifyTelegram}
                    onChange={() => setNotifyTelegram(v => !v)}
                    label="Telegram notifications"
                    description="Receive feed digests and alerts via your linked Telegram account"
                    last
                  />
                )}
              </div>
            </Section>

            {/* Telegram */}
            {settings.telegram_enabled && (
              <Section icon={<I.bot />} title="Telegram Bot">
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6, margin: 0 }}>
                    Link your Telegram account to receive daily digests and save links by forwarding them to the bot.
                  </p>

                  {/* Steps */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      "Generate a token below",
                      <>Send <code style={{ background: "var(--surface-2)", padding: "1px 7px", borderRadius: 5, fontFamily: "monospace", fontSize: 12, border: "1px solid var(--line)" }}>/start &lt;token&gt;</code> to @arciv_bot</>,
                      "Your account will be linked automatically",
                    ].map((step, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ width: 22, height: 22, borderRadius: 99, background: "var(--accent-tint)", color: "var(--accent)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>
                          {i + 1}
                        </div>
                        <span style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>{step}</span>
                      </div>
                    ))}
                  </div>

                  <button type="button" onClick={handleGenerateTelegramToken} disabled={generatingToken}
                    style={{
                      alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 7,
                      padding: "9px 18px", border: 0, borderRadius: 10, cursor: generatingToken ? "default" : "pointer",
                      font: "inherit", fontWeight: 600, fontSize: 13.5,
                      background: generatingToken ? "var(--accent-tint-2)" : "var(--accent)",
                      color: generatingToken ? "var(--accent)" : "var(--accent-ink)",
                      boxShadow: generatingToken ? "none" : "0 2px 10px rgba(109,58,255,.25)",
                      transition: "background .15s",
                    }}
                    onMouseEnter={e => { if (!generatingToken) e.currentTarget.style.background = "var(--accent-deep)"; }}
                    onMouseLeave={e => { if (!generatingToken) e.currentTarget.style.background = "var(--accent)"; }}
                  >
                    <I.bot />
                    {generatingToken ? "Generating…" : "Generate linking token"}
                  </button>

                  {telegramToken && (
                    <div style={{ background: "var(--accent-tint)", border: "1.5px solid color-mix(in oklab, var(--accent) 25%, transparent)", borderRadius: 12, padding: 16 }}>
                      <p style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 10px" }}>
                        Your linking token
                      </p>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code style={{
                          flex: 1, background: "var(--surface)", border: "1.5px solid color-mix(in oklab, var(--accent) 20%, transparent)",
                          borderRadius: 9, padding: "10px 12px", fontSize: 12.5, fontFamily: "monospace",
                          wordBreak: "break-all", color: "var(--ink)", letterSpacing: "0.04em",
                        }}>
                          {telegramToken}
                        </code>
                        <button type="button" onClick={handleCopyToken}
                          style={{
                            display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3,
                            padding: "10px 14px", fontSize: 11.5, fontWeight: 600,
                            color: copied ? "var(--good)" : "var(--accent)",
                            background: copied ? "var(--good-tint)" : "var(--surface)",
                            border: `1.5px solid ${copied ? "color-mix(in oklab, var(--good) 25%, transparent)" : "color-mix(in oklab, var(--accent) 25%, transparent)"}`,
                            borderRadius: 9, cursor: "pointer", flexShrink: 0, transition: "all .2s",
                          }}>
                          {copied ? <I.check /> : <I.copy />}
                          {copied ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* Feedback banners */}
            {error && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bad-tint)", border: "1.5px solid color-mix(in oklab, var(--bad) 25%, transparent)", borderRadius: 12, padding: "12px 16px" }}>
                <span style={{ fontSize: 14 }}>✕</span>
                <p style={{ fontSize: 13, color: "var(--bad)", fontWeight: 600, margin: 0 }}>{error}</p>
              </div>
            )}
            {success && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--good-tint)", border: "1.5px solid color-mix(in oklab, var(--good) 25%, transparent)", borderRadius: 12, padding: "12px 16px" }}>
                <I.check />
                <p style={{ fontSize: 13, color: "var(--good)", fontWeight: 600, margin: 0 }}>{success}</p>
              </div>
            )}

            {/* Save */}
            <button type="submit" disabled={saving}
              style={{
                width: "100%", border: 0, borderRadius: 12, padding: "13px 0",
                fontSize: 14, fontWeight: 700, cursor: saving ? "default" : "pointer",
                background: saving ? "var(--accent-tint-2)" : "var(--accent)",
                color: saving ? "var(--accent)" : "var(--accent-ink)",
                boxShadow: saving ? "none" : "0 4px 18px rgba(109,58,255,.28)",
                transition: "background .15s, box-shadow .15s",
              }}
              onMouseEnter={e => { if (!saving) e.currentTarget.style.background = "var(--accent-deep)"; }}
              onMouseLeave={e => { if (!saving) e.currentTarget.style.background = "var(--accent)"; }}
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
          </form>

          {/* Danger Zone — outside the form so its buttons never submit it */}
          <section style={{
            marginTop: 22, background: "var(--surface)",
            border: "1.5px solid color-mix(in oklab, var(--bad) 30%, var(--line))",
            borderRadius: 18, overflow: "hidden", boxShadow: "var(--shadow-card)",
          }}>
            <div style={{
              padding: "14px 20px", borderBottom: "1px solid var(--line-2)",
              background: "var(--bad-tint)",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ color: "var(--bad)", display: "flex" }}><I.trash /></span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--bad)", letterSpacing: "-0.01em" }}>Danger Zone</span>
            </div>
            <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Export */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", margin: 0 }}>Export my data</p>
                  <p style={{ fontSize: 12, color: "var(--muted)", margin: "3px 0 0", lineHeight: 1.4 }}>Download all your links, feeds, and notifications as a JSON file.</p>
                </div>
                <button type="button" onClick={handleExport} disabled={exporting}
                  style={{
                    padding: "9px 16px", border: "1.5px solid var(--line)", borderRadius: 10,
                    fontSize: 13, fontWeight: 600, cursor: exporting ? "default" : "pointer",
                    background: "var(--surface-2)", color: "var(--ink-2)", whiteSpace: "nowrap", flexShrink: 0,
                  }}>
                  {exporting ? "Exporting…" : "Export data"}
                </button>
              </div>

              <div style={{ height: 1, background: "var(--line-2)" }} />

              {/* Delete */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", margin: 0 }}>Delete account</p>
                  <p style={{ fontSize: 12, color: "var(--muted)", margin: "3px 0 0", lineHeight: 1.4 }}>Permanently remove your account and all associated data. This cannot be undone.</p>
                </div>
                <button type="button" onClick={() => { setDeleteOpen(true); setDeletePassword(""); setDeleteError(""); }}
                  style={{
                    padding: "9px 16px", border: 0, borderRadius: 10,
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                    background: "var(--bad)", color: "#fff", whiteSpace: "nowrap", flexShrink: 0,
                  }}>
                  Delete account
                </button>
              </div>
            </div>
          </section>
          </>
        )}
      </main>

      {/* Delete confirmation modal */}
      {deleteOpen && (
        <div
          onClick={() => !deleting && setDeleteOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center", padding: 20,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: "100%", maxWidth: 420, background: "var(--surface)",
            border: "1px solid var(--line)", borderRadius: 16, padding: 24,
            boxShadow: "0 20px 60px rgba(0,0,0,.3)",
          }}>
            <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontWeight: 400, fontSize: 26, margin: "0 0 8px", color: "var(--ink)" }}>
              Delete your account?
            </h2>
            <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55, margin: "0 0 18px" }}>
              This permanently deletes your account and every link, feed, and notification. This action cannot be undone. Enter your password to confirm.
            </p>
            <input
              type="password"
              value={deletePassword}
              onChange={e => { setDeletePassword(e.target.value); setDeleteError(""); }}
              placeholder="Your password"
              autoFocus
              onKeyDown={e => { if (e.key === "Enter") handleDeleteAccount(); }}
              style={{
                width: "100%", border: `1.5px solid ${deleteError ? "var(--bad)" : "var(--line)"}`,
                borderRadius: 10, padding: "10px 13px", fontSize: 13.5,
                color: "var(--ink)", background: "var(--surface-2)", outline: "none",
                boxSizing: "border-box", fontFamily: "inherit",
              }}
            />
            {deleteError && <p style={{ fontSize: 12.5, color: "var(--bad)", fontWeight: 600, margin: "8px 0 0" }}>{deleteError}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setDeleteOpen(false)} disabled={deleting}
                style={{
                  padding: "9px 16px", border: "1.5px solid var(--line)", borderRadius: 10,
                  fontSize: 13, fontWeight: 600, cursor: deleting ? "default" : "pointer",
                  background: "var(--surface-2)", color: "var(--ink-2)",
                }}>
                Cancel
              </button>
              <button type="button" onClick={handleDeleteAccount} disabled={deleting}
                style={{
                  padding: "9px 16px", border: 0, borderRadius: 10,
                  fontSize: 13, fontWeight: 600, cursor: deleting ? "default" : "pointer",
                  background: "var(--bad)", color: "#fff",
                }}>
                {deleting ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

