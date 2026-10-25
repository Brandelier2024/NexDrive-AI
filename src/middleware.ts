import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Known public root-level assets and files
export const KNOWN_PUBLIC_PATHS = new Set([
  "/favicon.ico",
  "/favicon.svg",
  "/apple-icon.png",
  "/icon.png",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/file.svg",
  "/globe.svg",
  "/next.svg",
  "/vercel.svg",
  "/window.svg",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.json",
  "/site.webmanifest",
]);

// Known public directory prefixes where static files can be served
export const PUBLIC_STATIC_DIR_PREFIXES = [
  "/static/",
  "/assets/",
  "/images/",
  "/public/",
];

const STATIC_EXTENSION_REGEX = /\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$/i;

export function isPublicPath(pathname: string): boolean {
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/_next") ||
    KNOWN_PUBLIC_PATHS.has(pathname)
  ) {
    return true;
  }

  // Extension-based bypass applies only to known public paths/directories,
  // never to arbitrary application or protected API/admin routes
  if (
    PUBLIC_STATIC_DIR_PREFIXES.some((prefix) => pathname.startsWith(prefix)) &&
    STATIC_EXTENSION_REGEX.test(pathname)
  ) {
    return true;
  }

  return false;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // 1. Allow public auth endpoints, static assets, and favicon
  if (isPublicPath(pathname)) {
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
  // Protect all routes by default while bypassing Next.js static asset bundles and public favicon
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
