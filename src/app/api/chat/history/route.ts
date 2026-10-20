import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const requestedSessionId = searchParams.get("sessionId");

    const supabase = createServerSupabaseClient();
    let userId: string | null = null;

    if (session.user.email) {
      const { data: userRecord } = await supabase
        .from("users")
        .select("id")
        .eq("email", session.user.email.toLowerCase().trim())
        .single();
      if (userRecord) userId = userRecord.id;
    }

    if (!userId && session.user.id) {
      userId = session.user.id;
    }

    if (!userId) {
      return NextResponse.json({ sessions: [], messages: [] });
    }

    // If specific sessionId requested, fetch all messages for that session
    if (requestedSessionId) {
      const { data: messages, error } = await supabase
        .from("chat_messages")
        .select("id, role, content, folder_cards, created_at, session_id")
        .eq("user_id", userId)
        .eq("session_id", requestedSessionId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("[Chat History] Error fetching session messages:", error);
        return NextResponse.json({ error: "Failed to fetch session messages" }, { status: 500 });
      }

      return NextResponse.json({
        sessionId: requestedSessionId,
        messages: messages || [],
      });
    }

    // Otherwise, fetch all messages to compile sessions list and most recent session
    const { data: allMessages, error } = await supabase
      .from("chat_messages")
      .select("id, session_id, role, content, folder_cards, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[Chat History] Error fetching history:", error);
      return NextResponse.json({ error: "Failed to fetch chat history" }, { status: 500 });
    }

    if (!allMessages || allMessages.length === 0) {
      return NextResponse.json({
        sessions: [],
        messages: [],
        activeSessionId: `session-${Date.now()}`,
      });
    }

    // Group messages by session_id
    const sessionsMap = new Map<
      string,
      {
        id: string;
        title: string;
        lastMessage: string;
        lastTimestamp: string;
        messageCount: number;
        messages: Array<Record<string, unknown>>;
      }
    >();

    for (const msg of allMessages) {
      const sId = msg.session_id || "default";
      if (!sessionsMap.has(sId)) {
        sessionsMap.set(sId, {
          id: sId,
          title: msg.role === "user" ? msg.content : "New Conversation",
          lastMessage: msg.content,
          lastTimestamp: msg.created_at,
          messageCount: 1,
          messages: [msg],
        });
      } else {
        const s = sessionsMap.get(sId)!;
        s.messages.push(msg);
        s.lastMessage = msg.content;
        s.lastTimestamp = msg.created_at;
        s.messageCount += 1;
        // Keep first user message as title if available
        if (s.title === "New Conversation" && msg.role === "user") {
          s.title = msg.content;
        }
      }
    }

    // Sort sessions by most recent timestamp descending
    const sessionsList = Array.from(sessionsMap.values())
      .sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime())
      .map((s) => ({
        id: s.id,
        title: s.title,
        lastMessage: s.lastMessage,
        lastTimestamp: s.lastTimestamp,
        messageCount: s.messageCount,
      }));

    // Active session is the most recent session
    const mostRecentSessionId = sessionsList[0]?.id || `session-${Date.now()}`;
    const activeMessages = sessionsMap.get(mostRecentSessionId)?.messages || [];

    return NextResponse.json({
      sessions: sessionsList,
      activeSessionId: mostRecentSessionId,
      messages: activeMessages,
    });
  } catch (error: unknown) {
    console.error("[Chat History Error]:", error);
    const message = error instanceof Error ? error.message : "Failed to load chat history";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");

    const supabase = createServerSupabaseClient();
    let userId: string | null = null;

    if (session.user.email) {
      const { data: userRecord } = await supabase
        .from("users")
        .select("id")
        .eq("email", session.user.email.toLowerCase().trim())
        .single();
      if (userRecord) userId = userRecord.id;
    }

    if (!userId && session.user.id) {
      userId = session.user.id;
    }

    if (!userId) {
      return NextResponse.json({ success: true, message: "No history found" });
    }

    let deleteQuery = supabase.from("chat_messages").delete().eq("user_id", userId);

    if (sessionId && sessionId !== "all") {
      deleteQuery = deleteQuery.eq("session_id", sessionId);
    }

    const { error } = await deleteQuery;

    if (error) {
      console.error("[Chat History Delete Error]:", error);
      return NextResponse.json({ error: "Failed to delete chat history" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: sessionId ? `Session ${sessionId} deleted.` : "All chat history deleted.",
    });
  } catch (error: unknown) {
    console.error("[Chat History Delete Error]:", error);
    const message = error instanceof Error ? error.message : "Failed to delete chat history";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
