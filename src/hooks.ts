
function registerMagicDigestPreferencePaneGlobal() {
  try {
    (Zotero as any).MagicDigestPreferencePane = {
      init(doc: Document) {
        initMagicDigestPreferencePane(doc);
      },
    };

    ztoolkit.log("magic_digest: preference pane global init registered");
  } catch (e) {
    ztoolkit.log("magic_digest: register preference pane global failed", e);
  }
}


let magicDigestPreferencePaneRegistered = false;

function registerMagicDigestPreferencePane() {
  if (magicDigestPreferencePaneRegistered) {
    return;
  }

  try {
    if (!(Zotero as any).PreferencePanes?.register) {
      ztoolkit.log("magic_digest: Zotero.PreferencePanes.register unavailable");
      return;
    }

    const pluginID =
      (addon?.data?.config as any)?.addonID ||
      (addon?.data?.config as any)?.id ||
      "magic-digest@local";

    Zotero.PreferencePanes.register({
      pluginID,
      label: "magic_digest",
      src: "chrome://magic_digest/content/preferences.xhtml",
    });

    magicDigestPreferencePaneRegistered = true;

    ztoolkit.log("magic_digest: preference pane registered", {
      pluginID,
      src: "chrome://magic_digest/content/preferences.xhtml",
    });
  } catch (e) {
    ztoolkit.log("magic_digest: register preference pane failed", e);
  }
}

import { createZToolkit } from "./utils/ztoolkit";
import { generateReadingCardForSelectedItem } from "./modules/readingCard";
import {
  formatAnalysisError,
  generateAnalysisForSelectedItem,
} from "./modules/paperAnalysisService";
import { generateBlockFirstCardsForSelectedItem } from "./modules/blockFirstLayoutCards";
import { analyzeFiguresForSelectedItem } from "./modules/figureAnalysis";
import {
  registerReaderIntegration,
  unregisterReaderIntegration,
} from "./modules/readerIntegration";
import { initMagicDigestPreferencePane } from "./modules/preferencePane";
async function onStartup() {
await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  addon.data.ztoolkit = createZToolkit();
  registerMagicDigestPreferencePaneGlobal();
registerMagicDigestPreferencePane();
registerReaderIntegration();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = addon.data.ztoolkit || createZToolkit();
registerMenus();
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  unregisterReaderIntegration();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error
  delete Zotero[addon.data.config.addonInstance];
}

// === 静默执行函数（不弹窗，只返回结果） ===

async function runAnalysisSilent(pw: any): Promise<string> {
  return new Promise((resolve, reject) => {
    generateAnalysisForSelectedItem((ev) => {
      if (ev.stage === "chunk-failed") {
        pw.createLine({ text: `⚠️ 分析: ${ev.message}`, type: "fail", progress: 0 });
      }
    })
      .then((r) => resolve(`完成 (itemID ${r.attachmentItemID})`))
      .catch(reject);
  });
}

async function runFigureSilent(pw: any): Promise<string> {
  const { analyzeFiguresForSelectedItem } = await import("./modules/figureAnalysis");
  // 直接调用，由内部弹窗（可后续优化为静默）
  return new Promise(async (resolve, reject) => {
    try {
      // analyzeFiguresForSelectedItem 内部会创建自己的弹窗，这里我们拦截不到
      // 暂时让它弹自己的，但捕获异常
      await analyzeFiguresForSelectedItem();
      resolve("完成");
    } catch (e: any) {
      reject(e);
    }
  });
}

async function runReadingCardSilent(pw: any): Promise<string> {
  const { generateReadingCardForSelectedItem } = await import("./modules/readingCard");
  try {
    await generateReadingCardForSelectedItem();
    return "完成";
  } catch (e: any) {
    throw e;
  }
}

async function runBlockFirstSilent(pw: any): Promise<string> {
  const { generateBlockFirstCardsForSelectedItem } = await import("./modules/blockFirstLayoutCards");
  try {
    await generateBlockFirstCardsForSelectedItem();
    return "完成";
  } catch (e: any) {
    throw e;
  }
}

