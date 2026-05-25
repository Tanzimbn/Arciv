import { useState } from "react";
import { api } from "../api/client.js";
import { useBreakpoint } from "../hooks/useBreakpoint.js";

// ── Icons ──────────────────────────────────────────────────────
const MailIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>
  </svg>
);
const LockIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>
  </svg>
);
const EyeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/>
  </svg>
);
const EyeOffIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3l18 18"/><path d="M10.6 6.2A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.6"/><path d="M6.1 6.1A17 17 0 0 0 2 12s3.5 6 10 6a10 10 0 0 0 4-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>
  </svg>
);
const ArrowIcon = ({ style }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="M5 12h14M13 6l6 6-6 6"/>
  </svg>
);
const ArcivLogo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 18h16M7 18 12 6l5 12M9.5 14h5"/>
  </svg>
);
const GoogleG = () => (
  <svg width="16" height="16" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.99.66-2.25 1.05-3.72 1.05-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"/>
    <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.48 12c0-.73.13-1.44.36-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.94l3.66-2.84Z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"/>
  </svg>
);
const AppleLogo = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.05 12.04c.03 3.25 2.85 4.33 2.88 4.34-.02.07-.45 1.54-1.49 3.06-.9 1.32-1.83 2.63-3.3 2.66-1.44.03-1.9-.85-3.55-.85-1.65 0-2.16.83-3.52.88-1.42.05-2.5-1.43-3.4-2.74C2.83 16.73 1.4 11.7 3.3 8.32A5.2 5.2 0 0 1 7.66 5.6c1.39-.03 2.7.94 3.55.94.85 0 2.44-1.16 4.12-.99.7.03 2.67.28 3.93 2.13-.1.06-2.35 1.37-2.21 4.36ZM14.85 3.95c.75-.91 1.26-2.18 1.12-3.43-1.08.04-2.4.72-3.18 1.62-.7.8-1.31 2.08-1.14 3.31 1.21.09 2.45-.61 3.2-1.5Z"/>
  </svg>
);

// ── Password strength ──────────────────────────────────────────
function strengthOf(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 4);
}
const STRENGTH_LABELS = ["—", "Weak", "Okay", "Good", "Strong"];
const STRENGTH_COLORS = [null, "#d04a2a", "#e08800", "var(--try)", "var(--try)"];

