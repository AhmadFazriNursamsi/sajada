import { createHandler } from "../services/transaction/server.mjs";
import { pool } from "./server/db";

// Runs the transaction API (services/transaction/server.mjs) inside Next.js route handlers.
// The handler is the same one covered by services/db-tests; this file only adapts
// Web Request/Response to the small Node req/res surface it uses.

type Handler = ReturnType<typeof createHandler>;
const REQUIRED_ENV = ["DATABASE_URL", "OIDC_JWKS_URL", "OIDC_ISSUER", "OIDC_AUDIENCE"] as const;

// Keep one handler across dev hot reloads.
const cache = globalThis as typeof globalThis & { sajadaTransactionApi?: Handler };

function handler(): Handler {
  if (!cache.sajadaTransactionApi) {
    const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
    if (missing.length) throw new Error(`Transaction API not configured: ${missing.join(", ")} required`);
    cache.sajadaTransactionApi = createHandler({
      pool: pool(),
      jwksUrl: process.env.OIDC_JWKS_URL!,
      issuer: process.env.OIDC_ISSUER!,
      audience: process.env.OIDC_AUDIENCE!,
    });
  }
  return cache.sajadaTransactionApi;
}

export async function handleTransactionApi(request: Request): Promise<Response> {
  let api: Handler;
  try {
    api = handler();
  } catch (error) {
    console.error((error as Error).message);
    return Response.json({ error: "Transaction API not configured" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const url = new URL(request.url);
  const body = await request.text();
  const req = {
    url: url.pathname + url.search,
    method: request.method,
    headers: Object.fromEntries(request.headers),
    async *[Symbol.asyncIterator]() {
      if (body) yield body;
    },
  };
  return new Promise<Response>((resolve, reject) => {
    let status = 200;
    let headers: Record<string, string> = {};
    const res = {
      writeHead(code: number, head: Record<string, string>) {
        status = code;
        headers = head;
        return res;
      },
      end(chunk?: string) {
        resolve(new Response(chunk ?? null, { status, headers }));
      },
    };
    api(req as never, res as never).catch(reject);
  });
}
