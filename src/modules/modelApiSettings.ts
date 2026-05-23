import { chatWithVolcEngine, chatWithVolcEngineVision } from "./volcengineClient";

export type MagicDigestModelProvider = "openai-compatible" | "volcengine-responses";

export interface MagicDigestModelConfig {
  id: string;
  name: string;
  provider: MagicDigestModelProvider;
  baseURL: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MagicDigestChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface MagicDigestChatOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface MagicDigestChatResult {
  content: string;
  model: string;
  configID: string;
  configName: string;
  raw: any;
}

function nowISO(): string {
  return new Date().toISOString();
}

function makeID(prefix = "model"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeString(value: unknown): string {
  return String(value || "").trim();
}

function normalizeBaseURL(baseURL: string): string {
  return String(baseURL || "").trim().replace(/\/+$/, "");
}

const PREF_MODEL_CONFIGS = "extensions.magic_digest.modelConfigs";
const PREF_DEFAULT_MODEL_ID = "extensions.magic_digest.defaultModelId";
const PREF_DEFAULT_VISION_MODEL_ID = "extensions.magic_digest.defaultVisionModelId";

function getPrefs(): any {
  return (globalThis as any).Zotero?.Prefs || Zotero?.Prefs;
}

function prefGet(key: string, fallback: string = ""): string {
  try {
    const v = getPrefs().get(key, true);
    if (v !== undefined && v !== null) return String(v);
  } catch { /* ignore */ }
  try {
    const v = getPrefs().get(key);
    if (v !== undefined && v !== null) return String(v);
  } catch { /* ignore */ }
  return fallback;
}

function prefSet(key: string, value: string): void {
  try {
    getPrefs().set(key, String(value), true);
  } catch {
    getPrefs().set(key, String(value));
  }
}

export function createDeepSeekTemplate(): MagicDigestModelConfig {
  const t = nowISO();
  return {
    id: "deepseek-default",
    name: "DeepSeek",
    provider: "openai-compatible",
    baseURL: "https://api.deepseek.com",
    apiKey: "",
    model: "deepseek-chat",
    enabled: true,
    createdAt: t,
    updatedAt: t,
  };
}

function sanitizeModelConfig(
  input: Partial<MagicDigestModelConfig>,
): MagicDigestModelConfig {
  const t = nowISO();
  const base = normalizeBaseURL(input.baseURL || "");

  // auto-detect volcengine provider
  const autoProvider: MagicDigestModelProvider =
    base.includes("ark.cn-beijing.volces.com")
      ? "volcengine-responses"
      : "openai-compatible";

  return {
    id: safeString(input.id) || makeID("model"),
    name: safeString(input.name) || "Unnamed",
    provider: autoProvider === "volcengine-responses" ? autoProvider : input.provider || autoProvider,
    baseURL: base,
    apiKey: safeString(input.apiKey),
    model: safeString(input.model),
    enabled: input.enabled !== false,
    createdAt: safeString(input.createdAt) || t,
    updatedAt: t,
  };
}

export function getModelConfigs(): MagicDigestModelConfig[] {
  const raw = prefGet(PREF_MODEL_CONFIGS, "");
  if (!raw) return [createDeepSeekTemplate()];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [createDeepSeekTemplate()];
    const configs = parsed.map(sanitizeModelConfig).slice(0, 8);
    if (!configs.length) return [createDeepSeekTemplate()];
    return configs;
  } catch {
    return [createDeepSeekTemplate()];
  }
}

export function saveModelConfigs(configs: MagicDigestModelConfig[]): void {
  prefSet(PREF_MODEL_CONFIGS, JSON.stringify(configs.map(sanitizeModelConfig).slice(0, 8)));
}

export function getDefaultModelId(): string {
  const id = prefGet(PREF_DEFAULT_MODEL_ID, "");
  if (id) return id;
  const configs = getModelConfigs();
  const first = configs.find((x) => x.enabled) || configs[0];
  return first?.id || "deepseek-default";
}

export function setDefaultModelId(id: string): void {
  prefSet(PREF_DEFAULT_MODEL_ID, id);
}

export function getDefaultModelConfig(): MagicDigestModelConfig | null {
  const configs = getModelConfigs();
  const id = getDefaultModelId();
  return configs.find((x) => x.id === id && x.enabled) ||
    configs.find((x) => x.enabled) ||
    configs[0] ||
    null;
}

export async function chatWithModelConfig(
  config: MagicDigestModelConfig,
  messages: MagicDigestChatMessage[],
  options: MagicDigestChatOptions = {},
): Promise<MagicDigestChatResult> {
  if (!config.enabled) {
    throw new Error(`Model disabled: ${config.name}`);
  }

  // ===== Volcengine provider =====
  if (
    (config.provider as string) === "volcengine-responses" ||
    normalizeBaseURL(config.baseURL).includes("ark.cn-beijing.volces.com")
  ) {
    const result = await chatWithVolcEngine(
      config.apiKey,
      config.model,
      messages as Array<{ role: string; content: string }>,
      {
        baseURL: config.baseURL,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        timeoutMs: options.timeoutMs ?? 120000,
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

  // ===== OpenAI-compatible provider =====
  const baseURL = normalizeBaseURL(config.baseURL);
  let url: string;

  if (baseURL.endsWith("/chat/completions")) {
    url = baseURL;
  } else if (baseURL.endsWith("/v1")) {
    url = baseURL + "/chat/completions";
  } else {
    url = baseURL + "/v1/chat/completions";
  }

  const body: Record<string, any> = {
    model: config.model,
    messages,
    temperature: options.temperature ?? 0.2,
  };

  if (options.maxTokens) {
    body.max_tokens = options.maxTokens;
  }

  const timeoutMs = options.timeoutMs ?? 120000;

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
    ...(options.signal || controller?.signal
      ? { signal: options.signal || controller?.signal! }
      : {}),
  };

  let res: Response;

  try {
    res = await fetch(url, init);
  } finally {
    (globalThis as any).clearTimeout?.(timer);
  }

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
  }

  let json: any;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Not JSON: ${text.slice(0, 800)}`);
  }

  return {
    content: json?.choices?.[0]?.message?.content || "",
    model: json.model || config.model,
    configID: config.id,
    configName: config.name,
    raw: json,
  };
}

export async function chatWithDefaultModel(
  messages: MagicDigestChatMessage[],
  options: MagicDigestChatOptions = {},
): Promise<MagicDigestChatResult> {
  const config = getDefaultModelConfig();
  if (!config) throw new Error("No default model configured.");
  return chatWithModelConfig(config, messages, options);
}

export async function testModelConnection(
  config: MagicDigestModelConfig,
): Promise<MagicDigestChatResult> {
  return chatWithModelConfig(
    config,
    [
      { role: "system", content: "You are a connectivity test assistant." },
      { role: "user", content: "Reply only: magic_digest connection OK." },
    ],
    { temperature: 0, maxTokens: 80, timeoutMs: 30000 },
  );
}
/**
 * Mask API key for display
 */
export function maskAPIKey(key: string): string {
  const s = String(key || "");
  if (!s) return "";
  if (s.length <= 8) return "*".repeat(s.length);
  return s.slice(0, 4) + "*".repeat(s.length - 8) + s.slice(-4);
}

/**
 * Delete a model config by id or config object
 */
export function deleteModelConfig(
  configsOrId: MagicDigestModelConfig[] | MagicDigestModelConfig | string,
  config?: MagicDigestModelConfig,
): MagicDigestModelConfig[] | void {
  // 新版：deleteModelConfig(configs, config)
  if (Array.isArray(configsOrId) && config) {
    return configsOrId.filter((c) => c.id !== config.id);
  }

  // 旧版：deleteModelConfig(id) 或 deleteModelConfig(config)
  let id = "";

  if (typeof configsOrId === "string") {
    id = configsOrId;
  } else if (!Array.isArray(configsOrId)) {
    id = configsOrId.id;
  }

  if (!id) return;

  const all = getModelConfigs();
  const filtered = all.filter((c) => c.id !== id);
  saveModelConfigs(filtered);
}

/**
 * Insert or update a model config.
 * Can be called as upsertModelConfig(configs, config) or upsertModelConfig(config).
 */
export function upsertModelConfig(
  configsOrConfig: MagicDigestModelConfig[] | MagicDigestModelConfig,
  maybeConfig?: MagicDigestModelConfig,
): MagicDigestModelConfig[] | void {
  // 新版：upsertModelConfig(configs, config)
  if (Array.isArray(configsOrConfig) && maybeConfig) {
    const configs = configsOrConfig;
    const config = maybeConfig;
    const idx = configs.findIndex((c) => c.id === config.id);
    if (idx >= 0) {
      configs[idx] = config;
    } else {
      configs.push(config);
    }
    return configs;
  }

  // 旧版：upsertModelConfig(config) → 直接保存到 Prefs
  const config = configsOrConfig as MagicDigestModelConfig;
  const all = getModelConfigs();
  const idx = all.findIndex((c) => c.id === config.id);
  if (idx >= 0) {
    all[idx] = config;
  } else {
    all.push(config);
  }
  saveModelConfigs(all);
}

export function getDefaultVisionModelId(): string {
  const id = prefGet(PREF_DEFAULT_VISION_MODEL_ID, "");
  if (id) return id;

  const configs = getModelConfigs();
  const firstVision =
    configs.find((x) =>
      x.enabled &&
      (
        (x.provider as string) === "volcengine-responses" ||
        normalizeBaseURL(x.baseURL).includes("ark.cn-beijing.volces.com")
      )
    ) || configs.find((x) => x.enabled);

  return firstVision?.id || "";
}

export function setDefaultVisionModelId(id: string): void {
  prefSet(PREF_DEFAULT_VISION_MODEL_ID, id);
}

export function getDefaultVisionModelConfig(): MagicDigestModelConfig | null {
  const configs = getModelConfigs();
  const id = getDefaultVisionModelId();

  return configs.find((x) => x.id === id && x.enabled) ||
    configs.find((x) =>
      x.enabled &&
      (
        (x.provider as string) === "volcengine-responses" ||
        normalizeBaseURL(x.baseURL).includes("ark.cn-beijing.volces.com")
      )
    ) ||
    null;
}

export async function testVisionModelConnection(
  config: MagicDigestModelConfig,
): Promise<MagicDigestChatResult> {
  const isVolc =
    (config.provider as string) === "volcengine-responses" ||
    normalizeBaseURL(config.baseURL).includes("ark.cn-beijing.volces.com");

  if (!isVolc) {
    throw new Error("This image test currently requires Volcengine Ark Responses API.");
  }

  const result = await chatWithVolcEngineVision(
    config.apiKey,
    config.model,
    {
      baseURL: config.baseURL,
      imageUrl: "https://ark-project.tos-cn-beijing.volces.com/doc_image/ark_demo_img_1.png",
      prompt: "Please describe this image briefly. Reply in one short sentence.",
      temperature: 0,
      timeoutMs: 60000,
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
