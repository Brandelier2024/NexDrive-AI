import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rewriteQuery, searchOneDriveItems, groupItemsByFolder } from "@/lib/retrieval/retriever";
import { searchPersonalOneDrive, searchSharedDataStorage } from "@/lib/graph/personal-drive";
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

    if (scope !== "all" && scope !== "company" && scope !== "personal") {
      return NextResponse.json(
        { error: "Invalid scope. Allowed values are 'all', 'company', or 'personal'." },
        { status: 400 }
      );
    }

    const trimmedMessage = message.trim();
    const userEmail = session.user.email?.toLowerCase().trim();

    // 1. Rewrite multi-turn conversational query
    const rewrittenQuery = await rewriteQuery(trimmedMessage, chat_history);

    // 2. Multi-Drive Retrieval: Company Shared Drive + Corporate Data Storage Accounts + Personal OneDrive
    let companyRecords: OneDriveRecord[] = [];
    let sharedStorageRecords: OneDriveRecord[] = [];
    let personalRecords: OneDriveRecord[] = [];

    // Search company shared drive if scope is "all" or "company"
    if (scope === "all" || scope === "company") {
      companyRecords = await searchOneDriveItems(rewrittenQuery);
    }

    // Search corporate data storage drives (data.brandelier@brandelier.in & data.brandelier2@brandelier.in)
    // which store raw footage, client shoots, and project folders accessible by everyone
    try {
      sharedStorageRecords = await searchSharedDataStorage(rewrittenQuery);
    } catch (storageError) {
      console.warn("[Chat API] Failed to search shared data storage accounts:", storageError);
    }

    // Search authenticated employee's personal OneDrive if scope is "all" or "personal"
    if (scope === "personal" && !userEmail) {
      return NextResponse.json(
        { error: "User email is required for personal OneDrive searches." },
        { status: 400 }
      );
    }

    if ((scope === "all" || scope === "personal") && userEmail) {
      try {
        personalRecords = await searchPersonalOneDrive(rewrittenQuery, userEmail);
      } catch (personalError) {
        console.error("[Chat API] Failed to search personal OneDrive:", personalError);
        if (scope === "personal" && sharedStorageRecords.length === 0) {
          return NextResponse.json(
            { error: "Failed to search personal OneDrive. Please verify your Microsoft 365 connection or try again later." },
            { status: 502 }
          );
        }
      }
    }

    // Combine retrieved records: Personal first, then Shared Data Storage, then Company shared library
    const combinedRecords: OneDriveRecord[] = [
      ...personalRecords,
      ...sharedStorageRecords,
      ...companyRecords,
    ];
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
