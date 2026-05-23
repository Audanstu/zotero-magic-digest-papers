import { getConfig } from "./configService";
import { ensureDir, writeTextFile } from "./fileUtils";
import type { MagicDigestAnalysis } from "./analysisSchema";

type ReadApi = {
  exists?: (path: string) => Promise<boolean>;
  read?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
  readUTF8?: (path: string) => Promise<string>;
};

function getIOUtils(): ReadApi | undefined {
  return (globalThis as unknown as { IOUtils?: ReadApi }).IOUtils;
}

function joinPath(...parts: string[]): string {
  return parts.join("\\").replace(/\\+/g, "\\");
}

export function getPaperCachePaths(pdfHash: string) {
  const cfg = getConfig();
  const paperDir = joinPath(cfg.cacheRootDir, "mineru", pdfHash, "paper");

  return {
    paperDir,
    fullMDPath: joinPath(paperDir, "full.md"),
    analysisJSONPath: joinPath(paperDir, "analysis.json"),
    readingPanelMDPath: joinPath(paperDir, "reading-panel.md"),
    readingCardDraftMDPath: joinPath(paperDir, "reading-card-draft.md"),
    visionJSONPath: joinPath(paperDir, "vision.json"),
    boardJSONPath: joinPath(paperDir, "board.json"),
  };
}

export async function pathExists(path: string): Promise<boolean> {
  const io = getIOUtils();
  if (io?.exists) {
    try {
      return Boolean(await io.exists(path));
    } catch {
      return false;
    }
  }
  return false;
}

export async function readTextFile(path: string): Promise<string | null> {
  const io = getIOUtils();

  if (io?.exists) {
    const ok = await pathExists(path);
    if (!ok) return null;
  }

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

  return null;
}

export async function writeJSONFile(path: string, data: unknown) {
  const text = JSON.stringify(data, null, 2);
  await writeTextFile(path, text);
}

export async function readJSONFile<T>(path: string): Promise<T | null> {
  const text = await readTextFile(path);
  if (!text) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function readAnalysis(
  pdfHash: string,
): Promise<MagicDigestAnalysis | null> {
  const paths = getPaperCachePaths(pdfHash);
  return readJSONFile<MagicDigestAnalysis>(paths.analysisJSONPath);
}

export async function writeAnalysis(
  pdfHash: string,
  analysis: MagicDigestAnalysis,
): Promise<string> {
  const paths = getPaperCachePaths(pdfHash);
  await ensureDir(paths.paperDir);

  analysis.meta.updatedAt = new Date().toISOString();

  await writeJSONFile(paths.analysisJSONPath, analysis);
  return paths.analysisJSONPath;
}

export async function readFullMarkdown(pdfHash: string): Promise<string | null> {
  const paths = getPaperCachePaths(pdfHash);
  return readTextFile(paths.fullMDPath);
}

export async function writeReadingPanelMarkdown(
  pdfHash: string,
  markdown: string,
): Promise<string> {
  const paths = getPaperCachePaths(pdfHash);
  await ensureDir(paths.paperDir);
  await writeTextFile(paths.readingPanelMDPath, markdown);
  return paths.readingPanelMDPath;
}

export async function writeReadingCardDraftMarkdown(
  pdfHash: string,
  markdown: string,
): Promise<string> {
  const paths = getPaperCachePaths(pdfHash);
  await ensureDir(paths.paperDir);
  await writeTextFile(paths.readingCardDraftMDPath, markdown);
  return paths.readingCardDraftMDPath;
}