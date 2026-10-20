import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rewriteQuery, searchOneDriveItems, groupItemsByFolder } from "@/lib/retrieval/retriever";
import { searchPersonalOneDrive } from "@/lib/graph/personal-drive";
import { generateRagAnswer } from "@/lib/generation/rag-chain";
import { createServerSupabaseClient } from "@/lib/supabase";
import { ChatRequest, ChatResponse, OneDriveRecord } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as ChatRequest;
    const { message, chat_history = [], session_id = "default", scope = "all" } = body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const trimmedMessage = message.trim();
    const userEmail = session.user.email?.toLowerCase().trim();

    // 1. Rewrite multi-turn conversational query
    const rewrittenQuery = await rewriteQuery(trimmedMessage, chat_history);

    // 2. Dual-mode Retrieval: Company Shared Drive + Personal OneDrive
    let companyRecords: OneDriveRecord[] = [];
    let personalRecords: OneDriveRecord[] = [];

    // Search company shared drive if scope is "all" or "company"
    if (scope === "all" || scope === "company") {
      companyRecords = await searchOneDriveItems(rewrittenQuery);
    }

    // Search authenticated employee's personal OneDrive if scope is "all" or "personal"
    if ((scope === "all" || scope === "personal") && userEmail) {
      personalRecords = await searchPersonalOneDrive(rewrittenQuery, userEmail);
    }

    // Combine retrieved records (personal records first so user sees their own assets prominently)
    const combinedRecords: OneDriveRecord[] = [...personalRecords, ...companyRecords];
    const folderCards = groupItemsByFolder(combinedRecords);

    // 3. Generate answer with strict URL fidelity guardrail
    const answerMarkdown = await generateRagAnswer(
      rewrittenQuery,
      combinedRecords,
      folderCards
    );

    // 4. Save chat message to Supabase if available
    try {
      const supabase = createServerSupabaseClient();
      let userId: string | null = null;
      if (session.user.email) {
        const { data: u } = await supabase
          .from("users")
          .select("id")
          .eq("email", session.user.email.toLowerCase().trim())
          .single();
        if (u) userId = u.id;
      }
      if (!userId && session.user.id) {
        userId = session.user.id;
      }

      if (userId) {
        await supabase.from("chat_messages").insert([
          {
            user_id: userId,
            session_id,
            role: "user",
            content: trimmedMessage,
          },
          {
            user_id: userId,
            session_id,
            role: "assistant",
            content: answerMarkdown,
            folder_cards: folderCards,
          },
        ]);
      }
    } catch (saveError) {
      console.error("[Chat Save Error]:", saveError);
    }

    const response: ChatResponse = {
      answer_markdown: answerMarkdown,
      folder_cards: folderCards,
      query: trimmedMessage,
      rewritten_query: rewrittenQuery !== trimmedMessage ? rewrittenQuery : undefined,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error("[Chat API Error]:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
