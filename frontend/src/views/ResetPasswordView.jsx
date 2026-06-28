import { useMemo, useState } from "react";
import { api, errMessage } from "../api/client.js";
import {
  AuthLayout,
  PASSWORD_RULES,
  STRENGTH_LABEL,
  LockIcon,
  EyeIcon,
  EyeOffIcon,
  ArrowIcon,
  CheckIcon,
  BigCheck,
} from "./authShared.jsx";

export default function ResetPasswordView({ onDone }) {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const token = new URLSearchParams(window.location.search).get("token");

  const metReqs = useMemo(() => PASSWORD_RULES.map((r) => r.test(pw)), [pw]);
  const metCount = metReqs.filter(Boolean).length;
  const allMet = metCount === PASSWORD_RULES.length;
  const s = Math.min(4, metCount);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!token) {
      setError("This reset link is missing its token. Request a new one.");
      return;
    }
    if (!allMet) return;
    setLoading(true);
    try {
      await api.resetPassword(token, pw);
      setDone(true);
    } catch (err) {
      setError(errMessage(err, "Reset failed. The link may have expired."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout onSignIn={onDone}>
      {done ? (
        <div className="form" key="done">
          <div className="done-icon"><BigCheck /></div>
          <div className="sent-head">
            <h2>Password updated</h2>
            <p>Your new password is set. You can now sign in and get back to your archive.</p>
          </div>
          <button className="submit" onClick={onDone}>
            Continue to sign in <ArrowIcon className="arrow" />
          </button>
        </div>
      ) : (
        <form className="form" key="reset" onSubmit={handleSubmit}>
          <div className="form-head">
            <div className="step-badge">
              <span className="ico"><LockIcon width="13" height="13" /></span> Almost there
            </div>
            <h2 style={{ marginTop: "16px" }}>Choose a new password</h2>
            <p>Make it strong and memorable — you'll use this every time you sign in to <b>arciv</b>.</p>
          </div>

          <div className="field">
            <label className="field-label">New password</label>
            <div className="lit-wrap">
              <div className="input">
                <LockIcon />
                <input
                  type={show ? "text" : "password"}
                  value={pw}
                  autoFocus
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="Enter a new password"
                  autoComplete="new-password"
                />
                <button className="eye" type="button" onClick={() => setShow((v) => !v)} title={show ? "Hide" : "Show"}>
                  {show ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>
          </div>

          <div className="strength" data-s={pw ? s : 0}>
            <div className="strength-bars"><span /><span /><span /><span /></div>
            <div className="strength-label">
              <span>Password strength</span>
              <b>{STRENGTH_LABEL[pw ? s : 0]}</b>
            </div>
          </div>

          <div className="reqs">
            {PASSWORD_RULES.map((r, i) => (
              <div className={"req" + (metReqs[i] ? " met" : "")} key={r.key}>
                <span className="tick"><CheckIcon /></span>{r.label}
              </div>
            ))}
          </div>

          {error && <p className="err-line">{error}</p>}

          <button className="submit" disabled={!allMet || loading}>
            {loading ? "Updating…" : <>Update password <ArrowIcon className="arrow" /></>}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
