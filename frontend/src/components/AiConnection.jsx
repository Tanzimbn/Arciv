/* ── AI connection ─────────────────────────────────────────────────────────
   The whole "which AI runs my classification" setting, as two states rather
   than a form: the account is either **connected** to a provider or it is not.

   Everything else here follows from that. The old version asked the user to
   perform three separate commit-ish actions in the right order — Check key,
   Save, Test connection — with the model dropdown rendered *before* a usable key
   existed, so it spent most of its life displaying one of four different
   explanations for why it had nothing to list. Connect does the check and the
   save as one act, and the model list is only ever shown when there is a key
   that the provider has already accepted.

   Nothing is stored until the provider accepts the credential: a rejected key
   never reaches the database, so "saved" and "working" can't disagree. */

import { useState } from "react";
import { api, errMessage } from "../api/client.js";
import { ProviderLogo } from "./ProviderLogos.jsx";
import { ModelPicker, ProviderPicker, labelOf, providerOf } from "./ProviderPicker.jsx";
import { useBreakpoint } from "../hooks/useBreakpoint.js";

/* Validate, then persist. The listing is the credential check — no completion,
   nothing billed — so one request answers both "is this key good?" and "what can
   it run?", and the answer arrives before anything is written. (Ollama Cloud's
   catalogue is public, so its provider probes an auth-gated endpoint first; the
   guarantee this call makes is the same either way.) The original {status, data}
   is re-thrown so callers can tell a rejected key (400) from a provider outage
   (anything else). */
export async function connectAi(provider, key) {
  const listing = await api.listAIModels({ provider, api_key: key });
  // ai_model: "" resets to the provider default — a model id from the previous
  // provider would 404 every classify.
  const settings = await api.updateSettings({
    ai_provider: provider, ai_api_key: key, ai_model: "",
  });
  return { settings, models: listing.models || [], default: listing.default || "" };
}

export function connectErrorTitle(err, provider) {
  return err?.status === 400
    ? `${labelOf(provider)} rejected this key`
    : `Couldn’t reach ${labelOf(provider)}`;
}

/* Low-opacity wash over the surface — the card reads as tinted, the text on it
   still reads as text. `--good-tint` & co. are solid fills and flatten the two
   together, so they are not used for panels here. */
const wash = (c, top = 8, bottom = 3) =>
  `linear-gradient(180deg, color-mix(in oklab, ${c} ${top}%, var(--surface)), color-mix(in oklab, ${c} ${bottom}%, var(--surface)))`;

/* Every provider is a hosted API now, so the two failures split cleanly: 400 is
   the credential, 502 is upstream. */
function hintFor(status) {
  if (status === 400) return "Check you copied the whole key, and that it belongs to this provider.";
  if (status !== 502) return "";
  return "The key wasn’t the problem — the provider didn’t answer. Try again in a moment.";
}

