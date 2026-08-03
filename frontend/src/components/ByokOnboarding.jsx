import { useState } from "react";
import { api, errMessage } from "../api/client.js";
import { ProviderPicker } from "./ProviderPicker.jsx";
import { useBreakpoint } from "../hooks/useBreakpoint.js";

/* First-run BYOK prompt. Shown when a user has no personal AI key and the
 * instance has no shared key (hosted default) — without one, saved links never
 * get classified. Reuses the Settings BYOK plumbing (updateSettings + testAI).
 * Skippable: heuristics still route links, so this never blocks the app.
 *
 * onDone(added: boolean) — added=true when a key was saved & verified. */
export default function ByokOnboarding({ onDone, initialProvider = "gemini" }) {
  const { isMobile } = useBreakpoint();
  const [provider, setProvider] = useState(initialProvider);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!apiKey.trim()) {
      setError("Paste your API key to continue, or skip for now.");
      return;
    }
    setSaving(true);
    setError("");
    setTestResult(null);
    try {
      await api.updateSettings({ ai_provider: provider, ai_api_key: apiKey.trim() });
      // Verify the key actually works before declaring success — a bad key
      // saved silently would leave links stuck exactly as before.
      let result;
      try {
        result = await api.testAI();
      } catch {
        result = { success: false, message: "Saved, but the test request failed." };
      }
      setTestResult(result);
      if (result.success) {
        // Brief beat so the success chip is visible, then close.
        setTimeout(() => onDone(true), 700);
      } else {
        setSaving(false);
      }
    } catch (err) {
      setError(errMessage(err, "Couldn't save your key. Try again."));
      setSaving(false);
    }
  }

  return (
    <div
      onClick={() => !saving && onDone(false)}
      style={{
        position: "fixed", inset: 0, zIndex: 120,
        background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center", padding: 20,
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 480, background: "var(--surface)",
        border: "1px solid var(--line)", borderRadius: 16,
        padding: isMobile ? 22 : 28,
        boxShadow: "0 20px 60px rgba(0,0,0,.3)",
        maxHeight: "90vh", overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: "var(--accent-tint)", color: "var(--accent)",
            display: "grid", placeItems: "center",
          }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontWeight: 400, fontSize: 26, margin: 0, color: "var(--ink)" }}>
            Turn on AI classification
          </h2>
        </div>
        <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55, margin: "0 0 20px" }}>
          Arciv sorts every link you save — videos to watch, essays to read, tools to try —
          using your own AI provider key. Keys are free to create and stored encrypted.
          You can skip this and add one later in Settings.
        </p>

        {/* Provider */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
          Provider
        </div>
        <ProviderPicker value={provider} isMobile={isMobile} onChange={p => { setProvider(p); setTestResult(null); }} />

        {/* Key */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", margin: "18px 0 8px" }}>
          API Key
        </div>
        <input
          type="password"
          value={apiKey}
          onChange={e => { setApiKey(e.target.value); setError(""); setTestResult(null); }}
          placeholder="Paste your API key here"
          autoFocus
          onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
          style={{
            width: "100%", border: "1.5px solid var(--line)", borderRadius: 10,
            padding: "10px 13px", fontSize: 13.5, color: "var(--ink)",
            background: "var(--surface-2)", outline: "none", boxSizing: "border-box", fontFamily: "inherit",
          }}
        />

        {error && <p style={{ fontSize: 12.5, color: "var(--bad)", fontWeight: 600, margin: "10px 0 0" }}>{error}</p>}
        {testResult && (
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12,
            padding: "7px 12px", borderRadius: 9, fontSize: 12.5, fontWeight: 600,
            background: testResult.success ? "var(--good-tint)" : "var(--bad-tint)",
            color: testResult.success ? "var(--good)" : "var(--bad)",
            border: `1px solid color-mix(in oklab, ${testResult.success ? "var(--good)" : "var(--bad)"} 25%, transparent)`,
          }}>
            {testResult.success ? "✓" : "✕"} {testResult.message}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, marginTop: 22, justifyContent: "flex-end", alignItems: "center" }}>
          <button type="button" onClick={() => onDone(false)} disabled={saving}
            style={{
              padding: "9px 16px", border: "1.5px solid var(--line)", borderRadius: 10,
              fontSize: 13, fontWeight: 600, cursor: saving ? "default" : "pointer",
              background: "var(--surface-2)", color: "var(--ink-2)",
            }}>
            Skip for now
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            style={{
              padding: "9px 18px", border: 0, borderRadius: 10,
              fontSize: 13, fontWeight: 700, cursor: saving ? "default" : "pointer",
              background: saving ? "var(--accent-tint-2)" : "var(--accent)",
              color: saving ? "var(--accent)" : "var(--accent-ink)",
              boxShadow: saving ? "none" : "0 2px 10px rgba(109,58,255,.25)",
              transition: "background .15s",
            }}>
            {saving ? "Saving…" : "Save & continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
