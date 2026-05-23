import { getConfig } from "./configService";

export type LlmForZoteroMineruManifest = {
  sections?: Array<{
    heading?: string;
    page?: number;
    charStart?: number;
    charEnd?: number;
    figures?: unknown[];
    tables?: unknown[];
    equationCount?: number;
  }>;
  allFigures?: Array<{
    label?: string;
    path?: string;
    caption?: string;
    page?: number;
    section?: string;
  }>;
  allTables?: Array<{
    label?: string;
    path?: string;
    caption?: string;
    page?: number;
    section?: string;
  }>;
  totalPages?: number;
  totalChars?: number;
  [key: string]: unknown;
};

export type LlmForZoteroMineruOutput = {
  attachmentItemID: number;
  rootDir: string;
  paperDir: string;
  fullMDPath: string;
  manifestPath: string | null;
  layoutPath: string | null;
  contentListPath: string | null;
  imagesDir: string | null;
  fullMarkdown: string;
  manifest: LlmForZoteroMineruManifest | null;
  hasFullMD: boolean;
  hasManifest: boolean;
  hasLayout: boolean;
  hasContentList: boolean;
  hasImages: boolean;
};

function joinPath(...parts: string[]): string {
  return parts.join("\\").replace(/\\+/g, "\\");
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || "";
}

function getIOUtils(): {
  exists?: (path: string) => Promise<boolean>;
  read?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
  readUTF8?: (path: string) => Promise<string>;
  getChildren?: (path: string) => Promise<string[]>;
} | undefined {
  return (globalThis as unknown as {
    IOUtils?: {
      exists?: (path: string) => Promise<boolean>;
      read?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
      readUTF8?: (path: string) => Promise<string>;
      getChildren?: (path: string) => Promise<string[]>;
    };
  }).IOUtils;
}

async function pathExists(path: string): Promise<boolean> {
  const io = getIOUtils();
  if (io?.exists) {
    try {
      return Boolean(await io.exists(path));
    } catch {
      return false;
    }
  }

  const osFile = (globalThis as unknown as {
    OS?: {
      File?: {
        exists?: (path: string) => Promise<boolean>;
      };
    };
  }).OS?.File;

  if (osFile?.exists) {
    try {
      return Boolean(await osFile.exists(path));
    } catch {
      return false;
    }
  }

  return false;
}

async function listChildren(path: string): Promise<string[]> {
  const io = getIOUtils();
  if (io?.getChildren) {
    try {
      return await io.getChildren(path);
    } catch {
      return [];
    }
  }
  return [];
}

async function readTextFile(path: string): Promise<string | null> {
  const io = getIOUtils();

  if (io?.readUTF8) {
    try {
      return await io.readUTF8(path);
    } catch {
      // fallback
    }
  }

  if (io?.read) {
    try {
      const data = await io.read(path);
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      return null;
    }
  }

  const osFile = (globalThis as unknown as {
    OS?: {
      File?: {
        read?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
      };
    };
  }).OS?.File;

  if (osFile?.read) {
    try {
      const data = await osFile.read(path);
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      return null;
    }
  }

  return null;
}

async function readJSONFile<T>(path: string): Promise<T | null> {
  const text = await readTextFile(path);
  if (!text) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function isPdfAttachment(item: Zotero.Item | null | undefined): boolean {
  return Boolean(
    item?.isAttachment?.() && item.attachmentContentType === "application/pdf",
  );
}

export function getPdfAttachmentFromItem(item: Zotero.Item): Zotero.Item | null {
  if (isPdfAttachment(item)) return item;

  if (!item.isRegularItem?.()) return null;

  for (const attId of item.getAttachments()) {
    const att = Zotero.Items.get(attId);
    if (isPdfAttachment(att)) return att;
  }

  return null;
}

async function findContentListPath(paperDir: string): Promise<string | null> {
  const children = await listChildren(paperDir);

  // llm-for-zotero / MinerU 输出中可能有两种命名：
  // 1. content_list.json
  // 2. xxxxx_content_list.json
  for (const child of children) {
    const name = basename(child).toLowerCase();
    if (name === "content_list.json") {
      return child;
    }
  }

  for (const child of children) {
    const name = basename(child).toLowerCase();
    if (name.endsWith("_content_list.json")) {
      return child;
    }
  }

  return null;
}

async function resolvePaperDirForAttachmentID(
  rootDir: string,
  attachmentItemID: number,
): Promise<string | null> {
  const baseDir = joinPath(rootDir, String(attachmentItemID));

  const candidatePaperDir = joinPath(baseDir, "paper");
  const candidatePaperFull = joinPath(candidatePaperDir, "full.md");

  if (await pathExists(candidatePaperFull)) {
    return candidatePaperDir;
  }

  const candidateDirectFull = joinPath(baseDir, "full.md");
  if (await pathExists(candidateDirectFull)) {
    return baseDir;
  }

  return null;
}

export async function resolveLlmForZoteroMineruOutputForItem(
  item: Zotero.Item,
): Promise<LlmForZoteroMineruOutput | null> {
  const pdf = getPdfAttachmentFromItem(item);
  if (!pdf) return null;

  const attachmentItemID = Number(pdf.id);
  if (!Number.isFinite(attachmentItemID) || attachmentItemID <= 0) {
    return null;
  }

  const cfg = getConfig();
  const rootDir = cfg.llmForZoteroMineruRootDir || cfg.cacheRootDir;

  const paperDir = await resolvePaperDirForAttachmentID(rootDir, attachmentItemID);
  if (!paperDir) return null;

  const fullMDPath = joinPath(paperDir, "full.md");
  const manifestPathRaw = joinPath(paperDir, "manifest.json");
  const layoutPathRaw = joinPath(paperDir, "layout.json");
  const imagesDirRaw = joinPath(paperDir, "images");

  const hasFullMD = await pathExists(fullMDPath);
  if (!hasFullMD) return null;

  const fullMarkdown = await readTextFile(fullMDPath);
  if (!fullMarkdown) return null;

  const hasManifest = await pathExists(manifestPathRaw);
  const hasLayout = await pathExists(layoutPathRaw);
  const contentListPath = await findContentListPath(paperDir);
  const hasContentList = Boolean(contentListPath);
  const hasImages = await pathExists(imagesDirRaw);

  const manifest = hasManifest
    ? await readJSONFile<LlmForZoteroMineruManifest>(manifestPathRaw)
    : null;

  return {
    attachmentItemID,
    rootDir,
    paperDir,
    fullMDPath,
    manifestPath: hasManifest ? manifestPathRaw : null,
    layoutPath: hasLayout ? layoutPathRaw : null,
    contentListPath,
    imagesDir: hasImages ? imagesDirRaw : null,
    fullMarkdown,
    manifest,
    hasFullMD,
    hasManifest,
    hasLayout,
    hasContentList,
    hasImages,
  };
}