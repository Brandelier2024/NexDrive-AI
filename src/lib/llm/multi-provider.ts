import { GoogleGenAI } from "@google/genai";

interface KeyState {
  key: string;
  provider: "gemini" | "groq";
  cooldownUntil: number;
  totalCalls: number;
}

// Global state trackers for key pools
let geminiKeys: KeyState[] = [];
let groqKeys: KeyState[] = [];
let geminiIndex = 0;
let groqIndex = 0;
let lastRawGemini = "";
let lastRawGroq = "";

/**
 * Initializes and parses comma-separated keys from environment variables.
 * Automatically refreshes if environment variables change.
 */
function initializePools() {
  const rawGemini = process.env.GOOGLE_API_KEY || "";
  if (geminiKeys.length === 0 || rawGemini !== lastRawGemini) {
    lastRawGemini = rawGemini;
    const parsedGemini = rawGemini
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 5 && !k.includes("your_"));

    geminiKeys = parsedGemini.map((key) => ({
      key,
      provider: "gemini",
      cooldownUntil: 0,
      totalCalls: 0,
    }));
  }

  const rawGroq = process.env.GROQ_API_KEY || "";
  if (groqKeys.length === 0 || rawGroq !== lastRawGroq) {
    lastRawGroq = rawGroq;
    const parsedGroq = rawGroq
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 5 && !k.includes("your_"));

    groqKeys = parsedGroq.map((key) => ({
      key,
      provider: "groq",
      cooldownUntil: 0,
      totalCalls: 0,
    }));
  }
}

/**
 * Gets a healthy key using Round-Robin load balancing across concurrent users.
 */
function getHealthyKey(provider: "gemini" | "groq"): KeyState | null {
  initializePools();
  const pool = provider === "gemini" ? geminiKeys : groqKeys;
  if (pool.length === 0) return null;

  const now = Date.now();
  const healthyKeys = pool.filter((k) => now > k.cooldownUntil);
  if (healthyKeys.length === 0) return null;

  if (provider === "gemini") {
    geminiIndex = (geminiIndex + 1) % healthyKeys.length;
    return healthyKeys[geminiIndex];
  } else {
    groqIndex = (groqIndex + 1) % healthyKeys.length;
    return healthyKeys[groqIndex];
  }
}

/**
 * Marks a key as temporarily on cooldown when a 429 quota is encountered.
 */
function setKeyCooldown(keyState: KeyState, isDailyQuota: boolean = false) {
  // If daily quota exhausted, cooldown for 60 minutes; if transient rate limit, 45 seconds
  const cooldownDuration = isDailyQuota ? 60 * 60 * 1000 : 45 * 1000;
  keyState.cooldownUntil = Date.now() + cooldownDuration;
  console.warn(
    `[LLM Pool] Key for ${keyState.provider} (ending in ...${keyState.key.slice(-4)}) reached rate limit. Cooldown set for ${cooldownDuration / 1000}s.`
  );
}

/**
 * Executes prompt with Google Gemini using the active key
 */
async function callGemini(
  keyState: KeyState,
  systemInstruction: string,
  userPrompt: string,
  temperature: number = 0.0,
  signal?: AbortSignal
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: keyState.key });
  const model = process.env.VISION_MODEL || "gemini-2.5-flash";

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [{ text: `${systemInstruction}\n\n${userPrompt}` }],
        },
      ],
      config: {
        temperature,
        abortSignal: signal,
      },
    });

    return response.text || "";
  } catch (err: unknown) {
    if (signal?.aborted) throw err;
    const error = err as { status?: number; message?: string };
    // If model not found, fallback to gemini-1.5-flash
    if (error?.status === 404 || error?.message?.includes("not found")) {
      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: [
          {
            role: "user",
            parts: [{ text: `${systemInstruction}\n\n${userPrompt}` }],
          },
        ],
        config: {
          temperature,
          abortSignal: signal,
        },
      });
      return response.text || "";
    }
    throw err;
  }
}

/**
 * Executes prompt with Groq Cloud API using Llama 3.3 70B
 */
async function callGroq(
  keyState: KeyState,
  systemInstruction: string,
  userPrompt: string,
  temperature: number = 0.0,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${keyState.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_tokens: 2048,
    }),
    signal,
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    const error = new Error(`Groq API returned ${res.status}: ${errorBody}`) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  return text;
}

