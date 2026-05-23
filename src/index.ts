import { showSettingsDialog } from "./modules/settingsDialog";
import { BasicTool } from "zotero-plugin-toolkit";
import Addon from "./addon";
import { config } from "../package.json";

const basicTool = new BasicTool();

// @ts-expect-error - Plugin instance is not typed
if (!basicTool.getGlobal("Zotero")[config.addonInstance]) {
  _globalThis.addon = new Addon();
  defineGlobal("ztoolkit", () => {
    return _globalThis.addon.data.ztoolkit;
  });
  // @ts-expect-error - Plugin instance is not typed
  Zotero[config.addonInstance] = addon;
}

function defineGlobal(name: Parameters<BasicTool["getGlobal"]>[0]): void;
function defineGlobal(name: string, getter: () => any): void;
function defineGlobal(name: string, getter?: () => any) {
  Object.defineProperty(_globalThis, name, {
    get() {
      return getter ? getter() : basicTool.getGlobal(name);
    },
  });
}


function registerMagicDigestSettingsMenu() {
  try {
    const win = Zotero.getMainWindow ? Zotero.getMainWindow() : null;
    const doc = win?.document;
    if (!win || !doc) {
      ztoolkit.log("magic_digest: cannot get main window for settings menu");
      return;
    }

    if (doc.getElementById("magic-digest-tools-settings-menuitem")) {
      return;
    }

    const menuitem = doc.createXULElement
      ? doc.createXULElement("menuitem")
      : doc.createElement("menuitem");

    menuitem.id = "magic-digest-tools-settings-menuitem";
    menuitem.setAttribute("label", "magic_digest 设置 / 模型 API");
    menuitem.setAttribute("tooltiptext", "配置 magic_digest 模型 API、默认解析模型");

    menuitem.addEventListener("command", () => {
      try {
        showSettingsDialog();
      } catch (e) {
        ztoolkit.log("magic_digest: open settings failed", e);
        new ztoolkit.ProgressWindow("magic_digest", {
          closeOnClick: true,
          closeTime: 8000,
        })
          .createLine({
            text: "打开设置失败：" + (((e as any)?.message) || String(e)),
            type: "fail",
            progress: 100,
          })
          .show();
      }
    });

    const toolsPopup =
      doc.getElementById("menu_ToolsPopup") ||
      doc.getElementById("taskPopup") ||
      doc.querySelector("#menu_ToolsPopup");

    if (toolsPopup) {
      toolsPopup.appendChild(menuitem);
      ztoolkit.log("magic_digest: settings menu item appended to Tools");
      return;
    }

    // 兜底：插到主菜单栏
    const menubar =
      doc.getElementById("main-menubar") ||
      doc.querySelector("menubar");

    if (menubar) {
      const menu = doc.createXULElement
        ? doc.createXULElement("menu")
        : doc.createElement("menu");

      menu.id = "magic-digest-main-menu";
      menu.setAttribute("label", "magic_digest");

      const popup = doc.createXULElement
        ? doc.createXULElement("menupopup")
        : doc.createElement("menupopup");

      popup.appendChild(menuitem);
      menu.appendChild(popup);
      menubar.appendChild(menu);

      ztoolkit.log("magic_digest: settings menu item appended to menubar fallback");
    }
  } catch (e) {
    ztoolkit.log("magic_digest: registerMagicDigestSettingsMenu failed", e);
  }
}



try {
  registerMagicDigestSettingsMenu();
} catch (e) {
  ztoolkit.log("magic_digest: immediate settings menu registration failed", e);
}
