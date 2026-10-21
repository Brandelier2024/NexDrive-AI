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
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50", 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);

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

    // Fetch session identifiers and timestamps to discover all sessions without heavy payloads
    const { data: sessionEntries, error: sessionsError } = await supabase
      .from("chat_messages")
      .select("session_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (sessionsError) {
      console.error("[Chat History] Error fetching sessions:", sessionsError);
      return NextResponse.json({ error: "Failed to fetch chat history" }, { status: 500 });
    }

    if (!sessionEntries || sessionEntries.length === 0) {
      return NextResponse.json({
        sessions: [],
        messages: [],
        activeSessionId: `session-${Date.now()}`,
        total: 0,
        hasMore: false,
      });
    }

    // Discover unique session IDs ordered by latest activity
    const sessionOrder: string[] = [];
    const sessionLastTimestamp = new Map<string, string>();
    const sessionMessageCounts = new Map<string, number>();

    for (const entry of sessionEntries) {
      const sId = entry.session_id || "default";
      if (!sessionLastTimestamp.has(sId)) {
        sessionOrder.push(sId);
        sessionLastTimestamp.set(sId, entry.created_at);
        sessionMessageCounts.set(sId, 1);
      } else {
        sessionMessageCounts.set(sId, (sessionMessageCounts.get(sId) || 0) + 1);
      }
    }

    const totalSessions = sessionOrder.length;
    // Paginate by sessions so limiting recent messages cannot hide older sessions
    const pagedSessionIds = sessionOrder.slice(offset, offset + limit);
    const hasMore = offset + limit < totalSessions;

    if (pagedSessionIds.length === 0) {
      return NextResponse.json({
        sessions: [],
        messages: [],
        activeSessionId: sessionOrder[0] || `session-${Date.now()}`,
        total: totalSessions,
        hasMore,
      });
    }

    // Fetch summaries for only the paged sessions
    const { data: pagedMessages, error: pagedError } = await supabase
      .from("chat_messages")
      .select("session_id, role, content, created_at")
      .eq("user_id", userId)
      .in("session_id", pagedSessionIds)
      .order("created_at", { ascending: true });

    if (pagedError) {
      console.error("[Chat History] Error fetching paged session messages:", pagedError);
      return NextResponse.json({ error: "Failed to fetch session messages" }, { status: 500 });
    }

    const sessionsMap = new Map<
      string,
      {
        id: string;
        title: string;
        lastMessage: string;
        lastTimestamp: string;
        messageCount: number;
      }
    >();

    for (const msg of pagedMessages || []) {
      const sId = msg.session_id || "default";
      if (!sessionsMap.has(sId)) {
        sessionsMap.set(sId, {
          id: sId,
          title: msg.role === "user" ? msg.content : "New Conversation",
          lastMessage: msg.content,
          lastTimestamp: sessionLastTimestamp.get(sId) || msg.created_at,
          messageCount: sessionMessageCounts.get(sId) || 1,
        });
      } else {
        const s = sessionsMap.get(sId)!;
        s.lastMessage = msg.content;
        if (s.title === "New Conversation" && msg.role === "user") {
          s.title = msg.content;
        }
      }
    }

    // Sort paged sessions according to latest activity
    const sessionsList = pagedSessionIds
      .map((id) => sessionsMap.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));

    // Active session is the most recent session
    const mostRecentSessionId = sessionOrder[0] || `session-${Date.now()}`;

    // Separately load full message records (including folder_cards) only for the active session on first page
    let activeMessages: Array<Record<string, unknown>> = [];
    if (sessionsList.length > 0 && offset === 0) {
      const { data: messages, error: activeError } = await supabase
        .from("chat_messages")
        .select("id, role, content, folder_cards, created_at, session_id")
        .eq("user_id", userId)
        .eq("session_id", mostRecentSessionId)
        .order("created_at", { ascending: true });

      if (activeError) {
        console.error("[Chat History] Error fetching active session messages:", activeError);
        return NextResponse.json({ error: "Failed to fetch active session messages" }, { status: 500 });
      }

      activeMessages = messages || [];
    }

    return NextResponse.json({
      sessions: sessionsList,
      activeSessionId: mostRecentSessionId,
      messages: activeMessages,
      total: totalSessions,
      hasMore,
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
