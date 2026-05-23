import { getDefaultModelConfig } from "./modelApiSettings";
import { chat } from "./chatRouter";
import { resolveLlmForZoteroMineruOutputForItem } from "./llmForZoteroMineruProvider";

type LayoutBlock = {
  page: number;
  bbox?: number[];
  text: string;
  type?: string;
};

type GeneratedCard = {
  id: string;
  title: string;
  summary: string;
  quote: string;
  page: number;
  bbox?: number[];
  kind: "claim" | "method" | "result" | "definition" | "limitation" | "other";
};

function safeString(v: unknown): string {
  return String(v || "").trim();
}

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

async function readJSON(path: string): Promise<any> {
  const text = await getIOUtils().readUTF8(path);
  return JSON.parse(text);
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

    dirs.add(s);

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

async function walkFiles(dir: string, maxDepth = 4): Promise<string[]> {
  const io = getIOUtils();
  const pathUtils = getPathUtils();
  const result: string[] = [];

  async function walk(current: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: any[] = [];
    try { entries = await io.getChildren(current); } catch { return; }
    for (const entry of entries) {
      let stat: any;
      try { stat = await io.stat(entry); } catch { continue; }
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

function looksLikeLayoutFile(path: string): boolean {
  const p = path.toLowerCase();
  return p.endsWith(".json") && (
    p.includes("layout") || p.includes("middle") ||
    p.includes("content_list") || p.includes("content-list")
  );
}

async function findLayoutJSONFiles(output: any): Promise<string[]> {
  const dirs = collectCandidateDirs(output);
  const files: string[] = [];

  for (const dir of dirs) {
    if (!(await exists(dir))) continue;

    const children = await walkFiles(dir, 5);

    for (const file of children) {
      const p = file.replace(/\\/g, "/").toLowerCase();

      if (!p.endsWith(".json")) continue;

      if (
        p.endsWith("/layout.json") ||
        p.includes("content_list") ||
        p.includes("content-list") ||
        p.endsWith("/middle.json") ||
        p.includes("/middle")
      ) {
        files.push(file);
      }
    }
  }

  const unique = Array.from(new Set(files)).sort((a, b) =>
    a.localeCompare(b),
  );

  if (!unique.length) {
    return [];
  }

  function parentDirOf(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
  }

  function scoreGroup(group: string[]): number {
    const joined = group.join("\n").toLowerCase();

    let score = 0;

    if (joined.includes("content_list")) score += 10;
    if (joined.includes("/layout.json")) score += 10;
    if (joined.includes("middle")) score += 3;

    return score;
  }

  const groups = new Map<string, string[]>();

  for (const file of unique) {
    const parent = parentDirOf(file);
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent)!.push(file);
  }

  const ranked = Array.from(groups.entries()).sort((a, b) => {
    const scoreDiff = scoreGroup(b[1]) - scoreGroup(a[1]);
    if (scoreDiff !== 0) return scoreDiff;
    return a[0].localeCompare(b[0]);
  });

  // IMPORTANT:
  // Only use one MinerU output directory for one selected PDF.
  // This prevents mixing 1214/6079/6086/6094 layouts.
  return ranked[0]?.[1] || [];
}

function extractTextFromAny(obj: any): string {
  if (!obj) return "";
  const candidates = [
    obj.text, obj.content, obj.markdown, obj.html,
    obj.span_text, obj.line_text, obj.block_text,
  ];
  for (const c of candidates) {
    const s = safeString(c);
    if (s) return s;
  }
  if (Array.isArray(obj.spans)) {
    return obj.spans.map(extractTextFromAny).filter(Boolean).join(" ");
  }
  if (Array.isArray(obj.lines)) {
    return obj.lines.map(extractTextFromAny).filter(Boolean).join(" ");
  }
  return "";
}

function extractBBox(obj: any): number[] | undefined {
  const candidates = [obj?.bbox, obj?.box, obj?.rect];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length >= 4 && c.every((x: any) => typeof x === "number")) {
      return c.slice(0, 4);
    }
  }
  return undefined;
}

function extractPage(obj: any, fallback = 1): number {
  const candidates = [obj?.page, obj?.page_num, obj?.pageNo, obj?.page_id, obj?.pageIndex];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n <= 0 ? n + 1 : n;
  }
  return fallback;
}

function extractBlocksFromJSON(json: any): LayoutBlock[] {
  const blocks: LayoutBlock[] = [];
  function visit(node: any, pageHint = 1) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, pageHint);
      return;
    }
    if (typeof node !== "object") return;
    const page = extractPage(node, pageHint);
    const text = extractTextFromAny(node);
    const bbox = extractBBox(node);
    const type = safeString(node.type || node.category || node.block_type);
    if (text && text.length >= 20) {
      blocks.push({ page, bbox, text: text.replace(/\s+/g, " ").trim(), type });
    }
    for (const key of ["blocks", "layout", "pages", "items", "children", "content", "paragraphs"]) {
      if (node[key]) visit(node[key], page);
    }
  }
  visit(json, 1);
  return blocks;
}

