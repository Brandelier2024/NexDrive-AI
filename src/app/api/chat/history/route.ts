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

    // Type for session summary items
    type SessionSummaryItem = {
      id: string;
      title: string;
      lastMessage: string;
      lastTimestamp: string;
      messageCount: number;
    };

    // Attempt database-level session aggregation with pagination and exact total
    let aggregatedSessions: Array<{
      session_id: string;
      title?: string;
      last_message?: string;
      last_timestamp: string;
      message_count: number | string;
      total_sessions?: number | string;
      active_session_id?: string;
    }> | null = null;

    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc("get_user_chat_sessions", {
        p_user_id: userId,
        p_limit: limit,
        p_offset: offset,
      });

      if (!rpcError && Array.isArray(rpcData)) {
        aggregatedSessions = rpcData;
      }
    } catch {
      aggregatedSessions = null;
    }

    const sessionOrder: string[] = [];
    const sessionLastTimestamp = new Map<string, string>();
    const sessionMessageCounts = new Map<string, number>();
    const sessionsMap = new Map<string, SessionSummaryItem>();
    let totalSessions = 0;
    let pagedSessionIds: string[] = [];
    let mostRecentSessionId = `session-${Date.now()}`;

    if (aggregatedSessions) {
      if (aggregatedSessions.length === 0 && offset === 0) {
        return NextResponse.json({
          sessions: [],
          messages: [],
          activeSessionId: `session-${Date.now()}`,
          total: 0,
          hasMore: false,
        });
      }

      totalSessions =
        aggregatedSessions.length > 0 ? Number(aggregatedSessions[0].total_sessions) || 0 : 0;
      mostRecentSessionId =
        aggregatedSessions[0]?.active_session_id ||
        aggregatedSessions[0]?.session_id ||
        `session-${Date.now()}`;

      for (const item of aggregatedSessions) {
        const sId = item.session_id || "default";
        sessionOrder.push(sId);
        sessionLastTimestamp.set(sId, item.last_timestamp);
        const count = Number(item.message_count) || 1;
        sessionMessageCounts.set(sId, count);

        sessionsMap.set(sId, {
          id: sId,
          title: item.title || "New Conversation",
          lastMessage: item.last_message || "",
          lastTimestamp: item.last_timestamp,
          messageCount: count,
        });
      }

      pagedSessionIds = sessionOrder;
    } else {
      // Fallback: Fetch session entries if RPC is not available in database
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

      totalSessions = sessionOrder.length;
      pagedSessionIds = sessionOrder.slice(offset, offset + limit);
      mostRecentSessionId = sessionOrder[0] || `session-${Date.now()}`;

      for (const sId of pagedSessionIds) {
        sessionsMap.set(sId, {
          id: sId,
          title: "New Conversation",
          lastMessage: "",
          lastTimestamp: sessionLastTimestamp.get(sId) || new Date().toISOString(),
          messageCount: sessionMessageCounts.get(sId) || 1,
        });
      }

      // Populate fallback session summaries for paged sessions
      // 1. Fetch latest messages per session (ordered descending so first row per session is the latest)
      const { data: latestMessages } = await supabase
        .from("chat_messages")
        .select("session_id, content, created_at")
        .eq("user_id", userId)
        .in("session_id", pagedSessionIds)
        .order("created_at", { ascending: false });

      for (const msg of latestMessages || []) {
        const sId = msg.session_id || "default";
        const s = sessionsMap.get(sId);
        if (s && !s.lastMessage) {
          s.lastMessage = msg.content;
        }
      }

      // 2. Fetch first user messages for conversation titles (ordered ascending so first row per session is the initial user message)
      const { data: firstUserMessages } = await supabase
        .from("chat_messages")
        .select("session_id, content, created_at")
        .eq("user_id", userId)
        .eq("role", "user")
        .in("session_id", pagedSessionIds)
        .order("created_at", { ascending: true });

      for (const msg of firstUserMessages || []) {
        const sId = msg.session_id || "default";
        const s = sessionsMap.get(sId);
        if (s && s.title === "New Conversation") {
          s.title = msg.content;
        }
      }

      // 3. Address any sessions whose messages were truncated by PostgREST row limits
      const missingSessions = pagedSessionIds.filter((id) => {
        const s = sessionsMap.get(id);
        return s && (!s.lastMessage || s.title === "New Conversation");
      });

      if (missingSessions.length > 0 && missingSessions.length <= 20) {
        await Promise.all(
          missingSessions.map(async (sId) => {
            const s = sessionsMap.get(sId);
            if (!s) return;
            if (!s.lastMessage) {
              const { data: lastOne } = await supabase
                .from("chat_messages")
                .select("content")
                .eq("user_id", userId)
                .eq("session_id", sId)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (lastOne?.content) s.lastMessage = lastOne.content;
            }
            if (s.title === "New Conversation") {
              const { data: firstOne } = await supabase
                .from("chat_messages")
                .select("content")
                .eq("user_id", userId)
                .eq("session_id", sId)
                .eq("role", "user")
                .order("created_at", { ascending: true })
                .limit(1)
                .maybeSingle();
              if (firstOne?.content) s.title = firstOne.content;
            }
          })
        );
      }

      // Ensure fallback values are populated if only one of title/lastMessage exists
      for (const s of sessionsMap.values()) {
        if (!s.lastMessage && s.title !== "New Conversation") {
          s.lastMessage = s.title;
        }
        if (s.title === "New Conversation" && s.lastMessage) {
          s.title = s.lastMessage;
        }
      }
    }

    const hasMore = offset + limit < totalSessions;

    if (pagedSessionIds.length === 0) {
      return NextResponse.json({
        sessions: [],
        messages: [],
        activeSessionId: mostRecentSessionId,
        total: totalSessions,
        hasMore,
      });
    }

    // Sort paged sessions according to latest activity
    const sessionsList = pagedSessionIds
      .map((id) => sessionsMap.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));

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
