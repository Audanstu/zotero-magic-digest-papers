import { getConfig } from "./configService";
import {
  createEmptyAnalysis,
  type MagicDigestAnalysis,
  type MagicDigestCard,
  type MagicDigestCardType,
} from "./analysisSchema";
import {
  writeAnalysisFile,
  writeReadingCardDraftFile,
} from "./magicDigestAnalysisCache";
import { buildAnalysisInputFromMineruOutput } from "./mineruOutputToAnalysisInput";
import { buildChunkPaperAnalysisPrompt } from "./paperAnalysisPrompt";
import { resolveLlmForZoteroMineruOutputForItem } from "./llmForZoteroMineruProvider";

type AnalysisProgressEvent = {
  stage:
    | "resolve-cache"
    | "build-input"
    | "chunk-start"
    | "chunk-success"
    | "chunk-failed"
    | "merge"
    | "write"
    | "done";
  message: string;
  current?: number;
  total?: number;
  progress?: number;
};

type AnalysisProgressCallback = (event: AnalysisProgressEvent) => void;

type RawModelCard = {
  type?: string;
  title?: string;
  anchorText?: string;
  content?: string;
  importance?: number;
  tags?: string[];
};

type RawModelPageCards = {
  page?: number;
  left?: RawModelCard[];
  right?: RawModelCard[];
};

type RawModelAnalysis = {
  globalPanel?: {
    titleCard?: string;
    backgroundAndProblem?: string;
    coreInnovations?: string[];
    methodOverview?: string[];
    mainFindings?: string[];
    limitations?: string[];
  };
  pageCards?: RawModelPageCards[];
  boardNodesDraft?: Array<{
    type?: string;
    title?: string;
    content?: string;
    page?: number | null;
  }>;
};

class MagicDigestAnalysisError extends Error {
  detail: string;

  constructor(message: string, detail = "") {
    super(message);
    this.name = "MagicDigestAnalysisError";
    this.detail = detail;
  }
}

function report(
  cb: AnalysisProgressCallback | undefined,
  event: AnalysisProgressEvent,
) {
  try {
    cb?.(event);
  } catch {
    // ignore progress UI errors
  }
}

function buildChatURL(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, "")}/chat/completions`;
}

async function postDeepSeek(prompt: string): Promise<string> {
  const cfg = getConfig();

  if (!cfg.deepseekAPIKey) {
    throw new MagicDigestAnalysisError(
      "DeepSeek API Key 为空",
      "请先在 magic_digest 设置中填写 DeepSeek API Key。",
    );
  }

  if (!cfg.deepseekBaseURL) {
    throw new MagicDigestAnalysisError(
      "DeepSeek Base URL 为空",
      "请先在 magic_digest 设置中填写 DeepSeek Base URL。",
    );
  }

  if (!cfg.deepseekModel) {
    throw new MagicDigestAnalysisError(
      "DeepSeek Model 为空",
      "请先在 magic_digest 设置中填写 DeepSeek Model。",
    );
  }

  const url = buildChatURL(cfg.deepseekBaseURL);

  const body = {
    model: cfg.deepseekModel,
    messages: [
      {
        role: "system",
        content:
          "你是严格输出 JSON 的科研论文结构化分析助手。不要输出 Markdown，不要代码块。",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: Number(cfg.deepseekTemperature || "0.2"),
    max_tokens: Number(cfg.deepseekMaxTokens || "4096"),
  };

  let xhr: Awaited<ReturnType<typeof Zotero.HTTP.request>>;

  try {
    xhr = await Zotero.HTTP.request("POST", url, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${cfg.deepseekAPIKey}`,
      },
      body: JSON.stringify(body),
      responseType: "arraybuffer",
      successCodes: false,
      timeout: 180000,
    });
  } catch (e: any) {
    const msg = String(e?.message || e || "");

    if (/timed out/i.test(msg) || /timeout/i.test(msg)) {
      throw new MagicDigestAnalysisError(
        "DeepSeek 请求超时",
        "当前分块在 180 秒内没有返回。建议稍后重试，或后续把分块大小调小。",
      );
    }

    throw new MagicDigestAnalysisError(
      "DeepSeek 请求失败",
      msg || "未知网络错误",
    );
  }

  let responseText = "";

  try {
    const buffer = xhr.response as ArrayBuffer;
    if (!buffer) {
      throw new Error("response is empty");
    }
    responseText = new TextDecoder("utf-8").decode(new Uint8Array(buffer));
  } catch (e: any) {
    throw new MagicDigestAnalysisError(
      "DeepSeek 响应解码失败",
      String(e?.message || e || "未知解码错误"),
    );
  }

  if (xhr.status < 200 || xhr.status >= 300) {
    throw new MagicDigestAnalysisError(
      `DeepSeek HTTP ${xhr.status}`,
      responseText || "无响应正文",
    );
  }

  let raw: {
    choices?: Array<{ message?: { content?: string } }>;
  };

  try {
    raw = JSON.parse(responseText || "{}") as {
      choices?: Array<{ message?: { content?: string } }>;
    };
  } catch {
    throw new MagicDigestAnalysisError(
      "DeepSeek 响应不是合法 JSON",
      responseText.slice(0, 1000) || "",
    );
  }

  const content = String(raw.choices?.[0]?.message?.content || "").trim();
  if (!content) {
    throw new MagicDigestAnalysisError(
      "DeepSeek 返回内容为空",
      responseText.slice(0, 1000) || "",
    );
  }

  return content;
}

