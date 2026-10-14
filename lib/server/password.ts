import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Password hashing with scrypt (node:crypto, no extra dependency). Stored as
// "scrypt$N$r$p$salt$hash" (base64) so the cost can be raised later without breaking old hashes.
const N = 16384, R = 8, P = 1, KEYLEN = 64;

export const MIN_PASSWORD = 8;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export function passwordProblem(password: string): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) return `Password minimal ${MIN_PASSWORD} karakter.`;
  if (password.length > 200) return "Password terlalu panjang.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await derive(String(password), Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A valid hash of a random password, verified when the username does not exist (equal timing). */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  return (dummy ??= hashPassword(randomBytes(24).toString("base64")));
}
