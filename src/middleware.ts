export { auth as middleware } from "@/lib/auth";

export const config = {
  // Protect all routes except auth pages, API routes, and static files
  matcher: [
    "/((?!api|auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