function extractJSON(text: string): RawModelAnalysis {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed) as RawModelAnalysis;
  } catch {
    // fallback
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim()) as RawModelAnalysis;
    } catch {
      // fallback
    }
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1)) as RawModelAnalysis;
    } catch {
      // fallback
    }
  }

  throw new MagicDigestAnalysisError(
    "无法从 DeepSeek 输出中解析 JSON",
    trimmed.slice(0, 1500),
  );
}

function editable(aiOriginal: string) {
  return {
    aiOriginal: String(aiOriginal || "").trim(),
    userEdited: "",
    edited: false,
    editedAt: null,
  };
}

function normalizeCardType(value: unknown): MagicDigestCardType {
  const s = String(value || "").trim();
  const allowed: MagicDigestCardType[] = [
    "background",
    "method",
    "result",
    "insight",
    "figure",
    "table",
    "limitation",
    "quote",
    "term",
    "comparison",
  ];
  return allowed.includes(s as MagicDigestCardType)
    ? (s as MagicDigestCardType)
    : "insight";
}

function normalizeBoardNodeType(
  value: unknown,
): MagicDigestAnalysis["boardNodesDraft"][number]["type"] {
  const s = String(value || "").trim();
  const allowed: MagicDigestAnalysis["boardNodesDraft"][number]["type"][] = [
    "paper",
    "background",
    "method",
    "result",
    "limitation",
    "figure",
    "table",
    "insight",
  ];
  return allowed.includes(s as never) ? (s as any) : "insight";
}

function convertCard(params: {
  raw: RawModelCard;
  page: number;
  side: "left" | "right";
  index: number;
}): MagicDigestCard {
  const type = normalizeCardType(params.raw.type);
  return {
    id: `p${params.page}-${params.side}-${type}-${params.index}`,
    page: params.page,
    side: params.side,
    type,
    title: String(params.raw.title || "").trim(),
    anchorText: String(params.raw.anchorText || "").trim(),
    source: "deepseek",
    importance: Number(params.raw.importance || 50),
    content: editable(String(params.raw.content || "")),
    tags: Array.isArray(params.raw.tags)
      ? params.raw.tags.map((x) => String(x)).filter(Boolean)
      : [],
  };
}

function uniquePush(list: string[], value: string) {
  const s = String(value || "").trim();
  if (!s) return;
  if (!list.includes(s)) list.push(s);
}

function mergeStringArrays(target: string[], source?: string[]) {
  if (!Array.isArray(source)) return;
  for (const item of source) uniquePush(target, String(item || ""));
}

