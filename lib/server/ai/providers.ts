export type AiProviderName = "openai" | "gemini" | "claude";

export type ProviderRequest = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
  /**
   * Sampling temperature. Defaults to 0.2 (combined CV+cover gen).
   * Caller should bump to 0.3-0.4 for cover-only rewrites.
   */
  temperature?: number;
  /** Per-call max-output ceiling. Defaults to 900 (matches old behavior). */
  maxTokens?: number;
};

export const DEFAULT_MODELS: Record<AiProviderName, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash-lite",
  claude: "claude-3-5-sonnet",
};

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 900;

// Lightweight retry policy — only for transient HTTP statuses where the
// upstream is asking us to back off (429 / 502 / 503 / 504). Other
// failures (4xx auth, malformed body) are surfaced immediately so the
// caller's fallback path (e.g. swap to default model) can kick in.
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRY_ATTEMPTS = 2;
const BASE_BACKOFF_MS = 400;

export function getDefaultModel(provider: AiProviderName) {
  return DEFAULT_MODELS[provider];
}

function normalizeOpenAiModel(rawModel: string) {
  const normalized = rawModel.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!normalized) return getDefaultModel("openai");
  if (normalized.includes("gpt-5") && normalized.includes("mini")) {
    return "gpt-5-mini";
  }
  return normalized;
}

function normalizeGeminiModel(rawModel: string) {
  const normalized = rawModel.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!normalized) return getDefaultModel("gemini");
  if (normalized === "gemini-2.5-flash-lite") return "gemini-2.5-flash-lite";
  if (normalized === "gemini-2.5-flash") return "gemini-2.5-flash";
  if (normalized === "gemini-2.5-pro") return "gemini-2.5-pro";
  if (normalized === "gemini-2.0-flash") return "gemini-2.0-flash";
  if (normalized === "gemini-2.0-flash-lite") return "gemini-2.0-flash-lite";
  return normalized;
}

function normalizeClaudeModel(rawModel: string) {
  const normalized = rawModel.trim();
  return normalized || getDefaultModel("claude");
}

export function normalizeProviderModel(provider: AiProviderName, model: string) {
  if (provider === "openai") {
    return normalizeOpenAiModel(model);
  }
  if (provider === "claude") {
    return normalizeClaudeModel(model);
  }
  return normalizeGeminiModel(model);
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  errorPrefix: string,
): Promise<Response> {
  let lastResponse: Response | null = null;
  let lastErrorBody = "";
  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    const response = await fetch(url, init);
    if (response.ok) return response;
    if (!RETRY_STATUSES.has(response.status) || attempt === MAX_RETRY_ATTEMPTS) {
      lastResponse = response;
      try {
        lastErrorBody = (await response.text()).slice(0, 400);
      } catch {
        lastErrorBody = "";
      }
      break;
    }
    // Exponential backoff with jitter — gives the upstream room to
    // recover from a 429 / 503 spike without hammering it.
    const backoff = BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 100;
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }
  const status = lastResponse?.status ?? 0;
  throw new Error(
    `${errorPrefix}_${status}${lastErrorBody ? `:${lastErrorBody}` : ""}`,
  );
}

export async function callOpenAI(request: ProviderRequest) {
  const response = await fetchWithRetry(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        temperature: request.temperature ?? DEFAULT_TEMPERATURE,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
        ],
      }),
      signal: request.signal,
    },
    "OPENAI",
  );

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}

export async function callGemini(request: ProviderRequest) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${request.model}:generateContent?key=${request.apiKey}`;
  const response = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: request.systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: request.userPrompt }],
          },
        ],
        generationConfig: {
          temperature: request.temperature ?? DEFAULT_TEMPERATURE,
          maxOutputTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          responseMimeType: "application/json",
        },
      }),
      signal: request.signal,
    },
    "GEMINI",
  );

  const json = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

export async function callClaude(request: ProviderRequest) {
  const response = await fetchWithRetry(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": request.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: request.temperature ?? DEFAULT_TEMPERATURE,
        system: request.systemPrompt,
        messages: [{ role: "user", content: request.userPrompt }],
      }),
      signal: request.signal,
    },
    "CLAUDE",
  );

  const json = (await response.json()) as {
    content?: Array<{ text?: string }>;
  };
  return json.content?.[0]?.text ?? "";
}

export async function callProvider(
  provider: AiProviderName,
  request: ProviderRequest,
) {
  if (provider === "openai") {
    return callOpenAI(request);
  }
  if (provider === "claude") {
    return callClaude(request);
  }
  return callGemini(request);
}
