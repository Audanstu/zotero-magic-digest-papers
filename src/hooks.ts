
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
import { openSettingsDialog } from "./modules/settingsDialog";
import { testMineruCacheForSelectedItem } from "./modules/magicDigest";
import { testDeepSeekConnection } from "./modules/deepseekClient";
import { generateReadingCardForSelectedItem } from "./modules/readingCard";
import {
  formatAnalysisError,
  generateAnalysisForSelectedItem,
} from "./modules/paperAnalysisService";
import { openReadingWorkbench } from "./modules/workbenchUI";
import { testMagicDigestDefaultModelFromMenu } from "./modules/defaultModelTest";
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

function registerMenus() {
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-magic-digest-figure-analysis",
    label: "magic_digest ✨：解析论文图表",
    commandListener: async () => {
      await analyzeFiguresForSelectedItem();
    },
  });


  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-magic-digest-block-first-cards",
    label: "magic_digest ✨：基于 Layout 重新生成定位卡片",
    commandListener: async () => {
      await generateBlockFirstCardsForSelectedItem();
    },
  });


  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-magic-digest-default-model-test",
    label: "magic_digest ✨：测试默认模型调用",
    commandListener: async () => {
      await testMagicDigestDefaultModelFromMenu();
    },
  });


  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-magic-digest-open-settings",
    label: "magic_digest ✨：打开设置",
    commandListener: () => {
      openSettingsDialog();
    },
  });

  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-magic-digest-cache-test",
    label: "magic_digest ✨：读取 llm-for-zotero MinerU 缓存",
    commandListener: () => {
      testMineruCacheForSelectedItem();
    },
  });

  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-magic-digest-deepseek-test",
    label: "magic_digest ✨：测试 DeepSeek 连通性",
    commandListener: async () => {
      try {
        const result = await testDeepSeekConnection();

        new ztoolkit.ProgressWindow("magic_digest", {
          closeOnClick: true,
          closeTime: 8000,
        })
          .createLine({
            text: "DeepSeek 连通成功 ✅",
            type: "success",
            progress: 40,
          })
          .createLine({
            text: `model: ${result.model}`,
            type: "default",
            progress: 70,
          })
          .createLine({
            text: result.content,
            type: "default",
            progress: 100,
          })
          .show();
      } catch (e: any) {
        new ztoolkit.ProgressWindow("magic_digest", {
          closeOnClick: true,
          closeTime: 10000,
        })
          .createLine({
            text: `DeepSeek 连通失败：${e?.message || String(e)}`,
            type: "fail",
            progress: 100,
          })
          .show();
      }
    },
  });

  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-magic-digest-reading-card",
    label: "magic_digest ✨：生成双语阅读卡",
    commandListener: async () => {
      await generateReadingCardForSelectedItem();
    },
  });

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

  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-magic-digest-open-workbench",
    label: "magic_digest ✨：打开外部阅读工作台",
    commandListener: async () => {
      const win = Zotero.getMainWindow();
      const item = win.ZoteroPane.getSelectedItems()?.[0];

      if (!item) {
        new ztoolkit.ProgressWindow("magic_digest", {
          closeOnClick: true,
          closeTime: 4000,
        })
          .createLine({
            text: "请先选中一篇已分析的文献或 PDF 附件",
            type: "fail",
            progress: 100,
          })
          .show();
        return;
      }

      try {
        const { resolveLlmForZoteroMineruOutputForItem } = await import(
          "./modules/llmForZoteroMineruProvider"
        );

        const output = await resolveLlmForZoteroMineruOutputForItem(item);

        if (!output) {
          new ztoolkit.ProgressWindow("magic_digest", {
            closeOnClick: true,
            closeTime: 5000,
          })
            .createLine({
              text: "未找到 llm-for-zotero MinerU 缓存，请先解析该 PDF",
              type: "fail",
              progress: 100,
            })
            .show();
          return;
        }

        await openReadingWorkbench(output.attachmentItemID);
      } catch (e: any) {
        new ztoolkit.ProgressWindow("magic_digest", {
          closeOnClick: true,
          closeTime: 8000,
        })
          .createLine({
            text: `打开外部阅读工作台失败：${e?.message || String(e)}`,
            type: "fail",
            progress: 100,
          })
          .show();
      }
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