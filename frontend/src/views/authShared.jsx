import "./auth.css";

// Password rules — must mirror api/utils/security.validate_password_strength.
export const PASSWORD_RULES = [
  { key: "len", label: "8+ characters", test: (p) => p.length >= 8 },
  { key: "upper", label: "Uppercase", test: (p) => /[A-Z]/.test(p) },
  { key: "lower", label: "Lowercase", test: (p) => /[a-z]/.test(p) },
  { key: "num", label: "A number", test: (p) => /[0-9]/.test(p) },
];
export const STRENGTH_LABEL = ["—", "Weak", "Okay", "Good", "Strong"];

export const MailIcon = (p) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 7 8.5 6 8.5-6" />
  </svg>
);
export const LockIcon = (p) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </svg>
);
export const KeyIcon = (p) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="8" cy="15" r="4" /><path d="m10.8 12.2 8-8M16.5 6.5l2.5 2.5M14 9l2.5 2.5" />
  </svg>
);
export const EyeIcon = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="2.8" />
  </svg>
);
export const EyeOffIcon = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 3l18 18" /><path d="M10.6 6.2A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.6" /><path d="M6.1 6.1A17 17 0 0 0 2 12s3.5 6 10 6a10 10 0 0 0 4-.8" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </svg>
);
export const ArrowIcon = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const BackArrow = (p) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);
export const CheckIcon = (p) => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
export const BigCheck = (p) => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
export const SentMail = (p) => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 7 8.5 6 8.5-6" />
  </svg>
);
// Shared two-pane shell. `onSignIn` returns to the login screen; `footNote`
// is the small mono line under the brand pane.
export function AuthLayout({ children, onSignIn, footNote = "Reset links expire after 1 hour" }) {
  return (
    <div className="auth-page">
      <aside className="left">
        <button className="brand" onClick={onSignIn} type="button">
          <span className="brand-name">arciv<em>.</em></span>
        </button>

        <div className="hero">
          <h1>Locked out?<br /><em>One link</em> back in.</h1>
          <p>
            Happens to the best archivists. We'll email you a secure, single-use link —
            no security questions, no hold music. You'll be back to your inbox in under a minute.
          </p>
        </div>

        <div className="stack" aria-hidden="true">
          <div className="float-card fc-1">
            <div className="top"><span className="dot" style={{ background: "var(--watch)", color: "var(--watch)" }} /> Watch later · youtube.com</div>
            <div className="title">How Figma got to 4 million users — Dylan Field at YC</div>
            <div className="meta"><span>32 min</span><span className="sep" /><span>saved 4m ago</span></div>
          </div>
          <div className="float-card fc-2">
            <div className="top"><span className="dot" style={{ background: "var(--accent)", color: "var(--accent)" }} /> Classified · stripe.com/blog</div>
            <div className="title">The Stripe Press 2024 reading list — long-form picks</div>
            <div className="meta"><span>Read later</span><span className="sep" /><span>just now</span></div>
          </div>
          <div className="float-card fc-3">
            <div className="top"><span className="dot" style={{ background: "var(--try)", color: "var(--try)" }} /> Try later · linear.app</div>
            <div className="title">Linear for Roadmaps — free during private beta</div>
            <div className="meta"><span>Tool</span><span className="sep" /><span>2d ago</span></div>
          </div>
        </div>

        <div className="left-foot"><span className="pip" /> {footNote}</div>
      </aside>

      <main className="right">
        <div className="right-top">
          <span className="switch-hint">Remembered it?</span>
          <button className="switch-btn" onClick={onSignIn} type="button">Sign in</button>
        </div>

        <div className="form-wrap">{children}</div>

        <div className="right-foot">
          <span>arciv © 2026</span>
          <span className="links">
            <a href="#">Help</a><a href="#">Privacy</a><a href="#">Terms</a>
          </span>
        </div>
      </main>
    </div>
  );
}
