import { headers } from "next/headers";
import { UserError } from "./db.ts";

/**
 * The web workspace has no sign-in yet, so its server functions only serve this computer:
 * SAJADA_LOCAL_MODE=1 must be set and the request must address a loopback host
 * (which also blocks DNS-rebinding from other sites).
 */
export async function assertLocal() {
  if (process.env.SAJADA_LOCAL_MODE !== "1") throw new UserError("Mode lokal tidak aktif (SAJADA_LOCAL_MODE).");
  const host = (await headers()).get("host") ?? "";
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) throw new UserError("Akses hanya dari komputer ini.");
}
