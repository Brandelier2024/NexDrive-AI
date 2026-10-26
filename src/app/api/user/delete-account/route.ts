import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase";

export async function DELETE() {
  try {
    const session = await auth();

    if (!session?.user || !session.user.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const email = session.user.email.toLowerCase().trim();
    const supabase = createServerSupabaseClient();

    // 1. Resolve canonical user record by email (ensures correct Supabase UUID regardless of SSO or credentials)
    const { data: user, error: userLookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (userLookupError || !user) {
      return NextResponse.json(
        { error: "User account not found." },
        { status: 404 }
      );
    }

    const canonicalUserId = user.id;

    // 2. Explicitly delete user's chat messages
    const { error: chatDeleteError } = await supabase
      .from("chat_messages")
      .delete()
      .eq("user_id", canonicalUserId);

    if (chatDeleteError) {
      console.error("[Delete Account] Error deleting chat_messages:", chatDeleteError);
      return NextResponse.json(
        { error: "Failed to delete account data. Please try again." },
        { status: 500 }
      );
    }

    // 3. Delete user from 'users' table and confirm deleted records
    const { data: deletedUsers, error: userDeleteError } = await supabase
      .from("users")
      .delete()
      .eq("id", canonicalUserId)
      .select("id");

    if (userDeleteError) {
      console.error("[Delete Account] Supabase error:", userDeleteError);
      return NextResponse.json(
        { error: "Failed to delete account. Please try again." },
        { status: 500 }
      );
    }

    if (!deletedUsers || deletedUsers.length === 0) {
      return NextResponse.json(
        { error: "User account not found or already deleted." },
        { status: 404 }
      );
    }

    // 4. Clean up any pending verification records for this email
    try {
      await supabase.from("email_verifications").delete().eq("email", email);
    } catch {
      // ignore
    }

    console.log(`[Delete Account] Successfully deleted user account: user ID ${canonicalUserId}`);

    const response = NextResponse.json({
      success: true,
      message: "Account and associated data deleted successfully.",
    });

    const cookieNames = [
      "authjs.session-token",
      "__Secure-authjs.session-token",
      "next-auth.session-token",
      "__Secure-next-auth.session-token",
      "authjs.csrf-token",
      "__Host-authjs.csrf-token",
      "next-auth.csrf-token",
      "authjs.callback-url",
      "next-auth.callback-url",
    ];

    for (const name of cookieNames) {
      response.cookies.delete(name);
      response.cookies.set(name, "", {
        maxAge: 0,
        path: "/",
        expires: new Date(0),
      });
    }

    return response;
  } catch (error: unknown) {
    console.error("[Delete Account Error]:", error);
    return NextResponse.json(
      { error: "Failed to delete account. Please try again later." },
      { status: 500 }
    );
  }
}