export interface LLMResponse {
  text: string;
  provider: "gemini" | "groq" | "deterministic";
  modelUsed: string;
}

/**
 * Central Multi-Provider LLM Router with Round-Robin load balancing and automated fallback cascade:
 *
 * 1. Tries Gemini Keys (Round-robin among healthy keys; rotates instantly on 429)
 * 2. If all Gemini keys are exhausted, switches to Groq Cloud Keys (Round-robin across Llama 3.3 70B)
 * 3. Returns null if all providers fail (caller uses deterministic fallback)
 */
export async function executeWithMultiProviderFallback(
  systemInstruction: string,
  userPrompt: string,
  timeoutMs: number = 4000
): Promise<LLMResponse | null> {
  initializePools();

  // ────────────────────────────────────────────────────────────
  // Phase 1: Try Gemini Key Pool with internal failover
  // ────────────────────────────────────────────────────────────
  const maxGeminiAttempts = Math.min(geminiKeys.length || 1, 5);
  for (let attempt = 0; attempt < maxGeminiAttempts; attempt++) {
    const key = getHealthyKey("gemini");
    if (!key) break; // All Gemini keys currently on cooldown

    const controller = new AbortController();
    try {
      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error("Gemini timeout limit reached"));
        }, timeoutMs);
      });

      const callPromise = callGemini(key, systemInstruction, userPrompt, 0.0, controller.signal);
      // Suppress unhandled rejection on the detached promise if timeoutPromise settles first
      callPromise.catch(() => {});

      const rawText = await Promise.race([callPromise, timeoutPromise]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });

      if (rawText && rawText.trim()) {
        key.totalCalls += 1;
        return {
          text: rawText,
          provider: "gemini",
          modelUsed: "gemini-2.5-flash",
        };
      }
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      const isQuota =
        error?.status === 429 ||
        error?.message?.includes("429") ||
        error?.message?.includes("quota") ||
        error?.message?.includes("Resource has been exhausted");

      setKeyCooldown(key, isQuota);
      console.warn(`[LLM Router] Gemini attempt ${attempt + 1} failed. Rotating to next key...`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Phase 2: All Gemini Keys Exhausted -> Seamless Groq Fallback
  // ────────────────────────────────────────────────────────────
  if (groqKeys.length > 0) {
    const maxGroqAttempts = Math.min(groqKeys.length, 5);
    for (let attempt = 0; attempt < maxGroqAttempts; attempt++) {
      const key = getHealthyKey("groq");
      if (!key) break; // All Groq keys on cooldown

      const controller = new AbortController();
      try {
        let timeoutId: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error("Groq timeout limit reached"));
          }, timeoutMs);
        });

        const callPromise = callGroq(key, systemInstruction, userPrompt, 0.0, controller.signal);
        // Suppress unhandled rejection on the detached promise if timeoutPromise settles first
        callPromise.catch(() => {});

        const rawText = await Promise.race([callPromise, timeoutPromise]).finally(() => {
          if (timeoutId) clearTimeout(timeoutId);
        });

        if (rawText && rawText.trim()) {
          key.totalCalls += 1;
          console.log(`[LLM Router] Successfully answered using Groq Llama 3.3 70B (Key ...${key.key.slice(-4)})`);
          return {
            text: rawText,
            provider: "groq",
            modelUsed: "llama-3.3-70b-versatile",
          };
        }
      } catch (err: unknown) {
        const error = err as { status?: number; message?: string };
        const isQuota = error?.status === 429 || error?.message?.includes("429");
        setKeyCooldown(key, isQuota);
        console.warn(`[LLM Router] Groq attempt ${attempt + 1} failed. Rotating to next Groq key...`);
      }
    }
  }

  // If all Gemini and Groq keys are exhausted, return null so caller executes deterministic fallback
  return null;
}

/**
 * Returns a currently active Gemini key for embeddings / vision tasks
 */
export function getActiveGeminiKey(): string {
  initializePools();
  const healthy = getHealthyKey("gemini");
  if (healthy) return healthy.key;
  return geminiKeys[0]?.key || process.env.GOOGLE_API_KEY || "";
}