function registerMenus() {
  // 0. 一键全部完成
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-magic-digest-full-auto",
    label: "magic_digest ✨：一键全部完成",
    commandListener: async () => {
      const pw = new ztoolkit.ProgressWindow("magic_digest", {
        closeOnClick: true,
        closeTime: -1,
      });

      const tasks: Array<{ name: string; run: () => Promise<string> }> = [
        { name: "全文结构化分析", run: () => runAnalysisSilent(pw) },
        { name: "论文图表", run: () => runFigureSilent(pw) },
        { name: "双语阅读卡", run: () => runReadingCardSilent(pw) },
        { name: "Layout 定位卡片", run: () => runBlockFirstSilent(pw) },
      ];

      pw.createLine({ text: "一键全部完成：启动 4 项任务...", type: "default", progress: 1 }).show();

      const results = await Promise.allSettled(
        tasks.map((t) =>
          t.run().then(
            (msg) => ({ name: t.name, ok: true, msg }),
            (e) => ({ name: t.name, ok: false, msg: e?.message || String(e) }),
          ),
        ),
      );

      for (const r of results) {
        const v = (r as any).value || (r as any).reason || {};
        if (v.ok) {
          pw.createLine({ text: `✅ ${v.name}: ${v.msg}`, type: "success", progress: 95 });
        } else {
          pw.createLine({ text: `❌ ${v.name}: ${v.msg}`, type: "fail", progress: 95 });
        }
      }

      pw.createLine({ text: "一键全部完成 ✅", type: "success", progress: 100 }).show();

      setTimeout(() => { try { pw.close(); } catch { /* noop */ } }, 15000);
    },
  });

  // 1. 生成全文结构化分析
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-magic-digest-generate-analysis",
    label: "magic_digest ✨：生成全文结构化分析",
    commandListener: async () => {
      const pw = new ztoolkit.ProgressWindow("magic_digest", {
        closeOnClick: true,
        closeTime: -1,
      });

      pw.createLine({
        text: "准备生成全文结构化分析...",
        type: "default",
        progress: 1,
      }).show();

      try {
        const result = await generateAnalysisForSelectedItem((ev) => {
          pw.createLine({
            text: ev.message,
            type:
              ev.stage === "chunk-failed"
                ? "fail"
                : ev.stage === "done"
                  ? "success"
                  : "default",
            progress: ev.progress ?? 1,
          }).show();
        });

        pw.createLine({
          text: "全文结构化分析已生成 ✅",
          type: "success",
          progress: 100,
        })
          .createLine({
            text: `PDF附件 itemID: ${result.attachmentItemID}`,
            type: "default",
            progress: 100,
          })
          .createLine({
            text: `analysis.json: ${result.analysisPath}`,
            type: "default",
            progress: 100,
          })
          .show();

        setTimeout(() => {
          try {
            pw.close();
          } catch {
            // ignore
          }
        }, 12000);
      } catch (e: any) {
        pw.createLine({
          text: `生成全文结构化分析失败：${formatAnalysisError(e)}`,
          type: "fail",
          progress: 100,
        }).show();

        setTimeout(() => {
          try {
            pw.close();
          } catch {
            // ignore
          }
        }, 18000);
      }
    },
  });

  // 2. 解析论文图表
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-magic-digest-figure-analysis",
    label: "magic_digest ✨：解析论文图表",
    commandListener: async () => {
      await analyzeFiguresForSelectedItem();
    },
  });

  // 3. 生成双语阅读卡
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-magic-digest-reading-card",
    label: "magic_digest ✨：生成双语阅读卡",
    commandListener: async () => {
      await generateReadingCardForSelectedItem();
    },
  });

  // 4. 基于 Layout 重新生成定位卡片
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-magic-digest-block-first-cards",
    label: "magic_digest ✨：基于 Layout 重新生成定位卡片",
    commandListener: async () => {
      await generateBlockFirstCardsForSelectedItem();
    },
  });
}

async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  ztoolkit.log("magic_digest notify", event, type, ids, extraData);
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  ztoolkit.log("magic_digest prefs event", type, data);
}

function onShortcuts(type: string) {
  ztoolkit.log("magic_digest shortcut", type);
}

function onDialogEvents(type: string) {
  ztoolkit.log("magic_digest dialog event", type);
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};