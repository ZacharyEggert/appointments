import type { ReactNode } from "react";

export const LEGAL_ENTITY = "Ex Nihilo LLC";
export const CONTACT_EMAIL = "contact@ex-nihilo.llc";
export const LAST_UPDATED = "November 5, 2026";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 16px", lineHeight: 1.6, fontFamily: "Inter, system-ui, sans-serif" }}>
      <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 12, color: "inherit", textDecoration: "none" }}>
        <img src="/logo.svg" alt="" width={40} height={40} />
        <strong>Appointments</strong>
      </a>
      <h1>{title}</h1>
      <p><em>Last updated: {LAST_UPDATED}</em></p>
      {children}
      <hr />
      <p>
        <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a> · <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </main>
  );
}
