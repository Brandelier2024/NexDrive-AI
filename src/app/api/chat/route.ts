import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rewriteQuery, searchOneDriveItems, groupItemsByFolder } from "@/lib/retrieval/retriever";
import { generateRagAnswer } from "@/lib/generation/rag-chain";
import { createServerSupabaseClient } from "@/lib/supabase";
import { ChatRequest, ChatResponse } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as ChatRequest;
    const { message, chat_history = [], session_id = "default" } = body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const trimmedMessage = message.trim();

    // 1. Rewrite multi-turn conversational query
    const rewrittenQuery = await rewriteQuery(trimmedMessage, chat_history);

    // 2. Vector search & Parent-folder grouping
    const retrievedRecords = await searchOneDriveItems(rewrittenQuery);
    const folderCards = groupItemsByFolder(retrievedRecords);

    // 3. Generate answer with strict URL fidelity guardrail
    const answerMarkdown = await generateRagAnswer(
      rewrittenQuery,
      retrievedRecords,
      folderCards
    );

    // 4. Save chat message to Supabase if available
    try {
      const supabase = createServerSupabaseClient();
      if (session.user.id) {
        await supabase.from("chat_messages").insert([
          {
            user_id: session.user.id,
            session_id,
            role: "user",
            content: trimmedMessage,
          },
          {
            user_id: session.user.id,
            session_id,
            role: "assistant",
            content: answerMarkdown,
            folder_cards: folderCards,
          },
        ]);
      }
    } catch {
      // Non-blocking history save
    }

    const response: ChatResponse = {
      answer_markdown: answerMarkdown,
      folder_cards: folderCards,
      query: trimmedMessage,
      rewritten_query: rewrittenQuery !== trimmedMessage ? rewrittenQuery : undefined,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("[Chat API Error]:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
