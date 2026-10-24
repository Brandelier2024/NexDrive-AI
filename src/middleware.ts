import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // 1. Allow public auth endpoints, static assets, and favicon
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // 2. Check if user is authenticated
  const isAuthenticated = Boolean(req.auth?.user);

  if (!isAuthenticated) {
    // For API routes, return 401 JSON response instead of redirecting to login page
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // For web page routes, redirect to signin
    const signInUrl = new URL("/auth/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  // Protect all routes by default while bypassing Next.js static asset bundles
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
