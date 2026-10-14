import { NextResponse, type NextRequest } from "next/server";

// Sends visitors without a session cookie to the sign-in page. This is only a shortcut: every
// page and server action checks the session itself (lib/server/auth.ts).
// /daftar (member sign-up) is public; /v1 has its own token auth; /healthz, the logo and icons too.
export function proxy(request: NextRequest) {
  if (request.cookies.has("sajada_session")) return NextResponse.next();
  if (request.method === "GET" || request.method === "HEAD") return NextResponse.redirect(new URL("/login", request.url));
  return new NextResponse("Login diperlukan.", { status: 401, headers: { "cache-control": "no-store" } });
}

export const config = {
  matcher: ["/((?!login|daftar|v1|healthz|brand/|_next/|favicon\\.ico|icon\\.png|apple-icon\\.png).*)"],
};
