import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const email = session.user.email.toLowerCase().trim();
    const supabase = createServerSupabaseClient();

    const { data: userRecord, error } = await supabase
      .from("users")
      .select("id, name, email, auth_provider, created_at")
      .eq("email", email)
      .single();

    if (error || !userRecord) {
      return NextResponse.json({
        user: {
          id: session.user.id || "",
          name: session.user.name || "Employee",
          email: session.user.email,
          auth_provider: "credentials",
          created_at: new Date().toISOString(),
        },
      });
    }

    return NextResponse.json({ user: userRecord });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch profile.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
