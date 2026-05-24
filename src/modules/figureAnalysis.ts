import {
  getDefaultVisionModelConfig,
  type MagicDigestModelConfig,
} from "./modelApiSettings";
import { chatVision } from "./chatRouter";
import { resolveLlmForZoteroMineruOutputForItem } from "./llmForZoteroMineruProvider";

type FigureAnalysisResult = {
  id: string;
  file: string;
  fileName: string;
  model: {
    id: string;
    name: string;
    model: string;
    baseURL: string;
  };
  analysis: string;
  createdAt: string;
};

function getIOUtils(): any {
  const io = (globalThis as any).IOUtils;
  if (!io) throw new Error("IOUtils not available");
  return io;
}

function getPathUtils(): any {
  const p = (globalThis as any).PathUtils;
  if (!p) throw new Error("PathUtils not available");
  return p;
}

async function exists(path: string): Promise<boolean> {
  try {
    return await getIOUtils().exists(path);
  } catch {
    return false;
  }
}

async function writeJSON(path: string, data: unknown): Promise<void> {
  await getIOUtils().writeUTF8(path, JSON.stringify(data, null, 2));
}

function collectCandidateDirs(output: any): string[] {
  const dirs = new Set<string>();

  function normalizePathLike(value: string): string {
    return String(value || "").trim().replace(/\\\\/g, "\\");
  }

  function looksLikePath(value: string): boolean {
    const s = normalizePathLike(value);
    return (
      /^[a-zA-Z]:\\/.test(s) ||
      s.startsWith("/") ||
      s.includes("\\") ||
      s.includes("/")
    );
  }

  function parentDir(value: string): string {
    const s = normalizePathLike(value).replace(/\\/g, "/");
    const idx = s.lastIndexOf("/");
    if (idx <= 0) return "";
    return s.slice(0, idx).replace(/\//g, "\\");
  }

  function addPath(value: string) {
    const s = normalizePathLike(value);
    if (!s || !looksLikePath(s)) return;

    // Add itself
    dirs.add(s);

    // Add parent directory too, useful when the string is a file path
    const parent = parentDir(s);
    if (parent) dirs.add(parent);
  }

  function visit(node: any, depth = 0) {
    if (!node || depth > 8) return;

    if (typeof node === "string") {
      addPath(node);
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }

    if (typeof node === "object") {
      for (const value of Object.values(node)) {
        visit(value, depth + 1);
      }
    }
  }

  visit(output);

  return Array.from(dirs);
}

async function walkFiles(dir: string, maxDepth = 5): Promise<string[]> {
  const io = getIOUtils();
  const pathUtils = getPathUtils();
  const result: string[] = [];

  async function walk(current: string, depth: number) {
    if (depth > maxDepth) return;

    let entries: any[] = [];

    try {
      entries = await io.getChildren(current);
    } catch {
      return;
    }

    for (const entry of entries) {
      let stat: any;

      try {
        stat = await io.stat(entry);
      } catch {
        continue;
      }

      if (stat.type === "directory") {
        await walk(entry, depth + 1);
      } else {
        result.push(pathUtils.normalize(entry));
      }
    }
  }

  await walk(dir, 0);

  return result;
}

function isImageFile(path: string): boolean {
  const p = path.toLowerCase();
  return (
    p.endsWith(".png") ||
    p.endsWith(".jpg") ||
    p.endsWith(".jpeg") ||
    p.endsWith(".webp")
  );
}

function looksLikeFigureImage(path: string): boolean {
  return isImageFile(path);
}

async function findFigureImages(output: any): Promise<string[]> {
  const dirs = collectCandidateDirs(output);
  const files: string[] = [];

  for (const dir of dirs) {
    if (!(await exists(dir))) continue;

    const children = await walkFiles(dir);

    for (const file of children) {
      if (looksLikeFigureImage(file)) {
        files.push(file);
      }
    }
  }

  return Array.from(new Set(files)).slice(0, 30);
}

async function readFileBase64(path: string): Promise<string> {
  const bytes = await getIOUtils().read(path);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function basename(path: string): string {
  const p = path.replace(/\\/g, "/");
  return p.split("/").pop() || path;
}

// 图片压缩：限制尺寸和格式，避免 base64 过大导致 API 拒绝
async function compressImageForVision(filePath: string): Promise<{
  base64: string;
  mimeType: string;
}> {
  const bytes = await getIOUtils().read(filePath);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const originalB64 = btoa(binary);
  const originalSize = originalB64.length;

  // 如果 base64 < 2MB，直接使用
  if (originalSize < 2_000_000) {
    return { base64: originalB64, mimeType: "image/png" };
  }

  // 否则尝试用 Canvas 压缩
  try {
    const win = Zotero.getMainWindow();
    const doc = win.document;
    const canvas = doc.createElement("canvas");
    const ctx: any = (canvas as any).getContext("2d");
    if (!ctx) throw new Error("no canvas context");

    const img = new (win as any).Image() as HTMLImageElement;

    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = `data:image/png;base64,${originalB64}`;
    });

    if (!loaded) throw new Error("image load failed");

    // 限制最大尺寸：宽 ≤ 1920, 高 ≤ 1920
    const MAX_DIM = 1920;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;

    if (w > MAX_DIM || h > MAX_DIM) {
      const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }

    (canvas as any).width = w;
    (canvas as any).height = h;
    ctx.drawImage(img, 0, 0, w, h);

    // JPEG 质量 0.75，大幅减小体积
    const dataUrl = (canvas as any).toDataURL("image/jpeg", 0.75);
    const compressedB64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");

    return { base64: compressedB64, mimeType: "image/jpeg" };
  } catch {
    // Canvas 不可用，裁剪 base64 到前 2MB（保留大部分信息）
    return {
      base64: originalB64.slice(0, 2_600_000),
      mimeType: "image/png",
    };
  }
}