function dedupeBlocks(blocks: LayoutBlock[]): LayoutBlock[] {
  const seen = new Set<string>();
  const result: LayoutBlock[] = [];
  for (const b of blocks) {
    const text = b.text.replace(/\s+/g, " ").trim();
    const key = `${b.page}:${text.slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...b, text });
  }
  return result;
}

function chunkBlocks(blocks: LayoutBlock[], maxChars = 12000): LayoutBlock[][] {
  const chunks: LayoutBlock[][] = [];
  let current: LayoutBlock[] = [];
  let size = 0;
  for (const b of blocks) {
    const len = b.text.length;
    if (current.length && size + len > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(b);
    size += len;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function parseModelJSON(text: string): GeneratedCard[] {
  const raw = String(text || "").trim();

  if (!raw) {
    throw new Error("Model returned empty content, expected JSON.");
  }

  let cleaned = raw
    .replace(/^\uFEFF/, "")
    .replace(/^\`\`\`json\s*/i, "")
    .replace(/^\`\`\`\s*/i, "")
    .replace(/\`\`\`$/i, "")
    .trim();

  // If the model adds explanations, try to extract the JSON object/array.
  const firstObj = cleaned.indexOf("{");
  const lastObj = cleaned.lastIndexOf("}");
  const firstArr = cleaned.indexOf("[");
  const lastArr = cleaned.lastIndexOf("]");

  if (firstObj >= 0 && lastObj > firstObj) {
    cleaned = cleaned.slice(firstObj, lastObj + 1);
  } else if (firstArr >= 0 && lastArr > firstArr) {
    cleaned = cleaned.slice(firstArr, lastArr + 1);
  }

  let parsed: any;

  try {
    parsed = JSON.parse(cleaned);
  } catch (e: any) {
    throw new Error(
      "Model response is not valid JSON. First 300 chars: " +
        raw.slice(0, 300)
    );
  }

  const arr = Array.isArray(parsed) ? parsed : parsed.cards;

  if (!Array.isArray(arr)) {
    throw new Error("Model response JSON does not contain cards array.");
  }

  return arr.map((x: any, index: number) => ({
    id: safeString(x.id) || `card-${index + 1}`,
    title: safeString(x.title) || `Card ${index + 1}`,
    summary: safeString(x.summary),
    quote: safeString(x.quote),
    page: Number(x.page) || 1,
    bbox: Array.isArray(x.bbox) ? x.bbox.slice(0, 4) : undefined,
    kind: (safeString(x.kind) || "other") as GeneratedCard["kind"],
  }));
}


function fallbackCardsFromBlocks(
  blocks: LayoutBlock[],
  chunkIndex: number,
): GeneratedCard[] {
  const candidates = blocks
    .filter((b) => b.text && b.text.length >= 80)
    .slice(0, 5);

  return candidates.map((b, i) => {
    const text = b.text.replace(/\s+/g, " ").trim();
    return {
      id: `fallback-${chunkIndex}-${i + 1}`,
      title: `Layout Card ${chunkIndex}.${i + 1}`,
      summary: text.slice(0, 260),
      quote: text.slice(0, 180),
      page: b.page || 1,
      bbox: b.bbox,
      kind: "other",
    };
  });
}

async function generateCardsForChunk(
  config: NonNullable<ReturnType<typeof getDefaultModelConfig>>,
  blocks: LayoutBlock[],
  chunkIndex: number,
): Promise<GeneratedCard[]> {
  const input = blocks.map((b, i) => ({
    block_id: `chunk${chunkIndex}-block${i + 1}`,
    page: b.page,
    bbox: b.bbox,
    type: b.type,
    text: b.text,
  }));

  const result = await chat(
    config,
    [
      {
        role: "system",
        content:
          "You are a strict JSON generator. You must return ONLY valid JSON. " +
          "Do not return markdown. Do not return explanations. Do not wrap in code fences.",
      },
      {
        role: "user",
        content:
          "Generate 3-8 paper reading cards from the following layout blocks. " +
          "Return exactly this JSON shape: " +
          "{\"cards\":[{\"id\":\"string\",\"title\":\"string\",\"summary\":\"string\",\"quote\":\"string\",\"page\":1,\"bbox\":[0,0,0,0],\"kind\":\"claim|method|result|definition|limitation|other\"}]} " +
          "Rules: page and bbox must come from the source block. quote must be copied from source text. " +
          "Input blocks:\n" +
          JSON.stringify(input),
      },
    ],
    { temperature: 0, maxTokens: 5000, timeoutMs: 180000 },
  );

  try {
    return parseModelJSON(result.content);
  } catch (e: any) {
    ztoolkit.log(
      "magic_digest: model JSON parse failed, using fallback cards",
      e?.message || String(e),
      String(result.content || "").slice(0, 500),
    );

    return fallbackCardsFromBlocks(blocks, chunkIndex);
  }
}

export async function generateBlockFirstCardsForSelectedItem() {
  const win = Zotero.getMainWindow();
  const item = win.ZoteroPane.getSelectedItems()?.[0];
  if (!item) {
    new ztoolkit.ProgressWindow("magic_digest", { closeOnClick: true, closeTime: 6000 })
      .createLine({ text: "Please select a reference first.", type: "fail", progress: 100 }).show();
    return;
  }
  const config = getDefaultModelConfig();
  if (!config) {
    new ztoolkit.ProgressWindow("magic_digest", { closeOnClick: true, closeTime: 8000 })
      .createLine({ text: "No default model. Configure in Edit > Settings > magic_digest.", type: "fail", progress: 100 }).show();
    return;
  }
  const pw = new ztoolkit.ProgressWindow("magic_digest", { closeOnClick: true, closeTime: -1 });
  pw.createLine({ text: "Searching MinerU cache...", type: "default", progress: 5 }).show();
  try {
    let output: any = await resolveLlmForZoteroMineruOutputForItem(item);

    if (!output) {
      const mineruRoot =
        String(
          (Zotero.Prefs.get("extensions.zotero.my_vibero.llmForZotero.mineruRootDir", true) || ""),
        ).trim() ||
        String(
          (Zotero.Prefs.get("extensions.zotero.my_vibero.cache.rootDir", true) || ""),
        ).trim();
      const itemID = Number((item as any)?.id || (item as any)?.itemID || 0);
      const itemDir = itemID ? getPathUtils().join(mineruRoot, String(itemID)) : mineruRoot;

      output = {
        root: itemDir,
        outputDir: itemDir,
        fallback: true,
      };
    }
    const jsonFiles = await findLayoutJSONFiles(output);
    if (!jsonFiles.length) throw new Error("No layout JSON found.");
    pw.createLine({ text: `Found ${jsonFiles.length} layout files, extracting...`, type: "default", progress: 20 }).show();
    let blocks: LayoutBlock[] = [];
    for (const file of jsonFiles) {
      try { const json = await readJSON(file); blocks.push(...extractBlocksFromJSON(json)); } catch { /* skip */ }
    }
    blocks = dedupeBlocks(blocks).filter(b => b.text.length >= 30).slice(0, 1200);
    if (!blocks.length) throw new Error("No blocks extracted.");
    pw.createLine({ text: `Extracted ${blocks.length} blocks, calling ${config.name}...`, type: "default", progress: 35 }).show();
    // 每块最多 16000 字符（原来 12000），减少分块数
    const chunks = chunkBlocks(blocks, 16000).slice(0, 8);
    const cards: GeneratedCard[] = [];
    const PARALLEL_BATCH = 3;

    for (let batchStart = 0; batchStart < chunks.length; batchStart += PARALLEL_BATCH) {
      const batchEnd = Math.min(batchStart + PARALLEL_BATCH, chunks.length);
      const batchTasks: Array<Promise<{ index: number; cards: GeneratedCard[] }>> = [];

      for (let i = batchStart; i < batchEnd; i++) {
        pw.createLine({ text: `Generating ${i + 1}/${chunks.length}...`, type: "default", progress: 35 + Math.round((i / chunks.length) * 45) }).show();

        batchTasks.push(
          generateCardsForChunk(config, chunks[i], i + 1).then(
            (chunkCards) => ({ index: i, cards: chunkCards }),
          ),
        );
      }

      const batchResults = await Promise.all(batchTasks);
      batchResults.sort((a, b) => a.index - b.index);

      for (const { cards: chunkCards } of batchResults) {
        cards.push(...chunkCards);
      }
    }
    const deduped = cards.filter(c => c.title && c.summary && c.quote).slice(0, 60).map((c, i) => ({ ...c, id: c.id || `card-${i + 1}` }));
    const firstJSON = jsonFiles[0];
    const firstJSONDir = firstJSON
      ? firstJSON.replace(/\\/g, "/").replace(/\/[^/]+$/, "").replace(/\//g, "\\")
      : "";
    const dirs = collectCandidateDirs(output);
    const outDir = firstJSONDir || dirs[0];
    const outPath = getPathUtils().join(outDir, "magic_digest_block_first_cards.json");
    await writeJSON(outPath, {
      schema: "magic_digest.block_first_cards.v1",
      generatedAt: new Date().toISOString(),
      model: { id: config.id, name: config.name, model: config.model, baseURL: config.baseURL },
      source: { jsonFiles, blockCount: blocks.length },
      cards: deduped,
    });
    pw.createLine({ text: `Done: ${deduped.length} cards`, type: "success", progress: 100 }).show();
  } catch (e: any) {
    pw.createLine({ text: `Failed: ${e?.message || String(e)}`, type: "fail", progress: 100 }).show();
  }
}