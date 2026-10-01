/* Shared AI-provider picker — used by the Settings AI section and BYOK onboarding. */

import { useCallback, useEffect, useState } from "react";
import { api, errMessage } from "../api/client.js";
import { ProviderLogo } from "./ProviderLogos.jsx";

/* `keyUrl` is where a user actually gets the credential — the single most useful
   link on the page, and the one thing no amount of UI copy can substitute for. */
/* `color` is the tile's accent, so it has to survive both themes. Groq and
   Anthropic are the brands' own hexes. Gemini's mark is really a blue→purple
   gradient and this is the flat reduction; OpenAI's current brand is black,
   which would disappear against a dark surface, so the long-running ChatGPT
   green stands in; Ollama's llama is black, greyed here for the same reason.
   Ollama has no `prefix`: cloud keys carry no advertised shape to hint at.
   The mark itself lives in ProviderLogos.jsx, keyed on `id`. */
export const PROVIDERS = [
  { id: "gemini",    label: "Gemini",    color: "#1a73e8", prefix: "AIza…",    keyUrl: "https://aistudio.google.com/apikey" },
  { id: "groq",      label: "Groq",      color: "#f55036", prefix: "gsk_…",    keyUrl: "https://console.groq.com/keys" },
  { id: "anthropic", label: "Anthropic", color: "#d97757", prefix: "sk-ant-…", keyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "openai",    label: "OpenAI",    color: "#10a37f", prefix: "sk-…",     keyUrl: "https://platform.openai.com/api-keys" },
  { id: "ollama",    label: "Ollama",    color: "#6b6964", keyUrl: "https://ollama.com/settings/keys" },
];

export const providerOf = id => PROVIDERS.find(p => p.id === id) || { id, label: id };
export const labelOf = id => providerOf(id).label;