function buildVisionPrompt(fileName: string): string {
  const lower = fileName.toLowerCase();

  // 根据文件名和上下文选择合适的提示词
  // 病理图片
  if (/wsi|histolog|patholog|stain|tissue|cell|hepat|renal|cardiac|pulmon|brain|spleen|gastro/i.test(lower)) {
    return (
      "You are a forensic pathology expert analyzing a medical image. " +
      "1) Describe the tissue/organ visible and the staining method if apparent. " +
      "2) Identify any pathological features (necrosis, inflammation, fibrosis, congestion, autolysis, etc.). " +
      "3) Note the architectural pattern (normal vs. disrupted). " +
      "4) Summarize the clinical significance in 2-3 sentences. " +
      "Reply in Chinese, be specific and concise."
    );
  }

  // 图表/数据图
  if (/chart|graph|plot|bar|line|scatter|heatmap|umap|pca|roc|auc/i.test(lower)) {
    return (
      "You are analyzing a chart/graph from an academic paper. " +
      "1) Identify the chart type (bar, line, scatter, heatmap, etc.). " +
      "2) Read the axes labels and units. " +
      "3) Describe the main trend or comparison shown. " +
      "4) Note any outliers or notable data points. " +
      "5) Summarize the key takeaway in 1-2 sentences. " +
      "Reply in Chinese."
    );
  }

  // 表格
  if (/table|tab/i.test(lower)) {
    return (
      "You are analyzing a table from an academic paper. " +
      "1) Identify the table's topic and structure (rows/columns). " +
      "2) List the key metrics being compared (e.g., accuracy, recall, p-value). " +
      "3) Highlight the best and worst results. " +
      "4) Note any statistically significant findings. " +
      "Reply in Chinese, be specific."
    );
  }

  // 通用
  return (
    "You are analyzing a figure from an academic paper. " +
    "1) Describe what is shown (type, content, layout). " +
    "2) If there are labels/annotations, read them. " +
    "3) Identify the key finding or information conveyed. " +
    "4) Note any limitations (cropped text, blurry areas). " +
    "Reply in Chinese, be detailed but concise."
  );
}

function isValidVisionModel(config: MagicDigestModelConfig): boolean {
  // 支持火山引擎 和 OpenAI 兼容的视觉模型（Qwen、GPT-4V 等）
  return config.enabled !== false;
}

