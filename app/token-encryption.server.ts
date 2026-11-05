import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const value = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64");
  if (value.length !== 32)
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must contain 32 base64-encoded bytes",
    );
  return value;
}

export function encryptToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decryptToken(encrypted: string) {
  const [iv, tag, ciphertext] = encrypted
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
