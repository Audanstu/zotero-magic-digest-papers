import type {
  MagicDigestAnalysis,
  MagicDigestCard,
  MagicDigestCardType,
} from "./analysisSchema";
import { createEmptyAnalysis } from "./analysisSchema";
import { resolveLlmForZoteroMineruOutputForItem } from "./llmForZoteroMineruProvider";

type BlockFirstCardFile = {
  schema?: string;
  generatedAt?: string;
  model?: {
    id?: string;
    name?: string;
    model?: string;
    baseURL?: string;
  };
  source?: {
    attachmentItemID?: number;
    itemKey?: string;
    jsonFiles?: string[];
    blockCount?: number;
  };
  cards?: Array<{
    id?: string;
    title?: string;
    summary?: string;
    quote?: string;
    page?: number;
    bbox?: number[];
    kind?: string;
  }>;
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

async function findBlockFirstCardsJSONForAttachment(
  attachmentItemID: number,
): Promise<string | null> {
  const item = Zotero.Items.get(attachmentItemID);
  let dirs: string[] = [];

  if (item) {
    const output = await resolveLlmForZoteroMineruOutputForItem(item);
    dirs = output ? collectCandidateDirs(output) : [];
  }
for (const dir of Array.from(new Set(dirs))) {
    if (!(await exists(dir))) continue;

    const direct = getPathUtils().join(dir, "magic_digest_block_first_cards.json");

    if (await exists(direct)) {
      return direct;
    }

    const files = await walkFiles(dir, 4);
    const found = files.find((x) =>
      x.replace(/\\/g, "/").endsWith("/magic_digest_block_first_cards.json"),
    );

    if (found) {
      return found;
    }
  }

  return null;
}

function normalizeBBoxForReader(bbox: number[] | undefined): number[] | null {
  if (!Array.isArray(bbox) || bbox.length < 4) return null;

  const nums = bbox.slice(0, 4).map((x) => Number(x));

  if (!nums.every((x) => Number.isFinite(x))) return null;

  const max = Math.max(...nums.map((x) => Math.abs(x)));

  if (max <= 1) {
    return nums.map((v) => Math.max(0, Math.min(1, v)));
  }

  // MinerU content_list uses about 1000x1000 page coordinate.
  const width = 1000;
  const height = 1000;

  const [x1, y1, x2, y2] = nums;

  const normalized = [
    x1 / width,
    y1 / height,
    x2 / width,
    y2 / height,
  ];

  const clamped = normalized.map((v) => Math.max(0, Math.min(1, v)));

  if (clamped[2] <= clamped[0] || clamped[3] <= clamped[1]) {
    return null;
  }

  return clamped;
}

function mapKindToCardType(kind: string): MagicDigestCardType {
  const k = safeString(kind).toLowerCase();

  if (k === "method") return "method";
  if (k === "result") return "result";
  if (k === "limitation") return "limitation";
  if (k === "definition") return "term";
  if (k === "claim") return "insight";
  if (k === "figure") return "figure";
  if (k === "table") return "table";

  return "quote";
}

function pageToReaderIndex(page: unknown): number {
  const n = Number(page);

  if (!Number.isFinite(n)) return 0;

  // block_first_cards.json currently stores pages as 1-based.
  return Math.max(0, Math.floor(n - 1));
}

function makeCardFromBlockFirst(
  x: NonNullable<BlockFirstCardFile["cards"]>[number],
  index: number,
): MagicDigestCard {
  const pageIndex = pageToReaderIndex(x.page);
  const rect = normalizeBBoxForReader(x.bbox);
  const id = safeString(x.id) || `block-first-${index + 1}`;
  const title = safeString(x.title) || `Layout Card ${index + 1}`;
  const summary = safeString(x.summary);
  const quote = safeString(x.quote);

  const card: MagicDigestCard = {
    id: `block-first-${id}`,
    page: pageIndex,
    side: "left",
    type: mapKindToCardType(safeString(x.kind)),
    title,
    anchorText: quote || summary || title,
    source: "mineru",
    importance: rect ? 9 : 7,
    content: {
      aiOriginal: summary || quote || title,
      userEdited: "",
      edited: false,
      editedAt: null,
    },
    tags: [
      "block-first",
      "layout",
      safeString(x.kind),
      rect ? "located" : "unlocated",
    ].filter(Boolean),
  };

  if (rect) {
    (card as any).anchor = {
      method: "mineru-layout",
      rects: [rect],
      quote,
      noAutoMatch: false,
      elementId: `block-first-${id}`,
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
    textModel: "deepseek",
    visionModel: "",
    includeVision: true,
    maxVisionImages: 30,
  });
}


function isBlockFirstCard(card: MagicDigestCard): boolean {
  const id = String(card.id || "");
  const tags = Array.isArray(card.tags) ? card.tags.map((x) => String(x)) : [];
  const anchor = (card as any).anchor || {};
  const method = String(anchor.method || "");

  return (
    id.startsWith("block-first-") ||
    tags.includes("block-first") ||
    tags.includes("layout") ||
    method === "mineru-layout"
  );
}

function clearBlockFirstCardsFromAnalysis(
  analysis: MagicDigestAnalysis | null,
): MagicDigestAnalysis | null {
  if (!analysis) return analysis;

  const cloned: MagicDigestAnalysis = {
    ...analysis,
    pageCards: [...(analysis.pageCards || [])],
  };

  cloned.pageCards = cloned.pageCards
    .map((page) => ({
      ...page,
      left: (page.left || []).filter((card) => !isBlockFirstCard(card)),
      right: (page.right || []).filter((card) => !isBlockFirstCard(card)),
    }))
    .filter((page) => (page.left || []).length || (page.right || []).length);

  return cloned;
}

function mergeCardsIntoAnalysis(
  analysis: MagicDigestAnalysis,
  cards: MagicDigestCard[],
): MagicDigestAnalysis {
  const cloned: MagicDigestAnalysis = {
    ...analysis,
    pageCards: [...(analysis.pageCards || [])],
  };

  function isStaleBlockFirstCard(card: MagicDigestCard): boolean {
    const id = String(card.id || "");
    const tags = Array.isArray(card.tags) ? card.tags.map((x) => String(x)) : [];
    const anchor = (card as any).anchor || {};
    const method = String(anchor.method || "");

    return (
      id.startsWith("block-first-") ||
      tags.includes("block-first") ||
      tags.includes("layout") ||
      method === "mineru-layout"
    );
  }

  // IMPORTANT:
  // Remove old block-first/layout cards before inserting freshly generated cards.
  // Otherwise stale cards generated from mixed 1214/6079/6086/6094 layouts remain visible.
  cloned.pageCards = cloned.pageCards.map((page) => ({
    ...page,
    left: (page.left || []).filter((card) => !isStaleBlockFirstCard(card)),
    right: (page.right || []).filter((card) => !isStaleBlockFirstCard(card)),
  }));

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

    if (existingIDs.has(card.id)) {
      continue;
    }

    if (card.side === "left") {
      pageBucket.left.push(card);
    } else {
      pageBucket.right.push(card);
    }

    existingIDs.add(card.id);
  }

  cloned.pageCards = cloned.pageCards.filter(
    (page) => (page.left || []).length || (page.right || []).length,
  );

  cloned.pageCards.sort((a, b) => a.page - b.page);

  return cloned;
}