export function ProviderPicker({ value, onChange, isMobile }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 3 : PROVIDERS.length}, 1fr)`, gap: 8 }}>
      {PROVIDERS.map(p => {
        const active = value === p.id;
        return (
          <button key={p.id} type="button" onClick={() => onChange(p.id)} className="arciv-hov"
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              padding: "12px 8px", borderRadius: 12, cursor: "pointer",
              border: `1.5px solid ${active ? p.color : "var(--line)"}`,
              background: active ? `color-mix(in oklab, ${p.color} 10%, var(--surface))` : "var(--surface-2)",
              boxShadow: active ? `0 0 0 3px color-mix(in oklab, ${p.color} 14%, transparent)` : "none",
              "--hov-bg": `color-mix(in oklab, ${p.color} ${active ? 14 : 7}%, var(--surface))`,
              "--hov-line": active ? p.color : `color-mix(in oklab, ${p.color} 45%, transparent)`,
              "--hov-color": "inherit",
            }}
          >
            <span style={{ display: "flex", color: active ? p.color : "var(--muted)" }}><ProviderLogo id={p.id} size={18} /></span>
            <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, color: active ? p.color : "var(--muted)", letterSpacing: "0.01em" }}>{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Model picker ──────────────────────────────────────────────────────────
   Only ever rendered once the account *is* connected — i.e. a key is stored and
   has already been accepted by the provider. That precondition is what keeps
   this simple: the earlier version carried four extra states (no key / key typed
   but unchecked / provider switched but unsaved / …) whose only job was to
   explain why it could not list anything yet. "Not connected" is now the other
   half of the section, so those states have nowhere left to occur.

   The list comes from the provider's own catalogue (POST /settings/ai/models),
   never a hardcoded table — a hardcoded table is the bug this exists to fix,
   since providers retire models on their own schedule.

   `seedModels` is the listing that the Connect step already paid for. Passing it
   in renders the dropdown with no second request and no second spinner.

   Manual entry stays as a fallback, never a dead end: if the listing fails for
   any reason (provider down, offline self-host) the field degrades to a text
   input, because this is the one setting that fixes a model outage and the user
   must not be locked out of it. */
export function ModelPicker({ provider, seedModels = null, seedDefault = "", value, onChange }) {
  const [state, setState] = useState(
    seedModels
      ? { status: "ok", models: seedModels, fallback: seedDefault, source: "", error: "" }
      : { status: "loading", models: [], fallback: "", source: "", error: "" }
  );
  const [manual, setManual] = useState(false);

  const load = useCallback(async () => {
    setState(s => ({ ...s, status: "loading", error: "" }));
    try {
      const d = await api.listAIModels({});
      setState({ status: "ok", models: d.models || [], fallback: d.default || "", source: d.key_source || "", error: "" });
    } catch (e) {
      setState({ status: "error", models: [], fallback: "", source: "", error: errMessage(e, "Could not load models.") });
    }
  }, []);

  useEffect(() => {
    // Seeded: Connect just listed these models with this very key. Fetching again
    // would ask the same question twice.
    if (seedModels) {
      setState({ status: "ok", models: seedModels, fallback: seedDefault, source: "", error: "" });
      return;
    }
    load();
  }, [provider, seedModels, seedDefault, load]);

  const providerLabel = labelOf(provider);

  const modelInput = (
    <input
      type="text" value={value} onChange={e => onChange(e.target.value)}
      placeholder="Leave blank for the provider default"
      style={{
        width: "100%", border: "1.5px solid var(--line)", borderRadius: 10,
        padding: "10px 13px", fontSize: 13.5, fontFamily: "var(--font-mono)",
        color: "var(--ink)", background: "var(--surface-2)",
        outline: "none", boxSizing: "border-box",
      }}
    />
  );

  if (state.status === "loading") {
    return <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "10px 0" }}>Loading models…</div>;
  }

  /* A failed listing gets a card, not a red sentence: the provider's message is
     the only thing here the user can act on, so it is the body text. The raw wire
     format (`Error code: 500 - {...}`) is stripped server-side; what lands here is
     the provider's own sentence. The key is known-good — it was accepted at
     connect time — so this is upstream's problem, and the manual field below is
     the way through it. */
  if (state.status === "error" || manual) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {state.status === "error" && (
          <div style={{
            display: "flex", flexDirection: "column", gap: 8,
            padding: "11px 13px", borderRadius: 10,
            // Wash, not fill — same reason as AiConnection's cards: coloured text
            // on a solid coloured field loses both.
            background: "linear-gradient(180deg, color-mix(in oklab, var(--bad) 8%, var(--surface)), color-mix(in oklab, var(--bad) 3%, var(--surface)))",
            border: "1px solid color-mix(in oklab, var(--bad) 25%, transparent)",
          }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--bad)" }}>
              Couldn’t list {providerLabel} models
            </span>
            <span style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5, wordBreak: "break-word" }}>
              {state.error}
            </span>
            <span style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
              Your key is fine — it was accepted when you connected. Try again, or type the model id
              below.
            </span>
            <button type="button" onClick={() => { setManual(false); load(); }} className="arciv-hov"
              style={{
                alignSelf: "flex-start", marginTop: 1,
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", fontSize: 12, fontWeight: 600,
                borderRadius: 8, cursor: "pointer",
                color: "var(--bad)", background: "var(--surface)",
                border: "1px solid color-mix(in oklab, var(--bad) 35%, transparent)",
                "--hov-bg": "color-mix(in oklab, var(--bad) 10%, var(--surface))",
                "--hov-line": "var(--bad)", "--hov-color": "var(--bad)",
              }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" />
              </svg>
              Try again
            </button>
          </div>
        )}
        {modelInput}
        {manual && state.status !== "error" && (
          <button type="button" onClick={() => setManual(false)}
            className="arciv-hov"
            style={{
              alignSelf: "flex-start", fontSize: 11.5, fontWeight: 600, color: "var(--accent)",
              background: "transparent", border: "1px solid transparent", borderRadius: 6,
              padding: "3px 6px", margin: "-3px -6px", cursor: "pointer",
              "--hov-bg": "var(--accent-tint)", "--hov-line": "transparent", "--hov-color": "var(--accent-deep)",
            }}>
            Back to the model list
          </button>
        )}
      </div>
    );
  }

  // A model the user already has saved but the provider no longer lists is kept
  // as an option, so opening Settings doesn't silently reset their choice — and
  // "(unavailable)" tells them it is the thing to change.
  const missing = value && !state.models.includes(value);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <select
        value={value} onChange={e => onChange(e.target.value)}
        style={{
          width: "100%", border: "1.5px solid var(--line)", borderRadius: 10,
          padding: "10px 13px", fontSize: 13.5, color: "var(--ink)",
          background: "var(--surface-2)", outline: "none", boxSizing: "border-box",
          fontFamily: "inherit", cursor: "pointer",
          "--hov-bg": "var(--surface-2)", "--hov-line": "var(--muted-2)", "--hov-color": "var(--ink)",
        }}
        className="arciv-hov"
      >
        <option value="">Default{state.fallback ? ` (${state.fallback})` : ""}</option>
        {missing && <option value={value}>{value} (unavailable)</option>}
        {state.models.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
          {state.models.length} model{state.models.length === 1 ? "" : "s"} available
          {state.source === "shared" ? " on the shared key" : ""}
        </span>
        <button type="button" onClick={() => setManual(true)}
          className="arciv-hov"
          style={{
            fontSize: 11.5, fontWeight: 600, color: "var(--muted)", cursor: "pointer",
            background: "transparent", border: "1px solid transparent", borderRadius: 6,
            padding: "3px 6px", margin: "-3px -6px",
            "--hov-bg": "var(--surface-2)", "--hov-line": "var(--line)", "--hov-color": "var(--ink)",
          }}>
          Enter a model id manually
        </button>
      </div>
    </div>
  );
}
