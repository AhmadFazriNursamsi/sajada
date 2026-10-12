import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Who may use the web workspace. It has no accounts yet, so it serves either
 * - this computer only (no password set: local development, SSH tunnel), or
 * - anyone with SAJADA_WEB_USER/SAJADA_WEB_PASSWORD (HTTP Basic, checked in proxy.ts for
 *   every request), additionally on the hosts in SAJADA_PUBLIC_HOSTS (e.g. a domain), or
 * - anyone at all on those hosts with SAJADA_OPEN_ACCESS=1 and no password: an explicit
 *   choice, since every visitor can then change and reset all data.
 * Checking the Host header also blocks DNS rebinding from other sites.
 */
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export const webPassword = () => process.env.SAJADA_WEB_PASSWORD || "";

export function allowedHost(host: string): boolean {
  if (LOOPBACK.test(host)) return true;
  if (!webPassword() && process.env.SAJADA_OPEN_ACCESS !== "1") return false;
  const name = host.toLowerCase().replace(/:\d+$/, "");
  return (process.env.SAJADA_PUBLIC_HOSTS ?? "").split(",").some((h) => h.trim().toLowerCase() === name);
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/** True when the Authorization header carries the configured user and password. */
export function validBasicAuth(header: string | null): boolean {
  const password = webPassword();
  if (!password || !header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const user = process.env.SAJADA_WEB_USER || "admin";
  return timingSafeEqual(digest(decoded), digest(`${user}:${password}`));
}
