import { headers } from "next/headers";
import { UserError } from "./db.ts";
import { allowedHost } from "./web-access.ts";

/**
 * The web workspace's server functions only serve the hosts in ./web-access.ts: this
 * computer, or the public hosts once a password protects them (proxy.ts).
 * SAJADA_LOCAL_MODE=1 must be set as well.
 */
export async function assertLocal() {
  if (process.env.SAJADA_LOCAL_MODE !== "1") throw new UserError("Mode lokal tidak aktif (SAJADA_LOCAL_MODE).");
  if (!allowedHost((await headers()).get("host") ?? "")) throw new UserError("Akses hanya dari komputer ini.");
}