function Label({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.09em", textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

/* Secondary action — a real button, not a text link: Test / Replace / the
   confirm pair all commit something, and they should look like it. */
function Btn({ onClick, disabled, tone = "plain", size = 36, children }) {
  const bad = tone === "bad";
  return (
    <button type="button" className="arciv-hov" onClick={onClick} disabled={disabled}
      style={{
        height: size, padding: "0 15px", borderRadius: 10, flex: "none",
        fontSize: 13, fontWeight: bad ? 700 : 600, fontFamily: "inherit",
        cursor: disabled ? "default" : "pointer",
        // The confirm of a destructive action is the one control that must not be
        // a tint: a solid fill with inverted text keeps the label legible and says
        // plainly that pressing it does something.
        color: bad ? "var(--btn-dark-text)" : "var(--ink-2)",
        background: bad ? "var(--bad)" : "var(--surface-2)",
        border: `1px solid ${bad ? "var(--bad)" : "var(--line)"}`,
        opacity: disabled ? 0.6 : 1,
        "--hov-bg": bad ? "color-mix(in oklab, var(--bad) 82%, #000)" : "var(--surface)",
        "--hov-line": bad ? "color-mix(in oklab, var(--bad) 82%, #000)" : "var(--muted-2)",
        "--hov-color": bad ? "var(--btn-dark-text)" : "var(--ink)",
      }}>
      {children}
    </button>
  );
}

/* Disconnect is destructive and lives one click from Test, so it stays flat
   until hovered — colour arrives with the intent, not before it. */
function GhostBtn({ onClick, children }) {
  return (
    <button type="button" className="arciv-hov" onClick={onClick}
      style={{
        height: 36, padding: "0 15px", borderRadius: 10,
        fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
        color: "var(--muted)", background: "transparent", border: "1px solid transparent",
        "--hov-bg": "color-mix(in oklab, var(--bad) 10%, var(--surface))",
        "--hov-line": "color-mix(in oklab, var(--bad) 28%, transparent)",
        "--hov-color": "var(--bad)",
      }}>
      {children}
    </button>
  );
}

export default function AiConnection({ settings, onSettings }) {
  const { isMobile } = useBreakpoint();
  const connected = !!settings.ai_api_key_masked;

  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState(settings.ai_provider || "gemini");
  const [keyInput, setKeyInput] = useState("");
  const [reveal, setReveal] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [err, setErr] = useState(null);            // {status, message}
  // The listing Connect already paid for, so the dropdown needs no second trip.
  const [seed, setSeed] = useState(null);
  const [model, setModel] = useState(settings.ai_model || "");
  const [modelErr, setModelErr] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [focused, setFocused] = useState(false);

  const meta = providerOf(provider);
  const saved = providerOf(settings.ai_provider);
  const showForm = !connected || editing;
  const canConnect = keyInput.trim().length > 3 && !connecting;

  function resetForm(p) {
    setKeyInput(""); setReveal(false);
    setErr(null); setProvider(p);
  }

  async function handleConnect() {
    if (!canConnect) return;
    setConnecting(true); setErr(null); setTestResult(null);
    try {
      const r = await connectAi(provider, keyInput.trim());
      onSettings(r.settings);
      setSeed({ models: r.models, default: r.default });
      setModel("");
      setKeyInput(""); setReveal(false);
      setEditing(false);
      setTestResult({ success: true, message: "Key verified and saved" });
    } catch (e) {
      setErr({ status: e?.status, message: errMessage(e, "Could not verify this key.") });
    } finally { setConnecting(false); }
  }

  async function handleModelChange(m) {
    const previous = model;
    setModel(m); setModelErr(""); setTestResult(null);
    try {
      onSettings(await api.updateSettings({ ai_model: m }));
    } catch {
      setModel(previous);          // don't show a choice that isn't stored
      setModelErr("Couldn’t save that model. Try again.");
    }
  }

  async function handleDisconnect() {
    try {
      onSettings(await api.updateSettings({ ai_api_key: "" }));
      setSeed(null); setModel(""); setTestResult(null);
      setConfirmDisconnect(false); setEditing(false);
      resetForm(settings.ai_provider || "gemini");
    } catch {
      setErr({ status: 0, message: "Couldn’t remove the key. Try again." });
    }
  }

  /* The server reports success/failure but not latency, so the round trip is
     timed here — it is the honest number anyway (it includes our own API), and
     it is the one thing that tells a working key from a slow one. */
  async function handleTest() {
    setTesting(true); setTestResult(null);
    const t0 = performance.now();
    try {
      const r = await api.testAI();
      setTestResult({ ...r, ms: Math.round(performance.now() - t0) });
    } catch {
      setTestResult({ success: false, message: "Request failed." });
    } finally { setTesting(false); }
  }

  /* ── Connected summary ─────────────────────────────────────────────── */
  const summary = connected && (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "13px 15px", borderRadius: 13,
        background: wash("var(--good)"),
        border: "1px solid color-mix(in oklab, var(--good) 28%, transparent)",
      }}>
        <div style={{
          width: 36, height: 36, flex: "none", borderRadius: 10,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: saved.color || "var(--good)",
          background: "var(--surface)",
          border: "1px solid color-mix(in oklab, var(--good) 22%, transparent)",
        }}><ProviderLogo id={saved.id} size={19} /></div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{saved.label}</span>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5, height: 20, padding: "0 8px",
              borderRadius: 99, fontSize: 11, fontWeight: 700,
              background: "color-mix(in oklab, var(--good) 16%, transparent)", color: "var(--good)",
            }}>● Connected</span>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--muted)", letterSpacing: "0.04em", overflow: "hidden", textOverflow: "ellipsis" }}>
            {settings.ai_api_key_masked}
          </div>
        </div>

        {/* Kept alongside Connect's check because they prove different things:
            the check proves the credential authenticates, the test runs a real
            classification end to end. */}
        <Btn onClick={handleTest} disabled={testing} size={32}>
          {testing ? "Testing…" : "Test"}
        </Btn>
      </div>

      {testResult && (
        <div style={{
          display: "flex", alignItems: "center", gap: 9,
          padding: "10px 13px", borderRadius: 10, fontSize: 13, lineHeight: 1.5,
          background: wash(testResult.success ? "var(--good)" : "var(--bad)"),
          color: testResult.success ? "var(--good)" : "var(--bad)",
          border: `1px solid color-mix(in oklab, ${testResult.success ? "var(--good)" : "var(--bad)"} 25%, transparent)`,
          wordBreak: "break-word",
        }}>
          {testResult.success ? "✓" : "✕"} {testResult.message}
          {testResult.ms != null && ` · ${testResult.ms} ms`}
        </div>
      )}

      {!editing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Label>Model</Label>
          <ModelPicker
            provider={settings.ai_provider}
            seedModels={seed?.models || null}
            seedDefault={seed?.default || ""}
            value={model}
            onChange={handleModelChange}
          />
          {modelErr && <div style={{ fontSize: 12, color: "var(--bad)", fontWeight: 600 }}>{modelErr}</div>}
        </div>
      )}

      {!editing && !confirmDisconnect && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingTop: 16, borderTop: "1px solid var(--line-2)" }}>
          <Btn onClick={() => { setEditing(true); resetForm(settings.ai_provider); }}>Replace key</Btn>
          <GhostBtn onClick={() => { setConfirmDisconnect(true); setTestResult(null); }}>Disconnect</GhostBtn>
        </div>
      )}

      {confirmDisconnect && (
        <div style={{
          padding: 16, borderRadius: 13,
          background: wash("var(--bad)"),
          border: "1px solid color-mix(in oklab, var(--bad) 30%, transparent)",
        }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--bad)" }}>
            Disconnect {saved.label}?
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
            The stored key is deleted immediately and can’t be recovered. New links keep saving —
            they just won’t be summarised until a key is connected again.
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Btn onClick={handleDisconnect} tone="bad">Yes, disconnect</Btn>
            <Btn onClick={() => setConfirmDisconnect(false)}>Keep it</Btn>
          </div>
        </div>
      )}
    </div>
  );

  /* ── Connect form ──────────────────────────────────────────────────── */
  const form = showForm && (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: connected ? 18 : 0 }}>
      {/* An account holds a single key (`users.ai_api_key_enc` is one column), so
          connecting a second provider replaces the first. Said once, at the only
          moment it can bite, instead of as permanent page furniture. */}
      {connected && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 11,
          padding: "13px 15px", borderRadius: 12,
          background: wash("var(--warn)"),
          border: "1px solid color-mix(in oklab, var(--warn) 30%, transparent)",
        }}>
          <span style={{ color: "var(--warn)", fontSize: 13, lineHeight: 1.5 }}>▲</span>
          <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
            Connecting a new key replaces{" "}
            <strong style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--ink)" }}>
              {settings.ai_api_key_masked}
            </strong>. The current key stays active until the new one is verified.
          </div>
        </div>
      )}

      {!connected && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>Connect a provider</div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55 }}>
            Until a key is connected, saved links are sorted by URL patterns alone. Nothing is lost,
            they just don’t get summaries.
          </div>
        </div>
      )}

      {!connected && settings.shared_ai_available && (
        <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55, padding: "10px 13px", background: "color-mix(in oklab, var(--accent) 7%, var(--surface))", border: "1px solid color-mix(in oklab, var(--accent) 22%, transparent)", borderRadius: 10 }}>
          Links are being classified with this instance’s shared Gemini key, which has a small daily
          allowance per account. Connect your own key to lift it.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <Label>Provider</Label>
        <ProviderPicker value={provider} isMobile={isMobile}
          onChange={p => { setProvider(p); setKeyInput(""); setErr(null); }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Label>API Key</Label>
          {/* Where the credential actually comes from — the one thing no amount
              of UI copy substitutes for. */}
          {meta.keyUrl && (
            <a href={meta.keyUrl} target="_blank" rel="noreferrer" className="arciv-hov"
              style={{
                fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none",
                whiteSpace: "nowrap", flex: "none", borderRadius: 6, padding: "2px 4px", margin: "-2px -4px",
                background: "transparent", border: "1px solid transparent",
                "--hov-bg": "var(--accent-tint)", "--hov-line": "transparent", "--hov-color": "var(--accent-deep)",
              }}>
              Get a {meta.label} key ↗
            </a>
          )}
        </div>

        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <input
            type={reveal ? "text" : "password"}
            value={keyInput}
            onChange={e => { setKeyInput(e.target.value); setErr(null); }}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleConnect(); } }}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            placeholder={`Paste your ${meta.label} key${meta.prefix ? ` · ${meta.prefix}` : ""}`}
            style={{
              width: "100%", height: 48, borderRadius: 11,
              padding: "0 78px 0 15px",
              fontSize: 13.5, fontFamily: "var(--font-mono)",
              border: `1.5px solid ${focused ? "var(--accent)" : "var(--line)"}`,
              color: "var(--ink)", background: "var(--surface-2)",
              outline: "none", boxSizing: "border-box",
              transition: "border-color .12s",
            }}
          />
          {/* A pasted key is invisible by definition; the commonest failure is a
              truncated paste, and this is the only way to see it before spending
              a round trip on it. */}
          <button type="button" onClick={() => setReveal(v => !v)} className="arciv-hov"
              style={{
                position: "absolute", right: 8, height: 32, padding: "0 11px",
                borderRadius: 8, fontSize: 12, fontFamily: "inherit", cursor: "pointer",
                color: "var(--muted)", background: "var(--surface)", border: "1px solid var(--line)",
                "--hov-bg": "var(--surface-2)", "--hov-line": "var(--muted-2)", "--hov-color": "var(--ink)",
              }}>
            {reveal ? "Hide" : "Show"}
          </button>
        </div>

        <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
          Verified with {meta.label} and saved in one step. Stored encrypted, never shown again. A rejected key is never stored.
        </div>
      </div>

      {err && (
        <div style={{
          display: "flex", flexDirection: "column", gap: 6,
          padding: "11px 13px", borderRadius: 10,
          background: wash("var(--bad)"),
          border: "1px solid color-mix(in oklab, var(--bad) 25%, transparent)",
        }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--bad)" }}>
            {connectErrorTitle(err, provider)}
          </span>
          <span style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5, wordBreak: "break-word" }}>
            {err.message}
          </span>
          {hintFor(err.status) && (
            <span style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
              {hintFor(err.status)}
            </span>
          )}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={handleConnect} disabled={!canConnect} className="arciv-hov"
          style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            height: 40, padding: "0 20px", border: 0, borderRadius: 10,
            fontSize: 13.5, fontWeight: 700, fontFamily: "inherit",
            cursor: canConnect ? "pointer" : "not-allowed",
            background: canConnect ? "var(--accent)" : "var(--surface-2)",
            color: canConnect ? "var(--accent-ink)" : "var(--muted-2)",
            boxShadow: canConnect ? "0 2px 10px rgba(109,58,255,.25)" : "none",
            "--hov-bg": canConnect ? "var(--accent-deep)" : "var(--surface-2)",
            "--hov-line": "transparent",
            "--hov-color": canConnect ? "var(--accent-ink)" : "var(--muted-2)",
          }}>
          {connecting
            ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin .8s linear infinite" }}><circle cx="12" cy="12" r="9" strokeOpacity=".3"/><path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round"/></svg> Verifying…</>
            : connected ? "Replace key" : `Connect ${meta.label}`}
        </button>
        {connected && (
          <Btn size={40} onClick={() => { setEditing(false); resetForm(settings.ai_provider); }}>Cancel</Btn>
        )}
      </div>
    </div>
  );

  return <div>{summary}{form}</div>;
}
