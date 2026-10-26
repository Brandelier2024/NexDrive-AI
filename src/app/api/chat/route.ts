import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rewriteQuery, searchOneDriveItems, groupItemsByFolder } from "@/lib/retrieval/retriever";
import {
  searchPersonalOneDrive,
  searchSharedDataStorage,
  warmupSharedDataStorage,
} from "@/lib/graph/personal-drive";
import { generateRagAnswer } from "@/lib/generation/rag-chain";
import { createServerSupabaseClient } from "@/lib/supabase";
import { ChatRequest, ChatResponse, OneDriveRecord } from "@/lib/types";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

// Asynchronously warm up the 17,500 shared storage files so user searches don't hit cold fetches
if (process.env.NODE_ENV !== "test" && process.env.NEXT_PHASE !== "phase-production-build") {
  setTimeout(() => {
    warmupSharedDataStorage();
  }, 1000);
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userEmail = session.user.email?.toLowerCase().trim();
    const clientIp = getClientIp(req);
    const rateLimitIdentifier = userEmail || session.user.id || clientIp;

    // Rate Limiting: 20 search requests / 1 minute per user/client
    const chatLimit = checkRateLimit(`chat:${rateLimitIdentifier}`, {
      windowMs: 60 * 1000,
      max: 20,
    });
    if (!chatLimit.allowed) {
      return NextResponse.json(
        { error: "Too many search requests. Please wait a moment before sending another query." },
        {
          status: 429,
          headers: { "Retry-After": String(chatLimit.retryAfterSeconds) },
        }
      );
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

    // Enforce 2,000 character maximum query length
    if (trimmedMessage.length > 2000) {
      return NextResponse.json(
        { error: "Query exceeds the maximum allowed length of 2,000 characters." },
        { status: 400 }
      );
    }

    if (scope !== "all" && scope !== "company" && scope !== "personal") {
      return NextResponse.json(
        { error: "Invalid scope. Allowed values are 'all', 'company', or 'personal'." },
        { status: 400 }
      );
    }

    // Bound conversation history to last 10 turns to prevent payload bloating
    const boundedHistory = Array.isArray(chat_history) ? chat_history.slice(-10) : [];

    // 1. Rewrite multi-turn conversational query
    const rewrittenQuery = await rewriteQuery(trimmedMessage, boundedHistory);

    // Validate email requirement for personal searches before dispatching
    if (scope === "personal" && !userEmail) {
      return NextResponse.json(
        { error: "User email is required for personal OneDrive searches." },
        { status: 400 }
      );
    }

    // 2. Multi-Drive Retrieval in Parallel: Company Shared Drive + Corporate Data Storage + Personal OneDrive
    const shouldSearchCompany = scope === "all" || scope === "company";
    const shouldSearchShared = scope === "all" || scope === "company";
    const shouldSearchPersonal = (scope === "all" || scope === "personal") && Boolean(userEmail);

    const [companyResult, sharedResult, personalResult] = await Promise.allSettled([
      shouldSearchCompany ? searchOneDriveItems(rewrittenQuery) : Promise.resolve([]),
      shouldSearchShared ? searchSharedDataStorage(rewrittenQuery) : Promise.resolve([]),
      shouldSearchPersonal ? searchPersonalOneDrive(rewrittenQuery, userEmail!) : Promise.resolve([]),
    ]);

    const companyRecords: OneDriveRecord[] =
      companyResult.status === "fulfilled" ? companyResult.value : [];
    const sharedStorageRecords: OneDriveRecord[] =
      sharedResult.status === "fulfilled" ? sharedResult.value : [];
    let personalRecords: OneDriveRecord[] = [];

    if (personalResult.status === "fulfilled") {
      personalRecords = personalResult.value;
    } else {
      console.error("[Chat API] Failed to search personal OneDrive:", personalResult.reason);
      if (scope === "personal") {
        return NextResponse.json(
          { error: "Failed to search personal OneDrive. Please verify your Microsoft 365 connection or try again later." },
          { status: 502 }
        );
      }
    }

    if (sharedResult.status === "rejected") {
      console.warn("[Chat API] Failed to search shared data storage accounts:", sharedResult.reason);
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

    // 4. Save chat message to Supabase if available and user exists in database
    try {
      const supabase = createServerSupabaseClient();
      let userId: string | null = null;
      if (userEmail) {
        const { data: u } = await supabase
          .from("users")
          .select("id")
          .eq("email", userEmail)
          .single();
        if (u) userId = u.id;
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
    return NextResponse.json(
      { error: "An unexpected error occurred while processing your request. Please try again later." },
      { status: 500 }
    );
  }
}