function buildReadingCardMarkdown(params: {
  title: string;
  globalPanel: MagicDigestAnalysis["globalPanel"];
  pageCards: MagicDigestAnalysis["pageCards"];
}): string {
  const lines: string[] = [];

  lines.push(`# 双语阅读卡 / Bilingual Reading Card`);
  lines.push("");
  lines.push(`## 1. 论文信息 / Paper Information`);
  lines.push(`- 标题 / Title: ${params.title || "Unknown"}`);
  lines.push("");

  lines.push(`## 2. 一句话总结 / One-sentence Summary`);
  lines.push(`中文：${params.globalPanel.titleCard.aiOriginal || "未生成"}`);
  lines.push(`English: ${params.globalPanel.titleCard.aiOriginal || "Not generated"}`);
  lines.push("");

  lines.push(`## 3. 研究背景与问题 / Background and Problem`);
  lines.push(`中文：${params.globalPanel.backgroundAndProblem.aiOriginal || "未生成"}`);
  lines.push(`English: ${params.globalPanel.backgroundAndProblem.aiOriginal || "Not generated"}`);
  lines.push("");

  lines.push(`## 4. 核心创新点 / Core Innovations`);
  for (const item of params.globalPanel.coreInnovations) {
    lines.push(`- ${item.aiOriginal || ""}`);
  }
  if (!params.globalPanel.coreInnovations.length) lines.push(`- 未生成`);
  lines.push("");

  lines.push(`## 5. 方法概述 / Method Overview`);
  for (const item of params.globalPanel.methodOverview) {
    lines.push(`- ${item.aiOriginal || ""}`);
  }
  if (!params.globalPanel.methodOverview.length) lines.push(`- 未生成`);
  lines.push("");

  lines.push(`## 6. 主要发现 / Main Findings`);
  for (const item of params.globalPanel.mainFindings) {
    lines.push(`- ${item.aiOriginal || ""}`);
  }
  if (!params.globalPanel.mainFindings.length) lines.push(`- 未生成`);
  lines.push("");

  lines.push(`## 7. 局限性 / Limitations`);
  for (const item of params.globalPanel.limitations) {
    lines.push(`- ${item.aiOriginal || ""}`);
  }
  if (!params.globalPanel.limitations.length) lines.push(`- 未生成`);
  lines.push("");

  lines.push(`## 8. 分页卡片 / Page Cards`);
  for (const pageCard of params.pageCards) {
    lines.push(`### Page ${pageCard.page + 1}`);
    const left = pageCard.left.slice(0, 3);
    const right = pageCard.right.slice(0, 3);
    if (left.length) {
      lines.push(`- Left:`);
      for (const c of left) {
        lines.push(`  - [${c.type}] ${c.title}: ${c.content.aiOriginal}`);
      }
    }
    if (right.length) {
      lines.push(`- Right:`);
      for (const c of right) {
        lines.push(`  - [${c.type}] ${c.title}: ${c.content.aiOriginal}`);
      }
    }
  }

  return lines.join("\n").trim();
}

