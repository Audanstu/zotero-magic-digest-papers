export type VolcEngineMessageContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

export type VolcEngineMessage = {
  role: "user" | "assistant" | "system";
  content: VolcEngineMessageContent[];
};

export type VolcEngineRequest = {
  model: string;
  input: VolcEngineMessage[];
};

export type VolcEngineResponse = {
  id?: string;
  model?: string;
  output?: Array<{
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    code?: string;
    message?: string;
  };
};

function buildVolcEngineURL(baseURL: string): string {
  let url = String(baseURL || "").trim().replace(/\/+$/, "");

  if (url.endsWith("/api/v3/responses")) {
    return url;
  }

  if (url.endsWith("/api/v3")) {
    return url + "/responses";
  }

  return url + "/api/v3/responses";
}

function convertMessagesToVolcEngineInput(
  messages: Array<{ role: string; content: string | VolcEngineMessageContent[] }>,
): VolcEngineMessage[] {
  return messages.map((msg) => {
    const role = msg.role as "user" | "assistant" | "system";

    if (typeof msg.content === "string") {
      return {
        role,
        content: [{ type: "input_text", text: msg.content }],
      };
    }

    return {
      role,
      content: msg.content.map((item) => {
        if (item.type === "input_image") {
          return { type: "input_image", image_url: item.image_url };
        }

        return { type: "input_text", text: item.text || "" };
      }),
    };
  });
}

function extractVolcEngineContent(response: VolcEngineResponse): string {
  if (response.error) {
    throw new Error(
      `火山引擎 API 错误：${response.error.code || ""} ${response.error.message || ""}`,
    );
  }

  const output = response.output;
  if (!output || !output.length) {
    throw new Error("火山引擎返回了空 output");
  }

  const texts: string[] = [];

  for (const item of output) {
    if (item.content) {
      for (const part of item.content) {
        if (part.text) {
          texts.push(part.text);
        }
      }
    }
  }

  return texts.join("\n") || "(空响应)";
}

export async function chatWithVolcEngine(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string | VolcEngineMessageContent[] }>,
  options: {
    baseURL?: string;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{
  content: string;
  model: string;
  raw: VolcEngineResponse;
}> {
  const baseURL = options.baseURL || "https://ark.cn-beijing.volces.com/api/v3";
  const url = buildVolcEngineURL(baseURL);
  const timeoutMs = options.timeoutMs ?? 120000;

  const body: any = {
    model,
    input: convertMessagesToVolcEngineInput(messages),
  };

  if (options.temperature !== undefined) {
    body.temperature = options.temperature;
  }


  let fetchFn: typeof fetch | undefined = undefined;

  try {
    fetchFn = (globalThis as any).fetch;
  } catch {
    // ignore
  }

  if (typeof fetchFn !== "function") {
    throw new Error(
      "当前 Zotero 环境不支持 fetch。请确保 Zotero 版本 ≥ 7。",
    );
  }

  const AbortControllerCtor = (globalThis as any).AbortController as
    | (new () => AbortController)
    | undefined;

  const controller = AbortControllerCtor
    ? new AbortControllerCtor()
    : null;

  const timer = (globalThis as any).setTimeout(
    () => controller?.abort(),
    timeoutMs,
  );

  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    ...(options.signal || controller?.signal
      ? { signal: options.signal || controller?.signal! }
      : {}),
  };

  let res: Response;

  try {
    res = await fetchFn(url, init);
  } finally {
    (globalThis as any).clearTimeout?.(timer);
  }

  const text = await res.text();

  if (!res.ok) {
    throw new Error(
      `火山引擎请求失败 HTTP ${res.status}：${text.slice(0, 800)}`,
    );
  }

  let json: VolcEngineResponse;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`火山引擎返回不是 JSON：${text.slice(0, 800)}`);
  }

  const content = extractVolcEngineContent(json);

  return {
    content,
    model: json.model || model,
    raw: json,
  };
}

/**
 * 视觉理解：发送图片 + 文本到豆包模型
 */
export async function chatWithVolcEngineVision(
  apiKey: string,
  model: string,
  params: {
    imageUrl?: string;
    imageBase64?: string;
    prompt: string;
    baseURL?: string;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  },
): Promise<{
  content: string;
  model: string;
  raw: VolcEngineResponse;
}> {
  const baseURL = params.baseURL || "https://ark.cn-beijing.volces.com/api/v3";
  const url = buildVolcEngineURL(baseURL);
  const timeoutMs = params.timeoutMs ?? 120000;

  const content: VolcEngineMessageContent[] = [];

  if (params.imageUrl) {
    content.push({ type: "input_image", image_url: params.imageUrl });
  }

  if (params.imageBase64) {
    content.push({
      type: "input_image",
      image_url: `data:image/png;base64,${params.imageBase64}`,
    });
  }

  content.push({ type: "input_text", text: params.prompt });

  const body: any = {
    model,
    input: [
      {
        role: "user",
        content,
      },
    ],
  };

  if (params.temperature !== undefined) {
    body.temperature = params.temperature;
  }


  const fetchFn = (globalThis as any).fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("当前 Zotero 环境不支持 fetch。");
  }

  const AbortControllerCtor = (globalThis as any).AbortController as
    | (new () => AbortController)
    | undefined;

  const controller = AbortControllerCtor
    ? new AbortControllerCtor()
    : null;

  const timer = (globalThis as any).setTimeout(
    () => controller?.abort(),
    timeoutMs,
  );

  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
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
    throw new Error(
      `火山引擎视觉请求失败 HTTP ${res.status}：${text.slice(0, 800)}`,
    );
  }

  let json: VolcEngineResponse;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`火山引擎返回不是 JSON：${text.slice(0, 800)}`);
  }

  const result = extractVolcEngineContent(json);

  return {
    content: result,
    model: json.model || model,
    raw: json,
  };
}