function StrengthMeter({ password }) {
  const s = strengthOf(password);
  const color = STRENGTH_COLORS[s];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {[1, 2, 3, 4].map(i => (
          <span key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: s >= i ? color : "var(--line)",
            transition: "background .25s",
          }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "monospace", fontSize: 10.5, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        <span>Password strength</span>
        <b style={{ fontWeight: 500, color: s > 0 ? color : "var(--ink-2)" }}>{STRENGTH_LABELS[s]}</b>
      </div>
    </div>
  );
}

// ── Field with rotating-light border ──────────────────────────
function Field({ label, link, type = "text", icon, value, onChange, placeholder, autoComplete, toggleable, required }) {
  const [show, setShow] = useState(false);
  const inputType = toggleable ? (show ? "text" : "password") : type;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-2)", letterSpacing: "-0.005em" }}>{label}</label>
        {link && <a href="#" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}
          onMouseEnter={e => { e.currentTarget.style.textDecoration = "underline"; e.currentTarget.style.color = "var(--accent-deep)"; }}
          onMouseLeave={e => { e.currentTarget.style.textDecoration = "none"; e.currentTarget.style.color = "var(--accent)"; }}
        >{link}</a>}
      </div>
      <div className="arciv-lit-wrap">
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          height: 46, padding: "0 14px", borderRadius: 11,
          background: "var(--surface)",
          boxShadow: "0 1px 0 rgba(255,255,255,.6) inset, 0 1px 2px rgba(22,21,19,.04)",
        }}>
          <span style={{ color: "var(--muted-2)", flexShrink: 0, display: "flex" }}>{icon}</span>
          <input
            type={inputType}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            autoComplete={autoComplete}
            required={required}
            style={{
              flex: 1, border: 0, outline: 0, background: "transparent",
              fontFamily: "inherit", fontSize: 14.5, color: "var(--ink)",
              padding: 0, letterSpacing: "-0.005em",
            }}
          />
          {toggleable && (
            <button
              type="button"
              onClick={() => setShow(s => !s)}
              title={show ? "Hide password" : "Show password"}
              style={{
                border: 0, background: "transparent", cursor: "pointer",
                color: "var(--muted)", width: 26, height: 26,
                display: "grid", placeItems: "center", borderRadius: 6,
                transition: "background .15s, color .15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.color = "var(--ink-2)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--muted)"; }}
            >
              {show ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Left brand pane ────────────────────────────────────────────
function BrandPane() {
  return (
    <aside style={{
      position: "relative", overflow: "hidden",
      padding: "36px 44px",
      background: "radial-gradient(60% 50% at 18% 22%, color-mix(in oklab, var(--accent) 14%, transparent), transparent 60%), radial-gradient(70% 60% at 95% 90%, color-mix(in oklab, #ff6b3d 12%, transparent), transparent 65%), linear-gradient(180deg, var(--nav), var(--bg))",
      display: "flex", flexDirection: "column", justifyContent: "space-between",
      borderRight: "1px solid var(--line)",
    }}>
      {/* Dotted grid overlay */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: "linear-gradient(transparent 95.8%, rgba(31,28,21,.04) 95.8%), linear-gradient(90deg, transparent 95.8%, rgba(31,28,21,.04) 95.8%)",
        backgroundSize: "24px 24px",
        WebkitMaskImage: "radial-gradient(120% 80% at 50% 40%, #000 0%, transparent 75%)",
        maskImage: "radial-gradient(120% 80% at 50% 40%, #000 0%, transparent 75%)",
        opacity: 0.7,
      }} />

      {/* Brand */}
      <div style={{ position: "relative", zIndex: 1, display: "inline-flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 11,
          background: "radial-gradient(120% 100% at 30% 20%, rgba(255,255,255,.4), transparent 55%), linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 65%, #1a0c4a))",
          display: "grid", placeItems: "center",
          boxShadow: "0 1px 0 rgba(255,255,255,.6) inset, 0 -3px 8px rgba(0,0,0,.2) inset, 0 6px 18px -3px color-mix(in oklab, var(--accent) 60%, transparent), 0 1px 2px rgba(0,0,0,.08)",
        }}>
          <ArcivLogo />
        </div>
        <span style={{ fontWeight: 600, fontSize: 19, letterSpacing: "-0.025em", color: "var(--ink)" }}>
          arciv<em style={{ fontStyle: "normal", color: "var(--accent)" }}>.</em>
        </span>
      </div>

      {/* Hero */}
      <div style={{ position: "relative", zIndex: 1, maxWidth: 520, marginTop: "8vh" }}>
        <h1 style={{
          fontFamily: "'Instrument Serif', serif", fontWeight: 400,
          fontSize: "clamp(40px, 5.4vw, 64px)", lineHeight: 1.02,
          letterSpacing: "-0.015em", margin: 0, color: "var(--ink)",
        }}>
          Save the link.{" "}
          <em style={{ fontStyle: "italic", color: "var(--accent)" }}>Forget</em>
          {" "}the<br />
          <span style={{ color: "var(--muted-2)", textDecoration: "line-through", textDecorationThickness: "1.5px", textDecorationColor: "color-mix(in oklab, var(--accent) 50%, transparent)" }}>bookmark</span>{" "}
          mess.
        </h1>
        <p style={{ margin: "22px 0 0", fontSize: 15, lineHeight: 1.55, color: "var(--ink-2)", maxWidth: 440 }}>
          Arciv quietly classifies every URL you paste — videos to watch, essays to read, tools to try.
          One paste, one home, one tidy archive of the internet you actually meant to revisit.
        </p>
      </div>

      {/* Floating preview cards */}
      <div style={{ position: "relative", zIndex: 1, marginTop: 42, height: 260, width: "100%", maxWidth: 520 }}>
        {/* Card 1 — Watch Later */}
        <div style={{
          position: "absolute", top: 0, left: 0,
          transform: "rotate(-3deg)", width: 280,
          background: "var(--surface)", border: "1px solid var(--line)",
          borderRadius: 14, padding: "13px 14px 12px",
          boxShadow: "0 1px 0 rgba(22,21,19,.04), 0 1px 2px rgba(22,21,19,.04), 0 14px 40px -16px rgba(22,21,19,.25)",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "monospace", fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--watch)", flexShrink: 0, boxShadow: "0 0 0 3px color-mix(in oklab, var(--watch) 18%, transparent)" }} />
            Watch later · youtube.com
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 500, letterSpacing: "-0.01em", lineHeight: 1.35 }}>
            How Figma got to 4 million users — Dylan Field at YC
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", gap: 8, alignItems: "center" }}>
            <span>32 min</span>
            <span style={{ width: 2, height: 2, borderRadius: "50%", background: "var(--muted-2)" }} />
            <span>saved 4m ago</span>
          </div>
        </div>

        {/* Card 2 — Classified (accent tint) */}
        <div style={{
          position: "absolute", top: 30, left: 200,
          transform: "rotate(2.5deg)", width: 280, zIndex: 2,
          background: "linear-gradient(180deg, var(--accent-tint), var(--surface))",
          border: "1px solid color-mix(in oklab, var(--accent) 20%, var(--line))",
          borderRadius: 14, padding: "13px 14px 12px",
          boxShadow: "0 1px 0 rgba(22,21,19,.04), 0 1px 2px rgba(22,21,19,.04), 0 14px 40px -16px rgba(22,21,19,.25)",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "monospace", fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", flexShrink: 0, boxShadow: "0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent)" }} />
            Classified · stripe.com/blog
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 500, letterSpacing: "-0.01em", lineHeight: 1.35 }}>
            The Stripe Press 2024 reading list — long-form picks
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", gap: 8, alignItems: "center" }}>
            <span>Read later</span>
            <span style={{ width: 2, height: 2, borderRadius: "50%", background: "var(--muted-2)" }} />
            <span>just now</span>
          </div>
        </div>

        {/* Card 3 — Try Later */}
        <div style={{
          position: "absolute", top: 130, left: 60,
          transform: "rotate(-1.5deg)", width: 280, zIndex: 1,
          background: "var(--surface)", border: "1px solid var(--line)",
          borderRadius: 14, padding: "13px 14px 12px",
          boxShadow: "0 1px 0 rgba(22,21,19,.04), 0 1px 2px rgba(22,21,19,.04), 0 14px 40px -16px rgba(22,21,19,.25)",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "monospace", fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--try)", flexShrink: 0, boxShadow: "0 0 0 3px color-mix(in oklab, var(--try) 18%, transparent)" }} />
            Try later · linear.app
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 500, letterSpacing: "-0.01em", lineHeight: 1.35 }}>
            Linear for Roadmaps — free during private beta
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", gap: 8, alignItems: "center" }}>
            <span>Tool</span>
            <span style={{ width: 2, height: 2, borderRadius: "50%", background: "var(--muted-2)" }} />
            <span>2d ago</span>
          </div>
        </div>
      </div>

      {/* Footer pip */}
      <div style={{
        position: "relative", zIndex: 1,
        display: "flex", alignItems: "center", gap: 10,
        color: "var(--muted)", fontSize: 12, fontFamily: "monospace",
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--try)", boxShadow: "0 0 0 3px color-mix(in oklab, var(--try) 18%, transparent)" }} />
        12,481 links saved this week
      </div>
    </aside>
  );
}

// ── Main component ─────────────────────────────────────────────
export default function LoginView({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [arrowHovered, setArrowHovered] = useState(false);
  const { width } = useBreakpoint();

  const isSignup = mode === "register";
  const isNarrow = width < 960;
  const canSubmit = email.trim().includes("@") && password.length >= (isSignup ? 8 : 1);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = isSignup
        ? await api.register(email, password)
        : await api.login(email, password);
      onLogin(data.access_token);
    } catch (err) {
      setError(err.data?.detail || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function switchMode() {
    setMode(isSignup ? "login" : "register");
    setError("");
    setPassword("");
  }

  return (
    <div style={{
      minHeight: "100vh", display: "grid",
      gridTemplateColumns: isNarrow ? "1fr" : "1.05fr 1fr",
      background: "var(--bg)",
    }}>
      {/* Left brand pane — hidden on narrow */}
      {!isNarrow && <BrandPane />}

      {/* Right form pane */}
      <main style={{
        padding: isNarrow ? "28px 24px" : "36px 44px",
        display: "flex", flexDirection: "column",
        background: "var(--bg)",
      }}>
        {/* Top-right mode toggle */}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            {isSignup ? "Already have an account?" : "New to Arciv?"}
          </span>
          <button
            onClick={switchMode}
            style={{
              fontFamily: "inherit", fontSize: 13, fontWeight: 500,
              background: "var(--surface)", border: "1px solid var(--line)",
              padding: "7px 13px", borderRadius: 9, cursor: "pointer",
              color: "var(--ink)",
              transition: "background .15s, border-color .15s, transform .08s",
              boxShadow: "0 1px 0 rgba(22,21,19,.04), 0 1px 2px rgba(22,21,19,.04)",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.borderColor = "rgba(31,28,21,.18)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "var(--surface)"; e.currentTarget.style.borderColor = "var(--line)"; }}
            onMouseDown={e => { e.currentTarget.style.transform = "translateY(1px)"; }}
            onMouseUp={e => { e.currentTarget.style.transform = "translateY(0)"; }}
          >
            {isSignup ? "Sign in" : "Create account"}
          </button>
        </div>

        {/* Centered form */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 0" }}>
          <form
            key={mode}
            onSubmit={handleSubmit}
            style={{
              width: "100%", maxWidth: 380,
              display: "flex", flexDirection: "column", gap: 22,
              animation: "arciv-auth-fadein .35s ease both",
            }}
          >
            <style>{`@keyframes arciv-auth-fadein { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }`}</style>

            {/* Heading */}
            <div>
              <h2 style={{
                fontFamily: "'Instrument Serif', serif", fontWeight: 400,
                fontSize: 38, lineHeight: 1.05, letterSpacing: "-0.015em",
                margin: 0, color: "var(--ink)",
              }}>
                {isSignup ? "Create your archive" : "Welcome back"}
              </h2>
              <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--muted)", lineHeight: 1.5 }}>
                {isSignup
                  ? "Start saving links in seconds. No credit card, no clutter."
                  : "Pick up where you left off — your inbox is waiting."}
              </p>
            </div>

            {/* OAuth — blurred / coming soon */}
            <div style={{ position: "relative" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, opacity: 0.38, filter: "blur(0.4px)", pointerEvents: "none", userSelect: "none" }}>
                {[
                  { icon: <GoogleG />, label: "Google" },
                  { icon: <AppleLogo />, label: "Apple" },
                ].map(({ icon, label }) => (
                  <div key={label} style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                    height: 42, borderRadius: 11,
                    background: "var(--surface)", border: "1px solid var(--line)",
                    fontSize: 13.5, fontWeight: 500, color: "var(--ink)",
                    boxShadow: "0 1px 0 rgba(22,21,19,.04), 0 1px 2px rgba(22,21,19,.04)",
                  }}>
                    {icon} {label}
                  </div>
                ))}
              </div>
              <div style={{
                position: "absolute", inset: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, fontFamily: "monospace",
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  background: "var(--surface-2)", border: "1px solid var(--line)",
                  color: "var(--muted)", padding: "4px 10px", borderRadius: 99,
                  boxShadow: "0 1px 2px rgba(22,21,19,.06)",
                }}>
                  Coming soon
                </span>
              </div>
            </div>

            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: "monospace", fontSize: 10.5, letterSpacing: "0.14em", color: "var(--muted-2)", textTransform: "uppercase" }}>
              <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
              or with email
              <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
            </div>

            {/* Email */}
            <Field
              label="Email address"
              icon={<MailIcon />}
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />

            {/* Password */}
            <Field
              label="Password"
              link={!isSignup ? "Forgot?" : null}
              icon={<LockIcon />}
              value={password}
              onChange={setPassword}
              placeholder={isSignup ? "At least 8 characters" : "••••••••"}
              autoComplete={isSignup ? "new-password" : "current-password"}
              toggleable
              required
            />

            {/* Strength meter (signup only) */}
            {isSignup && <StrengthMeter password={password} />}

            {/* Error */}
            {error && (
              <div style={{ background: "var(--read-tint)", border: "1px solid color-mix(in oklab, var(--read) 30%, transparent)", borderRadius: 10, padding: "9px 13px" }}>
                <p style={{ fontSize: 12.5, color: "var(--read)", margin: 0 }}>{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={!canSubmit || loading}
              onMouseEnter={() => setArrowHovered(true)}
              onMouseLeave={() => setArrowHovered(false)}
              onMouseDown={e => { e.currentTarget.style.transform = "translateY(1px)"; }}
              onMouseUp={e => { e.currentTarget.style.transform = "translateY(0)"; }}
              style={{
                height: 48, border: 0, borderRadius: 12, cursor: canSubmit && !loading ? "pointer" : "default",
                fontFamily: "inherit", fontWeight: 500, fontSize: 14.5, letterSpacing: "-0.005em",
                background: !canSubmit || loading ? "var(--muted-2)" : "var(--btn-dark)",
                color: "var(--btn-dark-text)",
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                transition: "transform .08s, background .15s, box-shadow .15s",
                boxShadow: canSubmit && !loading
                  ? "0 1px 0 rgba(255,255,255,.08) inset, 0 4px 14px -3px rgba(22,21,19,.3), 0 1px 2px rgba(22,21,19,.1)"
                  : "none",
              }}
              onMouseEnterCapture={e => { if (canSubmit && !loading) e.currentTarget.style.background = "var(--btn-dark-hover)"; }}
              onMouseLeaveCapture={e => { if (canSubmit && !loading) e.currentTarget.style.background = "var(--btn-dark)"; }}
            >
              {loading ? "…" : isSignup ? "Create account" : "Sign in"}
              {!loading && <ArrowIcon style={{ transition: "transform .2s", transform: arrowHovered ? "translateX(2px)" : "translateX(0)" }} />}
            </button>

            {/* Terms (signup only) */}
            {isSignup && (
              <p style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5, textAlign: "center", maxWidth: 340, margin: "0 auto" }}>
                By creating an account you agree to our{" "}
                <a href="#" style={{ color: "var(--ink-2)", textDecoration: "underline", textUnderlineOffset: 2, textDecorationColor: "var(--line)" }}>Terms</a>
                {" "}and{" "}
                <a href="#" style={{ color: "var(--ink-2)", textDecoration: "underline", textUnderlineOffset: 2, textDecorationColor: "var(--line)" }}>Privacy Policy</a>.
                {" "}We'll never sell your data.
              </p>
            )}
          </form>
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          paddingTop: 18, fontSize: 12, color: "var(--muted)",
          fontFamily: "monospace", letterSpacing: "0.04em",
        }}>
          <span>arciv © 2026</span>
          <div style={{ display: "flex", gap: 14 }}>
            {["Help", "Privacy", "Terms"].map(l => (
              <a key={l} href="#" style={{ color: "var(--muted)", textDecoration: "none" }}
                onMouseEnter={e => { e.currentTarget.style.color = "var(--ink-2)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "var(--muted)"; }}
              >{l}</a>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