function buildAnalysisFromChunks(params: {
  attachmentItemID: number;
  pdfHash: string;
  chunks: RawModelAnalysis[];
  textModel: string;
  visionModel: string;
  skippedPages: number[];
  includeVision: boolean;
  maxVisionImages: number;
  title: string;
}): MagicDigestAnalysis {
  const analysis = createEmptyAnalysis({
    pdfHash: params.pdfHash,
    textModel: params.textModel,
    visionModel: params.visionModel,
    skippedPages: params.skippedPages,
    includeVision: params.includeVision,
    maxVisionImages: params.maxVisionImages,
  });

  const gpTitle: string[] = [];
  const gpBackground: string[] = [];
  const gpInnovations: string[] = [];
  const gpMethods: string[] = [];
  const gpFindings: string[] = [];
  const gpLimitations: string[] = [];

  const pageMap = new Map<
    number,
    {
      page: number;
      skipped: boolean;
      left: MagicDigestCard[];
      right: MagicDigestCard[];
    }
  >();

  const boardNodes: MagicDigestAnalysis["boardNodesDraft"] = [];

  for (const chunk of params.chunks) {
    const gp = chunk.globalPanel || {};

    if (gp.titleCard) uniquePush(gpTitle, gp.titleCard);
    if (gp.backgroundAndProblem)
      uniquePush(gpBackground, gp.backgroundAndProblem);
    mergeStringArrays(gpInnovations, gp.coreInnovations);
    mergeStringArrays(gpMethods, gp.methodOverview);
    mergeStringArrays(gpFindings, gp.mainFindings);
    mergeStringArrays(gpLimitations, gp.limitations);

    for (const pc of chunk.pageCards || []) {
      const page = Number.isFinite(Number(pc.page))
        ? Math.floor(Number(pc.page))
        : 0;
      const existing = pageMap.get(page) || {
        page,
        skipped: params.skippedPages.includes(page),
        left: [],
        right: [],
      };

      if (Array.isArray(pc.left)) {
        pc.left.forEach((card) => {
          existing.left.push(
            convertCard({
              raw: card,
              page,
              side: "left",
              index: existing.left.length,
            }),
          );
        });
      }

      if (Array.isArray(pc.right)) {
        pc.right.forEach((card) => {
          existing.right.push(
            convertCard({
              raw: card,
              page,
              side: "right",
              index: existing.right.length,
            }),
          );
        });
      }

      pageMap.set(page, existing);
    }

    if (Array.isArray(chunk.boardNodesDraft)) {
      for (const node of chunk.boardNodesDraft) {
        boardNodes.push({
          id: `draft-node-${boardNodes.length}`,
          sourceCardId: "",
          type: normalizeBoardNodeType(node.type),
          title: String(node.title || "").trim(),
          content: String(node.content || "").trim(),
          page:
            node.page === null || node.page === undefined
              ? null
              : Math.floor(Number(node.page || 0)),
          selected: false,
        });
      }
    }
  }

  analysis.globalPanel.titleCard = editable(gpTitle.join(" / "));
  analysis.globalPanel.backgroundAndProblem = editable(
    gpBackground.join("\n\n"),
  );
  analysis.globalPanel.coreInnovations = gpInnovations.map((x) => editable(x));
  analysis.globalPanel.methodOverview = gpMethods.map((x) => editable(x));
  analysis.globalPanel.mainFindings = gpFindings.map((x) => editable(x));
  analysis.globalPanel.limitations = gpLimitations.map((x) => editable(x));

  analysis.pageCards = [...pageMap.values()].sort((a, b) => a.page - b.page);
  analysis.boardNodesDraft = boardNodes;

  analysis.readingCardDraft = editable(
    buildReadingCardMarkdown({
      title: params.title,
      globalPanel: analysis.globalPanel,
      pageCards: analysis.pageCards,
    }),
  );

  return analysis;
}

function splitIntoChunks<T>(items: T[], chunkSize: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    result.push(items.slice(i, i + chunkSize));
  }
  return result;
}

export function formatAnalysisError(e: any): string {
  if (e instanceof MagicDigestAnalysisError) {
    return e.detail ? `${e.message}：${e.detail}` : e.message;
  }

  const msg = String(e?.message || e || "未知错误");

  if (/timed out/i.test(msg) || /timeout/i.test(msg)) {
    return "DeepSeek 请求超时：当前分块响应时间过长。建议稍后重试，或后续调小分块大小。";
  }

  if (/api key/i.test(msg) || /401/.test(msg)) {
    return "DeepSeek 鉴权失败：请检查 API Key 是否正确。";
  }

  if (/429/.test(msg)) {
    return "DeepSeek 请求过于频繁或额度受限：请稍后重试。";
  }

  if (/JSON/i.test(msg)) {
    return `模型输出 JSON 解析失败：${msg}`;
  }

  return msg;
}

