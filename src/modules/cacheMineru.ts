import { config } from "../../package.json";

const PREF_CACHE_ROOT = `${config.prefsPrefix}.cache.rootDir`;

export type MineruCacheHit = {
  hit: boolean;
  hash: string;
  hashDir: string;
  fullMdPath: string;
  metaPath: string;
  fullMd?: string;
  meta?: any;
  reason?: string;
};

function fileExists(pathStr: string): boolean {
  try {
    // Avoid strict XPCOM typing issue
    const Cc: any = (globalThis as any).Components.classes;
    const Ci: any = (globalThis as any).Components.interfaces;
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(pathStr);
    return f.exists();
  } catch {
    return false;
  }
}

async function readTextFile(pathStr: string): Promise<string> {
  const f = (Zotero as any).File;
  if (f.getContentsAsync) return await f.getContentsAsync(pathStr);
  if (f.getContents) return f.getContents(pathStr);
  throw new Error("Zotero.File.getContentsAsync/getContents not available");
}

function joinPath(...parts: string[]): string {
  return parts.join("\\").replace(/\\+/g, "\\");
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256File(pathStr: string): Promise<string> {
  const data = await (Zotero as any).File.getBinaryContentsAsync(pathStr);
  const encoder = new TextEncoder();
  const bytes =
    typeof data === "string" ? encoder.encode(data) : new Uint8Array(data as any);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(digest));
}

export function getCacheRootDir(): string {
  const fromPref = String(Zotero.Prefs.get(PREF_CACHE_ROOT, true) || "").trim();
  if (fromPref) return fromPref;
  // 回退到 Zotero 数据目录
  try {
    const dataDir = (Zotero as any).DataDirectory || "";
    if (dataDir) {
      const pathUtils = (globalThis as any).PathUtils;
      if (pathUtils) {
        return pathUtils.join(String(dataDir), "magic-digest-mineru-cache");
      }
    }
  } catch {
    // ignore
  }
  return "";
}

export async function resolveSelectedItemPdfPath(
  item: Zotero.Item,
): Promise<string | undefined> {
  const anyItem = item as any;
  const attachmentIDs: number[] = anyItem.getAttachments?.() ?? [];
  if (!attachmentIDs.length) return undefined;

  const attachments = await Promise.all(
    attachmentIDs.map((id) => Zotero.Items.getAsync(id)),
  );

  const pdf = attachments.find((att: any) => {
    const ctype = String(att.attachmentContentType || "").toLowerCase();
    const name = String(att.attachmentFilename || "").toLowerCase();
    return ctype.includes("pdf") || name.endsWith(".pdf");
  }) as any;

  if (!pdf) return undefined;

  const p = pdf.getFilePath?.();
  if (!p) return undefined;

  return String(p);
}

export async function readMineruCacheByPdfPath(
  pdfPath: string,
): Promise<MineruCacheHit> {
  try {
    if (!fileExists(pdfPath)) {
      return {
        hit: false,
        hash: "",
        hashDir: "",
        fullMdPath: "",
        metaPath: "",
        reason: "PDF file does not exist",
      };
    }

    const hash = await sha256File(pdfPath);
    const root = getCacheRootDir();
    const hashDir = joinPath(root, "mineru", hash);
    const fullMdPath = joinPath(hashDir, "paper", "full.md");
    const metaPath = joinPath(hashDir, "meta.json");

    if (!fileExists(fullMdPath)) {
      return {
        hit: false,
        hash,
        hashDir,
        fullMdPath,
        metaPath,
        reason: "full.md not found",
      };
    }

    const fullMd = await readTextFile(fullMdPath);
    let meta: any = undefined;

    if (fileExists(metaPath)) {
      try {
        meta = JSON.parse(await readTextFile(metaPath));
      } catch (e) {
        ztoolkit.log("magic_digest meta.json parse fail", e);
      }
    }

    return {
      hit: true,
      hash,
      hashDir,
      fullMdPath,
      metaPath,
      fullMd,
      meta,
    };
  } catch (e: any) {
    return {
      hit: false,
      hash: "",
      hashDir: "",
      fullMdPath: "",
      metaPath: "",
      reason: e?.message || String(e),
    };
  }
}