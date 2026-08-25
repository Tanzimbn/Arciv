/* Shared AI-provider picker — used by SettingsView and the BYOK onboarding modal. */

import { useCallback, useEffect, useState } from "react";
import { api, errMessage } from "../api/client.js";

export const PROVIDERS = [
  { id: "gemini",    label: "Gemini",    icon: "✦", color: "#1a73e8" },
  { id: "groq",      label: "Groq",      icon: "⚡", color: "#f55036" },
  { id: "anthropic", label: "Anthropic", icon: "◈", color: "#cc785c" },
  { id: "openai",    label: "OpenAI",    icon: "⬡", color: "#10a37f" },
  { id: "ollama",    label: "Ollama",    icon: "⬢", color: "#6b6964" },
];

export function ProviderPicker({ value, onChange, isMobile }) {
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

/* ── Model picker ──────────────────────────────────────────────────────────
   The list comes from the provider's own catalogue (POST /settings/ai/models),
   not a hardcoded table — a hardcoded table is the bug this exists to fix.

   Key-first, by design, but **checked on demand**. `apiKeyChecked` is a key the
   user typed into the API Key field and then explicitly submitted with "Check
   key"; `keyAwaitingCheck` says one is typed but not submitted yet. Nothing is
   fetched while it is being typed: a debounce still fires mid-key, and every
   prefix of a valid key is a *wrong* key, so the user watched their own typing
   be rejected while the provider was billed a request per pause. Checking is now
   an act, not a side effect of keystrokes.

   Listing models is the cheapest credential check there is (no completion,
   nothing billed), so one request answers both "is this key good?" and "what can
   it run?" — you never have to save a key to find out it was rejected. A 400
   means the key was refused; anything else is the provider.

   Manual entry is the fallback, never a dead end: if the listing fails for any
   reason (rejected key, provider down, offline self-host) the field degrades to
   a text input, because this is the one setting that fixes a model outage and
   the user must not be locked out of it.

   With no checked key we fall back to the *stored* provider and key, so an
   unsaved provider switch says so instead of listing the old provider's models
   under the new provider's name. Checking a key for the new provider resolves
   that immediately — no save needed. */
export function ModelPicker({ provider, savedProvider, savedKeyHint, apiKeyChecked = "", keyAwaitingCheck = false, sharedAvailable = false, value, onChange }) {
  const checked = apiKeyChecked.trim();
  const [state, setState] = useState({ status: "loading", models: [], fallback: "", source: "", error: "", rejected: false });
  const [manual, setManual] = useState(false);

  const load = useCallback(async (key, prov) => {
    setState(s => ({ ...s, status: "loading", error: "", rejected: false }));
    try {
      const d = await api.listAIModels(key ? { provider: prov, api_key: key } : {});
      setState({ status: "ok", models: d.models || [], fallback: d.default || "", source: d.key_source || "", error: "", rejected: false });
    } catch (e) {
      setState({
        status: "error", models: [], fallback: "", source: "",
        error: errMessage(e, "Could not load models."),
        rejected: e?.status === 400,
      });
    }
  }, []);

  useEffect(() => {
    // A key that is typed but not submitted is not a key yet. Saying so beats
    // both guesses: listing with the stored key would answer for the wrong
    // credential, and listing with a half-typed one is a guaranteed rejection.
    if (keyAwaitingCheck) {
      setState({ status: "unchecked", models: [], fallback: "", source: "", error: "", rejected: false });
      return;
    }
    // No key anywhere to ask with — say what to do instead of firing a request
    // that can only come back 422.
    if (!checked && !savedKeyHint && !sharedAvailable) {
      setState({ status: "nokey", models: [], fallback: "", source: "", error: "", rejected: false });
      return;
    }
    // Unsaved provider switch and no key checked for it: the stored key belongs
    // to the old provider, so its model list would be a lie under the new name.
    if (!checked && provider !== savedProvider) {
      setState({ status: "pending", models: [], fallback: "", source: "", error: "", rejected: false });
      return;
    }
    // No debounce: every path here is an explicit act (opening Settings,
    // switching provider, pressing Check key). savedKeyHint (the masked key) is a
    // dependency so saving a new key refetches — the old list was whatever the
    // *previous* credential could see.
    load(checked, provider);
  }, [checked, keyAwaitingCheck, provider, savedProvider, savedKeyHint, sharedAvailable, load]);

  const asText = manual || ["error", "pending", "nokey", "unchecked"].includes(state.status);
  const canRetry = !!checked || (!!savedKeyHint && provider === savedProvider);
  const providerLabel = PROVIDERS.find(p => p.id === provider)?.label || provider;

  const modelInput = (
    <input
      type="text" value={value} onChange={e => onChange(e.target.value)}
      placeholder="Leave blank for the provider default"
      style={{
        width: "100%", border: "1.5px solid var(--line)", borderRadius: 10,
        padding: "10px 13px", fontSize: 13.5, fontFamily: "monospace",
        color: "var(--ink)", background: "var(--surface-2)",
        outline: "none", boxSizing: "border-box",
      }}
    />
  );

  /* A failed listing gets a card, not a red sentence: the provider's message is
     the only thing here the user can act on, so it is the body text — the heading
     carries the diagnosis and the button is a button, not a text link. The raw
     wire format (`Error code: 401 - {...}`) is stripped server-side; what lands
     here is the provider's own sentence. */
  if (state.status === "error") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{
          display: "flex", flexDirection: "column", gap: 8,
          padding: "11px 13px", borderRadius: 10,
          background: "var(--bad-tint)",
          border: "1px solid color-mix(in oklab, var(--bad) 25%, transparent)",
        }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--bad)" }}>
            {state.rejected
              ? `${providerLabel} rejected this API key`
              : `Couldn't reach ${providerLabel}`}
          </span>
          <span style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5, wordBreak: "break-word" }}>
            {state.error}
          </span>
          <span style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
            {state.rejected
              ? "Generate a fresh key with your provider, paste it below, and press “Check key”."
              : "The key wasn't the problem. Try again, or set the model id by hand above."}
          </span>
          {canRetry && (
            <button type="button" onClick={() => { setManual(false); load(checked, provider); }}
              style={{
                alignSelf: "flex-start", marginTop: 1,
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", fontSize: 12, fontWeight: 600,
                borderRadius: 8, cursor: "pointer",
                color: "var(--bad)", background: "var(--surface)",
                border: "1px solid color-mix(in oklab, var(--bad) 35%, transparent)",
              }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" />
              </svg>
              Check again
            </button>
          )}
        </div>
        {modelInput}
      </div>
    );
  }

  if (asText) {
    const note =
      state.status === "unchecked"
        ? "Press “Check key” below to list the models that key can use."
        : state.status === "nokey"
          ? "Paste an API key below, then press “Check key”, to see the models it can use."
          : state.status === "pending"
            ? `Check a ${providerLabel} key below, or save the change, to load its models.`
            : "";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {modelInput}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {note && <span style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.4 }}>{note}</span>}
          {canRetry && (
            <button type="button" onClick={() => { setManual(false); load(checked, provider); }}
              style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent)", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
              Load list
            </button>
          )}
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    return <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "10px 0" }}>
      {checked ? "Checking key…" : "Loading models…"}
    </div>;
  }

  // A model the user already has saved but the provider no longer lists is kept
  // as an option, so opening Settings doesn't silently reset their choice — and
  // "(unavailable)" tells them it is the thing to change.
  const missing = value && !state.models.includes(value);
  const ok =
    state.source === "shared"
      ? `Shared key · ${state.models.length} model${state.models.length === 1 ? "" : "s"}`
      : `Key accepted · ${state.models.length} model${state.models.length === 1 ? "" : "s"} available`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <select
        value={value} onChange={e => onChange(e.target.value)}
        style={{
          width: "100%", border: "1.5px solid var(--line)", borderRadius: 10,
          padding: "10px 13px", fontSize: 13.5, color: "var(--ink)",
          background: "var(--surface-2)", outline: "none", boxSizing: "border-box",
          fontFamily: "inherit", cursor: "pointer",
        }}
      >
        <option value="">Provider default{state.fallback ? ` (${state.fallback})` : ""}</option>
        {missing && <option value={value}>{value} (unavailable)</option>}
        {state.models.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--good)" }}>✓ {ok}</span>
        <button type="button" onClick={() => setManual(true)}
          style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
          Enter a model id manually
        </button>
      </div>
    </div>
  );
}