export async function generateAnalysisForSelectedItem(
  onProgress?: AnalysisProgressCallback,
): Promise<{
  attachmentItemID: number;
  analysisPath: string;
  readingCardPath: string;
}> {
  const win = Zotero.getMainWindow();
  const item = win.ZoteroPane.getSelectedItems()?.[0];

  if (!item) throw new Error("请先选中一条文献或 PDF 附件");

  report(onProgress, {
    stage: "resolve-cache",
    message: "正在读取 llm-for-zotero MinerU 缓存...",
    progress: 5,
  });

  const output = await resolveLlmForZoteroMineruOutputForItem(item);
  if (!output) {
    throw new MagicDigestAnalysisError(
      "未找到 llm-for-zotero MinerU 缓存",
      "请先用 llm-for-zotero 对该 PDF 执行 MinerU 解析。",
    );
  }

  report(onProgress, {
    stage: "build-input",
    message: "正在构建分页分析输入...",
    progress: 10,
  });

  const cfg = getConfig();

  const inputBundle = await buildAnalysisInputFromMineruOutput({
    output,
    skippedPages: [],
  });

  // 每批 4 页（原来 2 页），减少 API 调用次数
  const chunkSize = 4;
  const chunks = splitIntoChunks(inputBundle.pages, chunkSize);
  const rawChunks: RawModelAnalysis[] = [];

  if (!chunks.length) {
    throw new MagicDigestAnalysisError(
      "没有可分析的文本内容",
      "content_list.json 和 full.md 都没有生成可用文本。",
    );
  }

  // 并行批处理：每批同时发 3 个请求，大幅加速
  const PARALLEL_BATCH = 3;

  for (let batchStart = 0; batchStart < chunks.length; batchStart += PARALLEL_BATCH) {
    const batchEnd = Math.min(batchStart + PARALLEL_BATCH, chunks.length);
    const batchTasks: Array<Promise<{ index: number; raw: RawModelAnalysis }>> = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const chunkPages = chunks[i];
      const chunkPageSet = new Set(chunkPages.map((p) => p.page));

      const figures = inputBundle.figures.filter((f) => chunkPageSet.has(f.page));
      const tables = inputBundle.tables.filter((t) => chunkPageSet.has(t.page));

      const startDisplay = chunkPages[0]?.displayPage;
      const endDisplay = chunkPages[chunkPages.length - 1]?.displayPage;

      report(onProgress, {
        stage: "chunk-start",
        message: `正在分析第 ${i + 1}/${chunks.length} 个分块（第 ${startDisplay}-${endDisplay} 页）...`,
        current: i + 1,
        total: chunks.length,
        progress: Math.round(10 + (i / chunks.length) * 75),
      });

      const manifestSummaryLines = [
        `totalPages: ${inputBundle.totalPages}`,
        `pages in current chunk: ${chunkPages
          .map((p) => p.displayPage)
          .join(", ")}`,
      ];

      const prompt = buildChunkPaperAnalysisPrompt({
        title: inputBundle.title,
        chunkIndex: i,
        chunkTotal: chunks.length,
        pages: chunkPages,
        figures,
        tables,
        manifestSummary: `${inputBundle.rawManifestSummary}\n\n${manifestSummaryLines.join(
          "\n",
        )}`,
      });

      batchTasks.push(
        postDeepSeek(prompt).then(
          (modelText) => {
            const raw = extractJSON(modelText);
            report(onProgress, {
              stage: "chunk-success",
              message: `第 ${i + 1}/${chunks.length} 个分块分析完成`,
              current: i + 1,
              total: chunks.length,
              progress: Math.round(10 + ((i + 1) / chunks.length) * 75),
            });
            return { index: i, raw };
          },
          (e: any) => {
            const msg = formatAnalysisError(e);
            report(onProgress, {
              stage: "chunk-failed",
              message: `第 ${i + 1}/${chunks.length} 个分块失败：${msg}`,
              current: i + 1,
              total: chunks.length,
              progress: Math.round(10 + (i / chunks.length) * 75),
            });
            throw new MagicDigestAnalysisError(
              `第 ${i + 1}/${chunks.length} 个分块分析失败`,
              msg,
            );
          },
        ),
      );
    }

    // 等待当前批次全部完成
    const batchResults = await Promise.all(batchTasks);

    // 按原始索引排序结果
    batchResults.sort((a, b) => a.index - b.index);

    for (const { raw } of batchResults) {
      rawChunks.push(raw);
    }
  }

  report(onProgress, {
    stage: "merge",
    message: "正在合并所有分块结果...",
    progress: 90,
  });

  const analysis = buildAnalysisFromChunks({
    attachmentItemID: output.attachmentItemID,
    pdfHash: String(output.attachmentItemID),
    chunks: rawChunks,
    textModel: cfg.deepseekModel,
    visionModel: "doubao-seed-2-0-lite-260428",
    skippedPages: [],
    includeVision: false,
    maxVisionImages: 10,
    title: inputBundle.title,
  });

  report(onProgress, {
    stage: "write",
    message: "正在写入 analysis.json 和 reading-card-draft.md...",
    progress: 95,
  });

  const analysisPath = await writeAnalysisFile(output.attachmentItemID, analysis);
  const readingCardPath = await writeReadingCardDraftFile(
    output.attachmentItemID,
    analysis.readingCardDraft.aiOriginal,
  );

  report(onProgress, {
    stage: "done",
    message: "全文结构化分析完成",
    progress: 100,
  });

  return {
    attachmentItemID: output.attachmentItemID,
    analysisPath,
    readingCardPath,
  };
}