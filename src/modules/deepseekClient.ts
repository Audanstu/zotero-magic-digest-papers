import { ensureDefaultConfig, getConfig } from "./configService";

type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekChoice = {
  index?: number;
  message?: {
    role?: string;
    content?: string;
  };
  [key: string]: unknown;
};

type DeepSeekResponse = {
  id?: string;
  model?: string;
  choices?: DeepSeekChoice[];
  [key: string]: unknown;
};

function buildChatURL(baseURL: string): string {
  const b = baseURL.replace(/\/+$/, "");
  return `${b}/chat/completions`;
}

async function postJSON<T extends Record<string, unknown>>(
  url: string,
  body: Record<string, unknown>,
  apiKey: string,
): Promise<T> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`POST ${url} failed: ${resp.status} ${t}`);
  }

  return (await resp.json()) as unknown as T;
}

async function chat(messages: DeepSeekMessage[]): Promise<{
  model: string;
  content: string;
  raw: DeepSeekResponse;
}> {
  ensureDefaultConfig();
  const cfg = getConfig();

  if (!cfg.deepseekBaseURL) throw new Error("DeepSeek baseURL is empty");
  if (!cfg.deepseekAPIKey) throw new Error("DeepSeek apiKey is empty");
  if (!cfg.deepseekModel) throw new Error("DeepSeek model is empty");

  const url = buildChatURL(cfg.deepseekBaseURL);

  const body: Record<string, unknown> = {
    model: cfg.deepseekModel,
    messages,
    temperature: Number(cfg.deepseekTemperature || "0.2"),
    max_tokens: Number(cfg.deepseekMaxTokens || "4096"),
  };

  const raw = await postJSON<DeepSeekResponse>(url, body, cfg.deepseekAPIKey);
  const content = String(raw.choices?.[0]?.message?.content || "").trim();

  if (!content) {
    throw new Error(`DeepSeek response content is empty: ${JSON.stringify(raw)}`);
  }

  return {
    model: String(raw.model || cfg.deepseekModel),
    content,
    raw,
  };
}

export async function testDeepSeekConnection(): Promise<{
  model: string;
  content: string;
  raw: DeepSeekResponse;
}> {
  return chat([
    {
      role: "system",
      content: "You are a concise assistant.",
    },
    {
      role: "user",
      content: "Reply with exactly: DeepSeek connection ok.",
    },
  ]);
}

export async function generateReadingCardFromMarkdown(prompt: string): Promise<{
  model: string;
  content: string;
  raw: DeepSeekResponse;
}> {
  return chat([
    {
      role: "system",
      content:
        "You are an expert academic reading assistant. Produce accurate bilingual reading cards in Markdown.",
    },
    {
      role: "user",
      content: prompt,
    },
  ]);
}