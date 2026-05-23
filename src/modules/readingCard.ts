import { buildReadingCardPrompt } from "./readingCardPrompt";
import { generateReadingCardFromMarkdown } from "./deepseekClient";
import { parsePdfWithMineru } from "./mineruClient";
import { getConfig } from "./configService";
import { ensureDir, writeTextFile } from "./fileUtils";

function isPdfAttachment(item: Zotero.Item | null | undefined): boolean {
  return Boolean(
    item?.isAttachment?.() && item.attachmentContentType === "application/pdf",
  );
}

function getSelectedItem(): Zotero.Item | null {
  const win = Zotero.getMainWindow();
  return win.ZoteroPane.getSelectedItems()?.[0] || null;
}

function getPdfAttachmentFromItem(item: Zotero.Item): Zotero.Item | null {
  if (isPdfAttachment(item)) return item;
  if (!item.isRegularItem?.()) return null;

  for (const attId of item.getAttachments()) {
    const att = Zotero.Items.get(attId);
    if (isPdfAttachment(att)) return att;
  }
  return null;
}

async function getPdfPath(item: Zotero.Item): Promise<string | null> {
  const pdf = getPdfAttachmentFromItem(item);
  if (!pdf) return null;

  const path = await (
    pdf as unknown as { getFilePathAsync?: () => Promise<string | false> }
  ).getFilePathAsync?.();

  return path ? String(path) : null;
}

async function sha256OfFile(filePath: string): Promise<string> {
  const io = (globalThis as unknown as {
    IOUtils?: {
      read?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
    };
  }).IOUtils;

  let bytes: Uint8Array | null = null;

  if (io?.read) {
    const data = await io.read(filePath);
    bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  } else {
    const osFile = (globalThis as unknown as {
      OS?: {
        File?: {
          read?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
        };
      };
    }).OS?.File;

    if (osFile?.read) {
      const data = await osFile.read(filePath);
      bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    }
  }

  if (!bytes) {
    throw new Error("Cannot read PDF bytes for hashing");
  }

  const digestBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digestBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function joinPath(...parts: string[]): string {
  return parts.join("\\").replace(/\\+/g, "\\");
}

async function readTextFile(path: string): Promise<string | null> {
  const io = (globalThis as unknown as {
    IOUtils?: {
      readUTF8?: (path: string) => Promise<string>;
      read?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
      exists?: (path: string) => Promise<boolean>;
    };
  }).IOUtils;

  if (io?.exists) {
    const ok = await io.exists(path);
    if (!ok) return null;
  }

  if (io?.readUTF8) {
    try {
      return await io.readUTF8(path);
    } catch {}
  }

  if (io?.read) {
    try {
      const data = await io.read(path);
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      return new TextDecoder("utf-8").decode(bytes);
    } catch {}
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
    } catch {}
  }

  return null;
}

function getItemTitle(item: Zotero.Item): string {
  try {
    return String(item.getField("title") || "").trim();
  } catch {
    return "";
  }
}

function getItemYear(item: Zotero.Item): string {
  try {
    return String(item.getField("year") || "").trim();
  } catch {
    return "";
  }
}

function getItemAbstract(item: Zotero.Item): string {
  try {
    return String(item.getField("abstractNote") || "").trim();
  } catch {
    return "";
  }
}

function getItemAuthors(item: Zotero.Item): string {
  try {
    const creators = item.getCreators() || [];
    return creators
      .map((c: any) => c.name || [c.firstName, c.lastName].filter(Boolean).join(" "))
      .filter(Boolean)
      .join(", ");
  } catch {
    return "";
  }
}

