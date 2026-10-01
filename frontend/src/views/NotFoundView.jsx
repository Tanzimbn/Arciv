// Unknown path. Rendered client-side, so the URL the user typed stays in the
// bar — silently rewriting it to "/" hides the typo and makes a wrong link look
// like a working one. Note the HTTP status is still 200: the server serves
// index.html for every non-API path (it cannot know the SPA's route table
// without duplicating it), so this page is the 404, not the response code.
export default function NotFoundView({ onHome }) {
  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg)", color: "var(--ink)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <a href="/" style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          textDecoration: "none", color: "var(--ink)", marginBottom: 28,
        }}>
          <span style={{ fontWeight: 600, fontSize: 18, letterSpacing: "-0.025em" }}>
            arciv<em style={{ fontStyle: "normal", color: "var(--accent)" }}>.</em>
          </span>
        </a>

        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: ".08em",
          textTransform: "uppercase", color: "var(--muted)", marginBottom: 10,
        }}>
          404
        </div>

        <h1 style={{
          fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 40,
          lineHeight: 1.05, letterSpacing: "-0.015em", margin: "0 0 12px",
        }}>
          Page not found
        </h1>

        <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 24px" }}>
          Nothing lives at{" "}
          <code style={{
            fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--ink-2)",
            background: "var(--surface-2)", border: "1px solid var(--line)",
            borderRadius: 6, padding: "1px 5px",
          }}>
            {window.location.pathname}
          </code>.
        </p>

        <button
          onClick={onHome}
          style={{
            border: 0, borderRadius: 99, cursor: "pointer", padding: "9px 18px",
            fontSize: 13.5, fontWeight: 600,
            background: "var(--accent)", color: "var(--accent-ink)",
          }}
        >
          Back to your links
        </button>
      </div>
    </div>
  );
}
