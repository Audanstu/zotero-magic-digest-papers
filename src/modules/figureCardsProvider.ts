import type {
  MagicDigestAnalysis,
  MagicDigestCard,
  MagicDigestCardType,
} from "./analysisSchema";
import { createEmptyAnalysis } from "./analysisSchema";
import { resolveLlmForZoteroMineruOutputForItem } from "./llmForZoteroMineruProvider";

type FigureAnalysisFile = {
  schema?: string;
  generatedAt?: string;
  visionModel?: {
    id?: string;
    name?: string;
    model?: string;
    baseURL?: string;
  };
  figures?: Array<{
    id?: string;
    file?: string;
    fileName?: string;
    analysis?: string;
    createdAt?: string;
    model?: {
      id?: string;
      name?: string;
      model?: string;
      baseURL?: string;
    };
  }>;
};

type ImageLocation = {
  page: number;
  bbox: number[];
  sourceFile: string;
  matchedPath: string;
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

async function readJSON(path: string): Promise<any> {
  const text = await getIOUtils().readUTF8(path);
  return JSON.parse(text);
}

function safeString(v: unknown): string {
  return String(v || "").trim();
}

function normalizePathLike(value: string): string {
  return String(value || "").trim().replace(/\\\\/g, "\\");
}

function basename(path: string): string {
  const p = normalizePathLike(path).replace(/\\/g, "/");
  return p.split("/").pop() || p;
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

function collectCandidateDirs(output: any): string[] {
  const dirs = new Set<string>();

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

function isImagePath(value: string): boolean {
  const p = String(value || "").toLowerCase();
  return (
    p.endsWith(".png") ||
    p.endsWith(".jpg") ||
    p.endsWith(".jpeg") ||
    p.endsWith(".webp")
  );
}

function isMineruLayoutJSON(path: string): boolean {
  const p = path.replace(/\\/g, "/").toLowerCase();
  if (!p.endsWith(".json")) return false;
  if (p.endsWith("/magic_digest_figure_analysis.json")) return false;

  return (
    p.endsWith("/layout.json") ||
    p.includes("content_list") ||
    p.endsWith("/middle.json") ||
    p.includes("middle")
  );
}

async function findFigureAnalysisJSONForAttachment(
  attachmentItemID: number,
): Promise<{
  path: string | null;
  dirs: string[];
}> {
  const item = Zotero.Items.get(attachmentItemID);

  if (!item) {
    return { path: null, dirs: [] };
  }

  const output = await resolveLlmForZoteroMineruOutputForItem(item);

  if (!output) {
    return { path: null, dirs: [] };
  }

  const dirs = collectCandidateDirs(output);

  for (const dir of dirs) {
    if (!(await exists(dir))) continue;

    const direct = getPathUtils().join(dir, "magic_digest_figure_analysis.json");

    if (await exists(direct)) {
      return { path: direct, dirs };
    }

    const files = await walkFiles(dir, 4);
    const found = files.find((x) =>
      x.replace(/\\/g, "/").endsWith("/magic_digest_figure_analysis.json"),
    );

    if (found) {
      return { path: found, dirs };
    }
  }

  return { path: null, dirs };
}

function extractBBox(obj: any, fallback?: number[]): number[] | undefined {
  const candidates = [obj?.bbox, obj?.box, obj?.rect];

  for (const c of candidates) {
    if (
      Array.isArray(c) &&
      c.length >= 4 &&
      c.slice(0, 4).every((x) => typeof x === "number")
    ) {
      return c.slice(0, 4);
    }
  }

  return fallback;
}

function extractPage(obj: any, fallback = 0): number {
  if (obj && obj.page_idx !== undefined) {
    const n = Number(obj.page_idx);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }

  const candidates = [
    obj?.page,
    obj?.page_num,
    obj?.pageNo,
    obj?.page_id,
    obj?.pageIndex,
  ];

  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) {
      // Reader uses 0-based page index internally.
      // Most explicit page/page_num fields are 1-based, so convert them.
      return n > 0 ? Math.floor(n - 1) : 0;
    }
  }

  return fallback;
}

function collectImageStrings(obj: any): string[] {
  const result: string[] = [];

  function visit(node: any, depth = 0) {
    if (!node || depth > 5) return;

    if (typeof node === "string") {
      if (isImagePath(node)) result.push(node);
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

  visit(obj);

  return result;
}


function normalizeBBoxForReader(
  bbox: number[],
  sourceFile: string,
): number[] {
  const nums = bbox.slice(0, 4).map((x) => Number(x));

  if (nums.length < 4 || !nums.every((x) => Number.isFinite(x))) {
    return nums;
  }

  const max = Math.max(...nums.map((x) => Math.abs(x)));

  // Already normalized
  if (max <= 1) {
    return nums;
  }

  const source = String(sourceFile || "").replace(/\\/g, "/").toLowerCase();

  // MinerU content_list.json usually uses approximately 1000x1000 page coordinates.
  // layout.json usually uses PDF-point-like coordinates, around 595/612 x 792.
  let width = 1000;
  let height = 1000;

  if (source.endsWith("/layout.json") || source.includes("/layout.json")) {
    width = 612;
    height = 792;
  }

  let [x1, y1, x2, y2] = nums;

  const normalized = [
    x1 / width,
    y1 / height,
    x2 / width,
    y2 / height,
  ];

  return normalized.map((v) => Math.max(0, Math.min(1, v)));
}

function addLocation(
  map: Map<string, ImageLocation>,
  imagePath: string,
  page: number,
  bbox: number[] | undefined,
  sourceFile: string,
) {
  if (!bbox || bbox.length < 4) return;

  const name = basename(imagePath).toLowerCase();
  if (!name) return;

  if (!map.has(name)) {
    map.set(name, {
      page,
      bbox: normalizeBBoxForReader(bbox, sourceFile),
      sourceFile,
      matchedPath: imagePath,
    });
  }
}

function collectLocationsFromJSON(
  json: any,
  sourceFile: string,
): Map<string, ImageLocation> {
  const map = new Map<string, ImageLocation>();

  function visit(node: any, pageHint = 1, bboxHint?: number[]) {
    if (!node) return;

    if (Array.isArray(node)) {
      for (const item of node) visit(item, pageHint, bboxHint);
      return;
    }

    if (typeof node !== "object") return;

    const page = extractPage(node, pageHint);
    const bbox = extractBBox(node, bboxHint);
    const imageStrings = collectImageStrings(node);

    for (const imagePath of imageStrings) {
      addLocation(map, imagePath, page, bbox, sourceFile);
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === "object") {
        visit(value, page, bbox);
      }
    }
  }

  visit(json, 1, undefined);

  return map;
}

async function buildImageLocationMap(dirs: string[]): Promise<Map<string, ImageLocation>> {
  const result = new Map<string, ImageLocation>();
  const jsonFiles: string[] = [];

  for (const dir of dirs) {
    if (!(await exists(dir))) continue;

    const files = await walkFiles(dir, 4);

    for (const file of files) {
      if (isMineruLayoutJSON(file)) {
        jsonFiles.push(file);
      }
    }
  }

  const orderedJSONFiles = Array.from(new Set(jsonFiles)).sort((a, b) => {
    const aa = a.toLowerCase();
    const bb = b.toLowerCase();

    const score = (x: string) => {
      if (x.includes("content_list")) return 0;
      if (x.endsWith("layout.json")) return 1;
      if (x.includes("middle")) return 2;
      return 9;
    };

    return score(aa) - score(bb);
  });

  for (const file of orderedJSONFiles) {
    try {
      const json = await readJSON(file);
      const localMap = collectLocationsFromJSON(json, file);

      for (const [key, value] of localMap.entries()) {
        if (!result.has(key)) {
          result.set(key, value);
        }
      }
    } catch {
      // ignore invalid json
    }
  }

  return result;
}

function classifyVisualCard(text: string): {
  type: MagicDigestCardType;
  label: string;
  tags: string[];
} {
  const s = String(text || "");

  if (/表格|table|cohort|precision|recall|iou|ap/i.test(s)) {
    return {
      type: "table",
      label: "Table",
      tags: ["vision", "table"],
    };
  }

  if (/公式|数学|损失函数|矩阵|向量|表达式|equation|formula|loss/i.test(s)) {
    return {
      type: "term",
      label: "Formula",
      tags: ["vision", "formula"],
    };
  }

  if (/病理|切片|组织|染色|肾上腺|腺体|pathology|histology/i.test(s)) {
    return {
      type: "figure",
      label: "Pathology Figure",
      tags: ["vision", "figure", "pathology"],
    };
  }

  if (/曲线|坐标轴|柱状图|折线图|散点|chart|plot|axis/i.test(s)) {
    return {
      type: "figure",
      label: "Chart",
      tags: ["vision", "figure", "chart"],
    };
  }

  return {
    type: "figure",
    label: "Visual",
    tags: ["vision", "figure"],
  };
}

function firstMeaningfulLine(text: string): string {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((x) =>
      x
        .replace(/^#+\s*/, "")
        .replace(/^\d+\.\s*/, "")
        .replace(/^[-*]\s*/, "")
        .trim(),
    )
    .filter(Boolean);

  return lines[0] || "";
}

function makeShortTitle(label: string, index: number, analysis: string): string {
  const first = firstMeaningfulLine(analysis)
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!first) {
    return `${label} ${index + 1}`;
  }

  return `${label} ${index + 1}: ${first.slice(0, 42)}`;
}

function makeCardFromFigure(
  figure: NonNullable<FigureAnalysisFile["figures"]>[number],
  index: number,
  location?: ImageLocation,
): MagicDigestCard {
  const analysis = safeString(figure.analysis);
  const classified = classifyVisualCard(analysis);
  const fileName = safeString(figure.fileName) || basename(safeString(figure.file));

  const card: MagicDigestCard = {
    id: `vision-${safeString(figure.id) || index + 1}`,
    page: location?.page || 1,
    side: "right",
    type: classified.type,
    title: makeShortTitle(classified.label, index, analysis),
    anchorText: fileName || `visual-${index + 1}`,
    source: "doubao-vision",
    importance: location ? 9 : 8,
    content: {
      aiOriginal: analysis,
      userEdited: "",
      edited: false,
      editedAt: null,
    },
    tags: [
      ...classified.tags,
      fileName,
      location ? "located" : "unlocated",
    ].filter(Boolean),
  };

  if (location) {
    (card as any).anchor = {
      method: "mineru-image",
      rects: [location.bbox],
      elementId: `vision-${fileName}`,
      noAutoMatch: false,
      sourceFile: location.sourceFile,
      matchedPath: location.matchedPath,
    };
  } else {
    (card as any).anchor = {
      method: "unresolved",
      rects: [],
      noAutoMatch: true,
    };
  }

  return card;
}

function ensureAnalysis(
  analysis: MagicDigestAnalysis | null,
  attachmentItemID: number,
): MagicDigestAnalysis {
  if (analysis) return analysis;

  return createEmptyAnalysis({
    pdfHash: `attachment-${attachmentItemID}`,
    textModel: "",
    visionModel: "doubao-vision",
    includeVision: true,
    maxVisionImages: 30,
  });
}

function mergeCardsIntoAnalysis(
  analysis: MagicDigestAnalysis,
  cards: MagicDigestCard[],
): MagicDigestAnalysis {
  const cloned: MagicDigestAnalysis = {
    ...analysis,
    pageCards: [...(analysis.pageCards || [])],
  };

  const existingIDs = new Set<string>();

  for (const page of cloned.pageCards) {
    for (const c of [...(page.left || []), ...(page.right || [])]) {
      existingIDs.add(c.id);
    }
  }

  for (const card of cards) {
    let pageBucket = cloned.pageCards.find((x) => x.page === card.page);

    if (!pageBucket) {
      pageBucket = {
        page: card.page,
        skipped: false,
        left: [],
        right: [],
      };
      cloned.pageCards.push(pageBucket);
    }

    if (!existingIDs.has(card.id)) {
      pageBucket.right.push(card);
      existingIDs.add(card.id);
    }
  }

  cloned.pageCards.sort((a, b) => a.page - b.page);

  return cloned;
}

export async function mergeFigureAnalysisIntoAnalysis(
  attachmentItemID: number,
  analysis: MagicDigestAnalysis | null,
): Promise<MagicDigestAnalysis | null> {
  try {
    const found = await findFigureAnalysisJSONForAttachment(attachmentItemID);

    if (!found.path) {
      return analysis;
    }

    const json = (await readJSON(found.path)) as FigureAnalysisFile;
    const figures = Array.isArray(json.figures) ? json.figures : [];

    if (!figures.length) {
      return analysis;
    }

    const locationMap = await buildImageLocationMap(found.dirs);

    const cards = figures
      .filter((x) => safeString(x.analysis))
      .map((x, index) => {
        const fileName = safeString(x.fileName) || basename(safeString(x.file));
        const location = locationMap.get(fileName.toLowerCase());
        return makeCardFromFigure(x, index, location);
      });

    if (!cards.length) {
      return analysis;
    }

    const next = ensureAnalysis(analysis, attachmentItemID);
    return mergeCardsIntoAnalysis(next, cards);
  } catch (e) {
    ztoolkit.log("magic_digest: merge figure analysis failed", e);
    return analysis;
  }
}