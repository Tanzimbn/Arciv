import { useState } from "react";
import { api } from "../api/client.js";
import {
  AuthLayout,
  MailIcon,
  KeyIcon,
  ArrowIcon,
  BackArrow,
  SentMail,
} from "./authShared.jsx";

export default function ForgotPasswordView({ onDone }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const canRequest = email.trim().includes("@");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canRequest) return;
    setLoading(true);
    try {
      // Backend always returns a generic 200 (no account enumeration); show the
      // "check your inbox" state regardless of whether the address exists.
      await api.forgotPassword(email);
    } catch {
      /* generic — still advance to the sent state */
    } finally {
      setLoading(false);
      setSent(true);
    }
  }

  return (
    <AuthLayout onSignIn={onDone}>
      {sent ? (
        <div className="form" key="sent">
          <div className="sent-icon"><SentMail /></div>
          <div className="sent-head">
            <h2>Check your inbox</h2>
            <p>
              If an account exists for<br />
              <b>{email}</b>, a password reset link is on its way. It's valid for 1 hour.
            </p>
          </div>
          <button className="submit" onClick={onDone}>
            Back to sign in <ArrowIcon className="arrow" />
          </button>
          <p className="resend">
            Didn't get it? Check spam, or{" "}
            <button type="button" onClick={() => setSent(false)}>try another email</button>
          </p>
        </div>
      ) : (
        <form className="form" key="request" onSubmit={handleSubmit}>
          <button className="back-link" type="button" onClick={onDone}>
            <BackArrow /> Back to sign in
          </button>

          <div className="form-head">
            <div className="step-badge">
              <span className="ico"><KeyIcon width="13" height="13" /></span> Account recovery
            </div>
            <h2 style={{ marginTop: "16px" }}>Reset your password</h2>
            <p>Enter the email tied to your archive and we'll send a secure link to set a new password.</p>
          </div>

          <div className="field">
            <label className="field-label">Email address</label>
            <div className="lit-wrap">
              <div className="input">
                <MailIcon />
                <input
                  type="email"
                  value={email}
                  autoFocus
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>
            </div>
          </div>

          <button className="submit" disabled={!canRequest || loading}>
            {loading ? "Sending…" : <>Send reset link <ArrowIcon className="arrow" /></>}
          </button>

          <p className="alt-line">
            Don't have an account? <button type="button" onClick={onDone}>Create one</button>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
