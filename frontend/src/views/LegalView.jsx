// Public legal pages (Terms of Service, Privacy Policy) — reachable without
// auth. Canonical source lives in docs/legal/*.md; this renders the
// app-facing copy. Operators must fill the {{PLACEHOLDER}} fields before launch.

const DOCS = {
  terms: {
    title: "Terms of Service",
    intro:
      "A starting template for the hosted deployment of Arciv — not legal advice. Fill in the bracketed fields and have it reviewed before publishing.",
    sections: [
      {
        h: "The service",
        p: "Arciv is an intelligent link and feed manager. AI features are bring-your-own-key: you supply your own AI provider key and are responsible for that account, its usage, and its costs.",
      },
      {
        h: "Accounts",
        p: "You must provide a valid email address and keep your credentials secure. You are responsible for activity under your account.",
      },
      {
        h: "Acceptable use",
        p: "Do not use the service to break the law, infringe others' rights, overload the infrastructure, circumvent rate limits or quotas, or save content you have no right to access. We may suspend or terminate accounts that violate these terms.",
      },
      {
        h: "Your content and provider keys",
        p: "You keep ownership of the links, notes, and feeds you save. Provider API keys are encrypted at rest and used only to make requests to your chosen AI provider on your behalf.",
      },
      {
        h: "Availability and changes",
        p: "The service is provided “as is”, without warranties. We may change or discontinue features and may modify these terms; continued use after changes take effect means you accept them.",
      },
      {
        h: "Termination",
        p: "You may delete your account at any time from Settings, which permanently removes your data. We may terminate accounts for violations of these terms.",
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    intro:
      "A starting template for the hosted deployment of Arciv — not legal advice. Adjust for your jurisdiction (e.g. GDPR/CCPA) and have it reviewed before publishing.",
    sections: [
      {
        h: "What we collect",
        p: "Your email and a securely hashed password; the links, feeds, notes, and feed history you save; your AI provider key (stored encrypted at rest, never shown back to you in full); and operational data such as timestamps and rate-limit counters needed to run and protect the service.",
      },
      {
        h: "How we use it",
        p: "To operate the service: store your links and feeds, fetch page metadata, poll feeds, and — when you provide a key — send content to your chosen AI provider. We do not sell your personal data.",
      },
      {
        h: "Third parties",
        p: "Your AI provider receives the content you choose to process, under its own terms. Infrastructure providers (hosting, database, email) process data on our behalf to run the service.",
      },
      {
        h: "Retention and deletion",
        p: "We keep your data until you delete it. You can export all your data or permanently delete your account at any time from Settings. Deletion removes your account and all associated links, feeds, feed history, and notifications.",
      },
      {
        h: "Security",
        p: "Passwords are hashed with bcrypt. Provider keys are encrypted at rest with a rotatable master key. Every query is scoped per account so users cannot access each other's data.",
      },
      {
        h: "Your rights",
        p: "Depending on your jurisdiction you may have rights to access, correct, export, or delete your data. Export and deletion are self-serve in Settings.",
      },
    ],
  },
};

export default function LegalView({ type = "terms" }) {
  const doc = DOCS[type] || DOCS.terms;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--ink)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px 80px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
          <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none", color: "var(--ink)" }}>
            <span style={{ fontWeight: 600, fontSize: 18, letterSpacing: "-0.025em" }}>
              arciv<em style={{ fontStyle: "normal", color: "var(--accent)" }}>.</em>
            </span>
          </a>
          <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
            <a href="/terms" style={{ color: type === "terms" ? "var(--ink)" : "var(--muted)", textDecoration: "none" }}>Terms</a>
            <a href="/privacy" style={{ color: type === "privacy" ? "var(--ink)" : "var(--muted)", textDecoration: "none" }}>Privacy</a>
            <a href="/" style={{ color: "var(--muted)", textDecoration: "none" }}>Back to app</a>
          </div>
        </div>

        {/* Title */}
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 44, lineHeight: 1.05, letterSpacing: "-0.015em", margin: "0 0 12px" }}>
          {doc.title}
        </h1>

        {/* Template notice */}
        <p style={{
          fontSize: 12.5, color: "var(--muted)", lineHeight: 1.55, margin: "0 0 28px",
          padding: "10px 14px", borderRadius: 10,
          background: "var(--surface-2)", border: "1px solid var(--line)",
        }}>
          {doc.intro}
        </p>

        {/* Sections */}
        {doc.sections.map((s) => (
          <section key={s.h} style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em", margin: "0 0 6px" }}>{s.h}</h2>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--ink-2)", margin: 0 }}>{s.p}</p>
          </section>
        ))}

        <p style={{ fontSize: 12, color: "var(--muted-2)", fontFamily: "var(--font-mono)", marginTop: 40 }}>
          arciv © 2026
        </p>
      </div>
    </div>
  );
}
