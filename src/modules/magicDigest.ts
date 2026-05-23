import { resolveLlmForZoteroMineruOutputForItem } from "./llmForZoteroMineruProvider";

function getSelectedItem(): Zotero.Item | null {
  const win = Zotero.getMainWindow();
  const zp = win.ZoteroPane;
  return zp.getSelectedItems()?.[0] || null;
}

export async function testMineruCacheForSelectedItem() {
  try {
    const item = getSelectedItem();

    if (!item) {
      new ztoolkit.ProgressWindow("magic_digest", {
        closeOnClick: true,
        closeTime: 3000,
      })
        .createLine({
          text: "请先选中一条文献或 PDF 附件",
          type: "fail",
          progress: 100,
        })
        .show();
      return;
    }

    const output = await resolveLlmForZoteroMineruOutputForItem(item);

    if (!output) {
      new ztoolkit.ProgressWindow("magic_digest", {
        closeOnClick: true,
        closeTime: 9000,
      })
        .createLine({
          text: "未找到 llm-for-zotero MinerU 缓存",
          type: "fail",
          progress: 100,
        })
        .createLine({
          text: "请先用 llm-for-zotero 对该 PDF 执行 MinerU 解析",
          type: "default",
          progress: 100,
        })
        .show();
      return;
    }

    const totalPages =
      output.manifest?.totalPages === undefined
        ? "未知"
        : String(output.manifest.totalPages);

    const sections = Array.isArray(output.manifest?.sections)
      ? output.manifest!.sections!.length
      : 0;

    const figures = Array.isArray(output.manifest?.allFigures)
      ? output.manifest!.allFigures!.length
      : 0;

    const tables = Array.isArray(output.manifest?.allTables)
      ? output.manifest!.allTables!.length
      : 0;

    new ztoolkit.ProgressWindow("magic_digest", {
      closeOnClick: true,
      closeTime: 12000,
    })
      .createLine({
        text: "已读取 llm-for-zotero MinerU 缓存 ✅",
        type: "success",
        progress: 100,
      })
      .createLine({
        text: `PDF附件 itemID: ${output.attachmentItemID}`,
        type: "default",
        progress: 100,
      })
      .createLine({
        text: `目录: ${output.paperDir}`,
        type: "default",
        progress: 100,
      })
      .createLine({
        text: `full.md: ${output.hasFullMD ? "✅" : "❌"} manifest: ${output.hasManifest ? "✅" : "❌"} layout: ${output.hasLayout ? "✅" : "❌"} content_list: ${output.hasContentList ? "✅" : "❌"} images: ${output.hasImages ? "✅" : "❌"}`,
        type: "default",
        progress: 100,
      })
      .createLine({
        text: `pages: ${totalPages} sections: ${sections} figures: ${figures} tables: ${tables}`,
        type: "default",
        progress: 100,
      })
      .show();
  } catch (e: any) {
    new ztoolkit.ProgressWindow("magic_digest", {
      closeOnClick: true,
      closeTime: 12000,
    })
      .createLine({
        text: `读取 llm-for-zotero MinerU 缓存失败：${e?.message || String(e)}`,
        type: "fail",
        progress: 100,
      })
      .show();
  }
}