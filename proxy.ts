import { NextResponse, type NextRequest } from "next/server";
import { validBasicAuth, webPassword } from "@/lib/server/web-access";

// With SAJADA_WEB_PASSWORD set, every page and asset asks for it (lib/server/web-access.ts).
// /v1 has its own token auth and /healthz stays open for monitoring. /brand (the public logo)
// stays open because next/image fetches it from the server without the browser's credentials.
export function proxy(request: NextRequest) {
  if (!webPassword() || validBasicAuth(request.headers.get("authorization"))) return NextResponse.next();
  return new NextResponse("Login diperlukan.", {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="Sajada", charset="UTF-8"', "cache-control": "no-store" },
  });
}

export const config = {
  matcher: ["/((?!v1|healthz|brand/).*)"],
};