export async function mergeBlockFirstCardsIntoAnalysis(
  attachmentItemID: number,
  analysis: MagicDigestAnalysis | null,
): Promise<MagicDigestAnalysis | null> {
  try {
    const path = await findBlockFirstCardsJSONForAttachment(attachmentItemID);

    if (!path) {
      return clearBlockFirstCardsFromAnalysis(analysis);
    }

    const json = (await readJSON(path)) as BlockFirstCardFile;

    const jsonAttachmentID = Number(json.source?.attachmentItemID || 0);

    // Strict binding:
    // Never load block-first cards generated for another attachment.
    // Old JSON without attachmentItemID is treated as unsafe and ignored.
    if (!jsonAttachmentID || jsonAttachmentID !== Number(attachmentItemID)) {
      ztoolkit.log(
        "magic_digest: skip block-first cards because attachmentItemID mismatch",
        { path, jsonAttachmentID, attachmentItemID },
      );
      return clearBlockFirstCardsFromAnalysis(analysis);
    }

    const cardsRaw = Array.isArray(json.cards) ? json.cards : [];

    if (!cardsRaw.length) {
      return clearBlockFirstCardsFromAnalysis(analysis);
    }

    const cards = cardsRaw
      .filter((x) => safeString(x.title) || safeString(x.summary) || safeString(x.quote))
      .map((x, index) => makeCardFromBlockFirst(x, index));

    if (!cards.length) {
      return clearBlockFirstCardsFromAnalysis(analysis);
    }

    const next = ensureAnalysis(
      clearBlockFirstCardsFromAnalysis(analysis),
      attachmentItemID,
    );

    return mergeCardsIntoAnalysis(next, cards);
  } catch (e) {
    ztoolkit.log("magic_digest: merge block-first cards failed", e);
    return clearBlockFirstCardsFromAnalysis(analysis);
  }
}