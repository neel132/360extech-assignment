import { NextResponse, type NextRequest } from "next/server";

// Basic auth on the internal ops dashboard whenever OPS_PASSWORD is set (any username).
export function proxy(req: NextRequest) {
  const password = process.env.OPS_PASSWORD;
  if (!password) return NextResponse.next();
  const [scheme, encoded] = (req.headers.get("authorization") ?? "").split(" ");
  const supplied = scheme === "Basic" && encoded ? atob(encoded).split(":").slice(1).join(":") : null;
  if (supplied === password) return NextResponse.next();
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="ops"' } });
}

export const config = { matcher: "/ops/:path*" };
