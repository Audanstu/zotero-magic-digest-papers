import {
  chatWithModelConfig,
  getDefaultModelConfig,
  type MagicDigestModelConfig,
  type MagicDigestChatOptions,
  type MagicDigestChatResult,
} from "./modelApiSettings";
import { chatWithVolcEngine, chatWithVolcEngineVision } from "./volcengineClient";

export async function chat(
  config: MagicDigestModelConfig,
  messages: Array<{ role: string; content: string }>,
  options: MagicDigestChatOptions = {},
): Promise<MagicDigestChatResult> {
  if ((config.provider as string) === "volcengine-responses") {
    const result = await chatWithVolcEngine(
      config.apiKey,
      config.model,
      messages,
      {
        baseURL: config.baseURL,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      },
    );

    return {
      content: result.content,
      model: result.model || config.model,
      configID: config.id,
      configName: config.name,
      raw: result.raw,
    };
  }

  return chatWithModelConfig(config, messages as any, options);
}

export async function chatWithDefaultModel(
  messages: Array<{ role: string; content: string }>,
  options: MagicDigestChatOptions = {},
): Promise<MagicDigestChatResult> {
  const config = getDefaultModelConfig();

  if (!config) {
    throw new Error("未配置默认模型。请到 编辑 → 设置 → magic_digest 配置。");
  }

  return chat(config, messages, options);
}

// ==============================
// 视觉模型路由：支持火山引擎 + Qwen/OpenAI 兼容的视觉模型
// ==============================

export interface VisionChatParams {
  imageBase64: string;
  mimeType?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface VisionChatResult {
  content: string;
  model: string;
  configID: string;
  configName: string;
}

async function chatWithOpenAIVision(
  config: MagicDigestModelConfig,
  params: VisionChatParams,
): Promise<VisionChatResult> {
  let baseURL = String(config.baseURL || "").trim().replace(/\/+$/, "");
  let url: string;

  if (baseURL.endsWith("/chat/completions")) {
    url = baseURL;
  } else if (baseURL.endsWith("/v1")) {
    url = baseURL + "/chat/completions";
  } else {
    url = baseURL + "/v1/chat/completions";
  }

  const mime = params.mimeType || "image/png";
  const dataUrl = `data:${mime};base64,${params.imageBase64}`;

  const body: Record<string, any> = {
    model: config.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: params.prompt },
        ],
      },
    ],
    temperature: params.temperature ?? 0,
  };

  if (params.maxTokens) {
    body.max_tokens = params.maxTokens;
  }

  const timeoutMs = params.timeoutMs ?? 120000;

  const fetchFn = (globalThis as any).fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("当前 Zotero 环境不支持 fetch。");
  }

  const AbortControllerCtor = (globalThis as any).AbortController as
    | (new () => AbortController)
    | undefined;

  const controller = AbortControllerCtor ? new AbortControllerCtor() : null;

  const timer = (globalThis as any).setTimeout(
    () => controller?.abort(),
    timeoutMs,
  );

  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    ...(controller?.signal ? { signal: controller.signal } : {}),
  };

  let res: Response;

  try {
    res = await fetchFn(url, init);
  } finally {
    (globalThis as any).clearTimeout?.(timer);
  }

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`视觉请求失败 HTTP ${res.status}：${text.slice(0, 800)}`);
  }

  let json: any;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`视觉模型返回不是 JSON：${text.slice(0, 800)}`);
  }

  return {
    content: json?.choices?.[0]?.message?.content || "",
    model: json.model || config.model,
    configID: config.id,
    configName: config.name,
  };
}

export async function chatVision(
  config: MagicDigestModelConfig,
  params: VisionChatParams,
): Promise<VisionChatResult> {
  // 火山引擎视觉模型：使用专用 API
  if ((config.provider as string) === "volcengine-responses") {
    const result = await chatWithVolcEngineVision(
      config.apiKey,
      config.model,
      {
        baseURL: config.baseURL,
        imageBase64: params.imageBase64,
        prompt: params.prompt,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        timeoutMs: params.timeoutMs,
      },
    );

    return {
      content: result.content,
      model: result.model || config.model,
      configID: config.id,
      configName: config.name,
    };
  }

  // OpenAI 兼容视觉模型：Qwen、GPT-4V 等
  return chatWithOpenAIVision(config, params);
}
