/* Shared AI-provider picker — used by SettingsView and the BYOK onboarding modal. */

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
