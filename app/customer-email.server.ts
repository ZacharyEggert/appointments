import { createHash } from "node:crypto";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function emailHash(email: string) {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}
