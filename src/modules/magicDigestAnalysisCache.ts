import { getConfig } from "./configService";
import { ensureDir, writeTextFile } from "./fileUtils";
import type { MagicDigestAnalysis } from "./analysisSchema";

function joinPath(...parts: string[]): string {
  return parts.join("\\").replace(/\\+/g, "\\");
}

function getIOUtils(): {
  exists?: (path: string) => Promise<boolean>;
  read?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
  readUTF8?: (path: string) => Promise<string>;
} | undefined {
  return (globalThis as unknown as {
    IOUtils?: {
      exists?: (path: string) => Promise<boolean>;
      read?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
      readUTF8?: (path: string) => Promise<string>;
    };
  }).IOUtils;
}

export function getMagicDigestPaperDir(attachmentItemID: number): string {
  const cfg = getConfig();
  return joinPath(cfg.magicDigestDataRootDir, String(attachmentItemID));
}

export function getMagicDigestAnalysisPath(attachmentItemID: number): string {
  return joinPath(getMagicDigestPaperDir(attachmentItemID), "analysis.json");
}

export function getMagicDigestReadingCardDraftPath(
  attachmentItemID: number,
): string {
  return joinPath(
    getMagicDigestPaperDir(attachmentItemID),
    "reading-card-draft.md",
  );
}

export function getMagicDigestVisionPath(attachmentItemID: number): string {
  return joinPath(getMagicDigestPaperDir(attachmentItemID), "vision.json");
}

export async function readTextFile(path: string): Promise<string | null> {
  const io = getIOUtils();

  if (io?.exists) {
    try {
      const ok = await io.exists(path);
      if (!ok) return null;
    } catch {
      return null;
    }
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

export async function readJSONFile<T>(path: string): Promise<T | null> {
  const text = await readTextFile(path);
  if (!text) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function writeAnalysisFile(
  attachmentItemID: number,
  analysis: MagicDigestAnalysis,
): Promise<string> {
  const dir = getMagicDigestPaperDir(attachmentItemID);
  await ensureDir(dir);

  analysis.meta.updatedAt = new Date().toISOString();

  const path = getMagicDigestAnalysisPath(attachmentItemID);
  await writeTextFile(path, JSON.stringify(analysis, null, 2));
  return path;
}

export async function readAnalysisFile(
  attachmentItemID: number,
): Promise<MagicDigestAnalysis | null> {
  return readJSONFile<MagicDigestAnalysis>(
    getMagicDigestAnalysisPath(attachmentItemID),
  );
}

export async function writeReadingCardDraftFile(
  attachmentItemID: number,
  markdown: string,
): Promise<string> {
  const dir = getMagicDigestPaperDir(attachmentItemID);
  await ensureDir(dir);

  const path = getMagicDigestReadingCardDraftPath(attachmentItemID);
  await writeTextFile(path, markdown);
  return path;
}