async function analyzeOneFigure(
  config: MagicDigestModelConfig,
  file: string,
  index: number,
): Promise<FigureAnalysisResult> {
  if (!isValidVisionModel(config)) {
    throw new Error("Vision model is not enabled. Check settings.");
  }

  const fileName = basename(file);

  // 压缩图片，避免 base64 过大导致 API 拒绝
  const compressed = await compressImageForVision(file);

  const prompt = buildVisionPrompt(fileName);

  // 重试逻辑：最多 3 次，指数退避
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await chatVision(config, {
        imageBase64: compressed.base64,
        mimeType: compressed.mimeType,
        prompt,
        temperature: 0,
        timeoutMs: 60000,
      });

      return {
        id: `figure-${index + 1}`,
        file,
        fileName,
        model: {
          id: config.id,
          name: config.name,
          model: config.model,
          baseURL: config.baseURL,
        },
        analysis: result.content,
        createdAt: new Date().toISOString(),
      };
    } catch (e: any) {
      lastError = e as Error;
      const msg = String(e?.message || e || "");

      // 不可重试的错误：API key 错误、模型不存在等
      if (/unauthorized|invalid.*key|not found|model.*not/i.test(msg)) {
        break;
      }

      // 最后一次尝试不再等待
      if (attempt < 2) {
        const delay = (attempt + 1) * 2000 + Math.random() * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError || new Error("All retry attempts failed");
}

export async function analyzeFiguresForSelectedItem() {
  const win = Zotero.getMainWindow();
  const item = win.ZoteroPane.getSelectedItems()?.[0];

  if (!item) {
    new ztoolkit.ProgressWindow("magic_digest", {
      closeOnClick: true,
      closeTime: 6000,
    })
      .createLine({
        text: "Please select a reference or PDF attachment first.",
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  const config = getDefaultVisionModelConfig();

  if (!config) {
    new ztoolkit.ProgressWindow("magic_digest", {
      closeOnClick: true,
      closeTime: 8000,
    })
      .createLine({
        text: "No default vision model configured. Set one in magic_digest settings.",
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  const pw = new ztoolkit.ProgressWindow("magic_digest", {
    closeOnClick: true,
    closeTime: -1,
  });

  pw.createLine({
    text: "Verifying vision API connectivity...",
    type: "default",
    progress: 3,
  }).show();

  // 预检连通性
  try {
    const fetchFn = (globalThis as any).fetch;
    if (typeof fetchFn !== "function") {
      throw new Error("当前 Zotero 环境不支持 fetch。请检查 Zotero 7 版本（需 7.0+）。");
    }

    const baseURL = String(config.baseURL || "").trim().replace(/\/+$/, "");
    const healthURL = baseURL + "/models";

    const AbortCtor = (globalThis as any).AbortController;
    const controller = AbortCtor ? new AbortCtor() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 15000) : null;

    const resp = await fetchFn(healthURL, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: controller?.signal,
    });

    if (timer) clearTimeout(timer);

    if (!resp.ok && resp.status !== 404) {
      // 404 = endpoint exists but /models not supported — that's OK
      throw new Error(
        `API 返回 HTTP ${resp.status}。可能 API Key 无效或 Base URL 错误。\n` +
        `当前 Base URL: ${baseURL}\n请在设置中检查 Vision Model 配置。`,
      );
    }
  } catch (e: any) {
    if (e.name === "AbortError") {
      throw new Error(
        `API 连通性检查超时（15s）。\n当前 Base URL: ${config.baseURL}\n请确认网络可达，或检查代理/VPN 设置。`,
      );
    }
    const msg = String(e?.message || e);
    if (/fetch|network|ENOTFOUND|dns/i.test(msg)) {
      throw new Error(
        `无法连接 Vision API。\n当前 Base URL: ${config.baseURL}\n请检查：\n1. 网络连接是否正常\n2. API 地址是否有防火墙阻挡\n3. 是否需要代理/VPN\n原始错误: ${msg.slice(0, 200)}`,
      );
    }
    // 其他错误（如 401/403）按正常抛出
    if (msg.includes("API 返回")) throw e;
  }

  pw.createLine({
    text: "Searching MinerU figure images...",
    type: "default",
    progress: 5,
  }).show();

  try {
    const output = await resolveLlmForZoteroMineruOutputForItem(item);

    if (!output) {
      throw new Error("No MinerU cache found. Please parse this PDF with llm-for-zotero/MinerU first.");
    }

    const images = await findFigureImages(output);

    if (!images.length) {
      throw new Error(
        "No image files found in MinerU output. Candidate dirs: " +
          collectCandidateDirs(output).join(" | ") +
          ". Output keys: " +
          Object.keys(output || {}).join(", ")
      );
    }

    pw.createLine({
      text: `Found ${images.length} figure images. Starting vision analysis...`,
      type: "default",
      progress: 15,
    }).show();

    const CONCURRENCY = Math.min(8, Math.ceil(images.length / 2));
    const results: FigureAnalysisResult[] = new Array(images.length);

    // 并行分析，每次最多 CONCURRENCY 个并发
    for (let batchStart = 0; batchStart < images.length; batchStart += CONCURRENCY) {
      const batch = images
        .slice(batchStart, batchStart + CONCURRENCY)
        .map(async (img, offset) => {
          const i = batchStart + offset;
          try {
            return await analyzeOneFigure(config, img, i);
          } catch (e: any) {
            const errMsg = e?.message || String(e);
            let analysis = `Failed: ${errMsg}`;

            if (/too large|payload|size/i.test(errMsg)) {
              analysis = `Failed: 图片过大，API 拒绝。请尝试在 MinerU 中降低图片分辨率。\n原始错误: ${errMsg}`;
            } else if (/timeout|timed out/i.test(errMsg)) {
              analysis = `Failed: 请求超时（120s）。图片可能过大或网络不稳定。\n原始错误: ${errMsg}`;
            } else if (/unauthorized|key/i.test(errMsg)) {
              analysis = `Failed: API Key 无效或未授权。请在 magic_digest 设置中检查 Vision Model 配置。\n原始错误: ${errMsg}`;
            } else if (/network|fetch|dns|ENOTFOUND/i.test(errMsg)) {
              analysis = `Failed: 网络连接失败。请检查网络或火山引擎 API 地址。\n原始错误: ${errMsg}`;
            }

            return {
              id: `figure-${i + 1}`,
              file: img,
              fileName: basename(img),
              model: {
                id: config.id,
                name: config.name,
                model: config.model,
                baseURL: config.baseURL,
              },
              analysis,
              createdAt: new Date().toISOString(),
            };
          }
        });

      const batchResults = await Promise.all(batch);
      for (let j = 0; j < batchResults.length; j++) {
        results[batchStart + j] = batchResults[j];
      }

      const completed = batchStart + batch.length;
      pw.createLine({
        text: `Analyzing figures: ${completed}/${images.length} done`,
        type: "default",
        progress: 15 + Math.round((completed / images.length) * 70),
      }).show();
    }

    const dirs = collectCandidateDirs(output);
    const outDir = dirs[0];

    if (!outDir) {
      throw new Error("Cannot determine output directory.");
    }

    const outPath = getPathUtils().join(outDir, "magic_digest_figure_analysis.json");

    await writeJSON(outPath, {
      schema: "magic_digest.figure_analysis.v1",
      generatedAt: new Date().toISOString(),
      visionModel: {
        id: config.id,
        name: config.name,
        model: config.model,
        baseURL: config.baseURL,
      },
      source: {
        imageCount: images.length,
      },
      figures: results,
    });

    pw.createLine({
      text: `Figure analysis completed: ${results.length} figures`,
      type: "success",
      progress: 90,
    })
      .createLine({
        text: outPath,
        type: "default",
        progress: 100,
      })
      .show();
  } catch (e: any) {
    pw.createLine({
      text: `Figure analysis failed: ${e?.message || String(e)}`,
      type: "fail",
      progress: 100,
    }).show();
  }
}