function markdownToNoteHTML(markdown: string): string {
  const escaped = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<pre style="white-space: pre-wrap; font-family: sans-serif;">${escaped}</pre>`;
}

function getRegularParentItemForNote(item: Zotero.Item): Zotero.Item {
  if (item.isRegularItem?.()) {
    return item;
  }

  if (item.isAttachment?.()) {
    const parentID = item.parentID;
    if (parentID) {
      const parent = Zotero.Items.get(parentID);
      if (parent?.isRegularItem?.()) {
        return parent;
      }
    }
  }

  throw new Error("当前选中项不是文献条目，也没有可用的父级文献条目");
}

async function saveReadingCardToNote(item: Zotero.Item, content: string) {
  const parentItem = getRegularParentItemForNote(item);

  const note = new Zotero.Item("note");
  note.parentID = parentItem.id;
  note.setNote(markdownToNoteHTML(content));
  await note.saveTx();
  return note;
}

function openEditableCardDialog(params: {
  title: string;
  content: string;
  onSave: (edited: string) => Promise<void>;
}) {
  const win = Zotero.getMainWindow() as Window;
  const doc = win.document;
  const id = "magic-digest-reading-card-overlay";

  doc.getElementById(id)?.remove();

  const overlay = doc.createElement("div");
  overlay.id = id;
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,.55)";
  overlay.style.zIndex = "999999";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";

  const panel = doc.createElement("div");
  panel.style.width = "900px";
  panel.style.maxWidth = "95vw";
  panel.style.maxHeight = "90vh";
  panel.style.display = "flex";
  panel.style.flexDirection = "column";
  panel.style.background = "#2b2b2b";
  panel.style.color = "#fff";
  panel.style.borderRadius = "12px";
  panel.style.padding = "16px";
  panel.style.boxShadow = "0 12px 40px rgba(0,0,0,.65)";

  const title = doc.createElement("h2");
  title.textContent = params.title;
  title.style.margin = "0 0 10px 0";

  const textarea = doc.createElement("textarea");
  textarea.value = params.content;
  textarea.style.width = "100%";
  textarea.style.height = "65vh";
  textarea.style.boxSizing = "border-box";
  textarea.style.resize = "vertical";
  textarea.style.padding = "10px";
  textarea.style.borderRadius = "8px";
  textarea.style.border = "1px solid #555";
  textarea.style.background = "#1f1f1f";
  textarea.style.color = "#fff";
  textarea.style.fontFamily = "Consolas, monospace";
  textarea.style.fontSize = "13px";

  const actions = doc.createElement("div");
  actions.style.display = "flex";
  actions.style.justifyContent = "flex-end";
  actions.style.gap = "10px";
  actions.style.marginTop = "12px";

  const cancelBtn = doc.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.padding = "8px 14px";

  const saveBtn = doc.createElement("button");
  saveBtn.textContent = "保存到 Zotero 笔记";
  saveBtn.style.padding = "8px 14px";

  const close = () => overlay.remove();

  cancelBtn.onclick = () => close();

  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    try {
      await params.onSave(textarea.value);
      close();
      new ztoolkit.ProgressWindow("magic_digest", {
        closeOnClick: true,
        closeTime: 4000,
      })
        .createLine({
          text: "阅读卡已保存到 Zotero 笔记 ✅",
          type: "success",
          progress: 100,
        })
        .show();
    } catch (e: any) {
      saveBtn.disabled = false;
      new ztoolkit.ProgressWindow("magic_digest", {
        closeOnClick: true,
        closeTime: 8000,
      })
        .createLine({
          text: `保存失败：${e?.message || String(e)}`,
          type: "fail",
          progress: 100,
        })
        .show();
    }
  };

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);

  panel.appendChild(title);
  panel.appendChild(textarea);
  panel.appendChild(actions);
  overlay.appendChild(panel);

  const host = doc.documentElement ?? doc.body;
  if (!host) throw new Error("Cannot find document root");
  host.appendChild(overlay);

  textarea.focus();
}

export async function generateReadingCardForSelectedItem() {
  try {
    const item = getSelectedItem();
    if (!item) {
      throw new Error("请先选中一条文献");
    }

    const pdfPath = await getPdfPath(item);
    if (!pdfPath) {
      throw new Error("未找到可用 PDF 附件");
    }

    const cfg = getConfig();
    const hash = await sha256OfFile(pdfPath);
    const paperDir = joinPath(cfg.cacheRootDir, "mineru", hash, "paper");
    const fullMDPath = joinPath(paperDir, "full.md");

    let markdown = await readTextFile(fullMDPath);

    if (!markdown) {
      const parsed = await parsePdfWithMineru(pdfPath);
      await ensureDir(paperDir);
      await writeTextFile(fullMDPath, parsed.markdown);
      markdown = parsed.markdown;
    }

    if (!markdown) {
      throw new Error("未获得可用 Markdown 内容");
    }

    const prompt = buildReadingCardPrompt({
      title: getItemTitle(item),
      authors: getItemAuthors(item),
      year: getItemYear(item),
      abstractText: getItemAbstract(item),
      markdown,
    });

    const result = await generateReadingCardFromMarkdown(prompt);

    openEditableCardDialog({
      title: "magic_digest 双语阅读卡（可编辑）",
      content: result.content,
      onSave: async (edited) => {
        await saveReadingCardToNote(item, edited);
      },
    });
  } catch (e: any) {
    new ztoolkit.ProgressWindow("magic_digest", {
      closeOnClick: true,
      closeTime: 10000,
    })
      .createLine({
        text: `生成阅读卡失败：${e?.message || String(e)}`,
        type: "fail",
        progress: 100,
      })
      .show();
  }
}