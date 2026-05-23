import {
  deleteModelConfig,
  getDefaultModelId,
  getModelConfigs,
  maskAPIKey,
  setDefaultModelId,
  testModelConnection,
  upsertModelConfig,
  type MagicDigestModelConfig,
} from "./modelApiSettings";

const MAX_MODEL_CONFIGS = 8;
const DEFAULT_VISIBLE_CONFIG_SLOTS = 3;

const READER_CARD_TYPE_COLORS_PREF = "extensions.magic_digest.reader.cardTypeColors";
const READER_TAG_COLORS_PREF = "extensions.magic_digest.reader.tagColors";
const READER_DEFAULT_SORT_PREF = "extensions.magic_digest.reader.defaultSort";
const READER_UI_LANGUAGE_PREF = "extensions.magic_digest.reader.uiLanguage";

const DEFAULT_CARD_TYPE_COLORS_JSON = JSON.stringify(
  {
    insight: "#2563eb",
    background: "#64748b",
    term: "#10b981",
    method: "#8b5cf6",
    result: "#f59e0b",
    table: "#06b6d4",
    figure: "#ec4899",
    limitation: "#ef4444",
    comparison: "#a855f7",
  },
  null,
  2,
);

const DEFAULT_TAG_COLORS_JSON = JSON.stringify(
  {
    default: "#233554",
    located: "#16a34a",
    "auto-located": "#0ea5e9",
    "full-pdf-auto-located": "#0ea5e9",
    unresolved: "#64748b",
    vision: "#ec4899",
    figure: "#ec4899",
    table: "#06b6d4",
  },
  null,
  2,
);

function getSettingsPref(key: string, fallback = ""): string {
  try {
    const value = (Zotero as any).Prefs?.get?.(key, true);
    if (typeof value === "string" && value.trim()) return value;
  } catch {
    // ignore
  }

  try {
    const value = (Zotero as any).Prefs?.get?.(key);
    if (typeof value === "string" && value.trim()) return value;
  } catch {
    // ignore
  }

  return fallback;
}

function setSettingsPref(key: string, value: string): void {
  try {
    (Zotero as any).Prefs?.set?.(key, value, true);
    return;
  } catch {
    // ignore
  }

  try {
    (Zotero as any).Prefs?.set?.(key, value);
  } catch {
    // ignore
  }
}

function validateColorJSON(raw: string, fallback: string): string {
  const value = String(raw || "").trim();
  if (!value) return fallback;

  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("\u989C\u8272\u914D\u7F6E\u5FC5\u987B\u662F JSON object");
  }

  for (const [key, color] of Object.entries(parsed)) {
    if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new Error("\u989C\u8272\u503C\u683C\u5F0F\u9519\u8BEF: " + key);
    }
  }

  return JSON.stringify(parsed, null, 2);
}

function saveReaderAppearanceSettings(modal: HTMLElement): void {
  const sortSelect = modal.querySelector("#magic-digest-reader-default-sort") as HTMLSelectElement | null;
  const langSelect = modal.querySelector("#magic-digest-reader-ui-language") as HTMLSelectElement | null;
  const typeColors = modal.querySelector("#magic-digest-card-type-colors") as HTMLTextAreaElement | null;
  const tagColors = modal.querySelector("#magic-digest-tag-colors") as HTMLTextAreaElement | null;

  const sort = sortSelect?.value || "page";
  const lang = langSelect?.value || "auto";

  setSettingsPref(READER_DEFAULT_SORT_PREF, ["page", "type", "title"].includes(sort) ? sort : "page");
  setSettingsPref(READER_UI_LANGUAGE_PREF, ["auto", "zh", "en"].includes(lang) ? lang : "auto");

  setSettingsPref(
    READER_CARD_TYPE_COLORS_PREF,
    validateColorJSON(typeColors?.value || "", DEFAULT_CARD_TYPE_COLORS_JSON),
  );

  setSettingsPref(
    READER_TAG_COLORS_PREF,
    validateColorJSON(tagColors?.value || "", DEFAULT_TAG_COLORS_JSON),
  );
}


function nowISO(): string {
  return new Date().toISOString();
}

function makeID(prefix = "model"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHTML(str: string): string {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getMainWindow(): Window {
  const mainWin = Zotero.getMainWindow && Zotero.getMainWindow ? Zotero.getMainWindow() : null;
  if (mainWin) return mainWin;
  throw new Error("无法获取 Zotero 主窗口");
}

function normalizeBaseURL(baseURL: string): string {
  return String(baseURL || "").trim().replace(/\/+$/, "");
}

function createEmptyModelConfig(index: number): MagicDigestModelConfig {
  const t = nowISO();

  return {
    id: makeID("model"),
    name: `自定义模型 ${index}`,
    provider: "openai-compatible",
    baseURL: "",
    apiKey: "",
    model: "",
    enabled: true,
    createdAt: t,
    updatedAt: t,
  };
}

function createDefaultDisplayConfigs(): MagicDigestModelConfig[] {
  const existing = getModelConfigs();
  const result = [...existing];

  while (result.length < DEFAULT_VISIBLE_CONFIG_SLOTS) {
    result.push(createEmptyModelConfig(result.length + 1));
  }

  return result.slice(0, MAX_MODEL_CONFIGS);
}

function showProgress(
  title: string,
  text: string,
  type: "success" | "fail" | "default" = "default",
  closeTime = 4000,
) {
  new ztoolkit.ProgressWindow(title, {
    closeOnClick: true,
    closeTime,
  })
    .createLine({
      text,
      type,
      progress: 100,
    })
    .show();
}

function getInputValue(root: HTMLElement, selector: string): string {
  const el = root.querySelector(selector) as HTMLInputElement | null;
  return String(el?.value || "").trim();
}

function getCheckboxValue(root: HTMLElement, selector: string): boolean {
  const el = root.querySelector(selector) as HTMLInputElement | null;
  return !!el?.checked;
}

function readConfigFromCard(cardEl: HTMLElement): MagicDigestModelConfig {
  const id = String(cardEl.dataset.configId || "").trim() || makeID("model");
  const createdAt =
    String(cardEl.dataset.createdAt || "").trim() || nowISO();

  return {
    id,
    name: getInputValue(cardEl, ".magic-digest-model-name") || "未命名模型",
    provider: "openai-compatible",
    baseURL: normalizeBaseURL(
      getInputValue(cardEl, ".magic-digest-model-baseurl"),
    ),
    apiKey: getInputValue(cardEl, ".magic-digest-model-apikey"),
    model: getInputValue(cardEl, ".magic-digest-model-model"),
    enabled: getCheckboxValue(cardEl, ".magic-digest-model-enabled"),
    createdAt,
    updatedAt: nowISO(),
  };
}

function validateConfig(config: MagicDigestModelConfig): string | null {
  if (!config.name) return "请填写 API 配置名称";
  if (!config.baseURL) return `请填写 ${config.name} 的 Base URL`;
  if (!config.apiKey) return `请填写 ${config.name} 的 API Key`;
  if (!config.model) return `请填写 ${config.name} 的 Model 名称`;
  return null;
}

function renderModelCardHTML(params: {
  config: MagicDigestModelConfig;
  index: number;
  defaultModelId: string;
  canDelete: boolean;
}): string {
  const { config, index, defaultModelId, canDelete } = params;
  const isDefault = config.id === defaultModelId;

  return `
    <div class="magic-digest-model-card"
      data-config-id="${escapeHTML(config.id)}"
      data-created-at="${escapeHTML(config.createdAt || nowISO())}"
      style="
        border:1px solid #334155;
        border-radius:10px;
        padding:12px;
        margin-bottom:12px;
        background:${isDefault ? "rgba(37,99,235,.15)" : "rgba(15,23,42,.72)"};
        box-shadow:${isDefault ? "0 0 0 2px rgba(37,99,235,.22)" : "none"};
      "
    >
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">
        <div style="font-weight:800;font-size:14px;color:#e5e7eb;">
          API 配置 ${index + 1}
          ${
            isDefault
              ? `<span style="margin-left:6px;background:#2563eb;color:#fff;border-radius:999px;padding:1px 7px;font-size:11px;">默认解析模型</span>`
              : ""
          }
        </div>

        <div style="display:flex;gap:6px;align-items:center;">
          <label style="font-size:12px;color:#cbd5e1;display:flex;align-items:center;gap:4px;">
            <input class="magic-digest-model-enabled" type="checkbox" ${
              config.enabled ? "checked" : ""
            } />
            启用
          </label>

          <button class="magic-digest-test-model-btn"
            style="background:#0f766e;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;">
            测试
          </button>

          <button class="magic-digest-set-default-model-btn"
            style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;">
            设为默认
          </button>

          ${
            canDelete
              ? `<button class="magic-digest-delete-model-btn"
                  style="background:#991b1b;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;">
                  删除
                </button>`
              : ""
          }
        </div>
      </div>

      <div style="display:grid;grid-template-columns:120px 1fr;gap:8px 10px;align-items:center;">
        <label style="font-size:12px;color:#94a3b8;">自定义名称</label>
        <input class="magic-digest-model-name"
          value="${escapeHTML(config.name || "")}"
          placeholder="例如：DeepSeek 官方 / Kimi 32K / 本地 Ollama"
          style="width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:7px 8px;font-size:13px;" />

        <label style="font-size:12px;color:#94a3b8;">Base URL</label>
        <input class="magic-digest-model-baseurl"
          value="${escapeHTML(config.baseURL || "")}"
          placeholder="https://api.deepseek.com 或 https://api.openai.com/v1"
          style="width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:7px 8px;font-size:13px;" />

        <label style="font-size:12px;color:#94a3b8;">API Key</label>
        <input class="magic-digest-model-apikey"
          value="${escapeHTML(config.apiKey || "")}"
          placeholder="${escapeHTML(maskAPIKey(config.apiKey || "") || "sk-...")}"
          type="password"
          style="width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:7px 8px;font-size:13px;" />

        <label style="font-size:12px;color:#94a3b8;">Model</label>
        <input class="magic-digest-model-model"
          value="${escapeHTML(config.model || "")}"
          placeholder="deepseek-chat / gpt-4o-mini / qwen-plus / moonshot-v1-32k"
          style="width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:7px 8px;font-size:13px;" />
      </div>

      <div style="font-size:11px;color:#64748b;margin-top:8px;">
        当前仅要求兼容 OpenAI Chat Completions：<code>/v1/chat/completions</code>
      </div>
    </div>
  `;
}

function collectConfigsFromDialog(dialog: HTMLElement): MagicDigestModelConfig[] {
  const cards = Array.from(
    dialog.querySelectorAll(".magic-digest-model-card"),
  ) as HTMLElement[];

  return cards
    .map((card) => readConfigFromCard(card))
    .filter((config) => {
      // 完全空白的默认槽位不保存
      const hasAny =
        config.name ||
        config.baseURL ||
        config.apiKey ||
        config.model;
      return !!hasAny;
    });
}

function renderCards(container: HTMLElement, configs: MagicDigestModelConfig[]) {
  const defaultModelId = getDefaultModelId();

  container.innerHTML = configs
    .slice(0, MAX_MODEL_CONFIGS)
    .map((config, index) =>
      renderModelCardHTML({
        config,
        index,
        defaultModelId,
        canDelete: configs.length > DEFAULT_VISIBLE_CONFIG_SLOTS || index >= DEFAULT_VISIBLE_CONFIG_SLOTS,
      }),
    )
    .join("");
}

function bindModelCardEvents(params: {
  dialog: HTMLElement;
  listEl: HTMLElement;
  getConfigs: () => MagicDigestModelConfig[];
  setConfigs: (configs: MagicDigestModelConfig[]) => void;
}) {
  const { dialog, listEl, getConfigs, setConfigs } = params;

  listEl.addEventListener("click", async (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;

    const cardEl = target.closest(".magic-digest-model-card") as HTMLElement | null;
    if (!cardEl) return;

    if (target.classList.contains("magic-digest-delete-model-btn")) {
      ev.preventDefault();
      ev.stopPropagation();

      const config = readConfigFromCard(cardEl);
      const confirmed = getMainWindow().confirm(
        `确定删除 API 配置「${config.name || config.id}」吗？`,
      );

      if (!confirmed) return;

      let configs = getConfigs();
      configs = configs.filter((x) => x.id !== config.id);

      while (configs.length < DEFAULT_VISIBLE_CONFIG_SLOTS) {
        configs.push(createEmptyModelConfig(configs.length + 1));
      }

      setConfigs(configs);
      renderCards(listEl, configs);

  
      return;
    }

    if (target.classList.contains("magic-digest-set-default-model-btn")) {
      ev.preventDefault();
      ev.stopPropagation();

      const config = readConfigFromCard(cardEl);
      const error = validateConfig(config);

      if (error) {
        showProgress("magic_digest", error, "fail", 5000);
        return;
      }

      upsertModelConfig(config);
      setDefaultModelId(config.id);

      const configs = collectConfigsFromDialog(dialog);
      configs.forEach((x) => upsertModelConfig(x));

      setConfigs(createDefaultDisplayConfigs());
      renderCards(listEl, getConfigs());

      showProgress(
        "magic_digest",
        `已设为默认解析模型：${config.name}`,
        "success",
      );
      return;
    }

    if (target.classList.contains("magic-digest-test-model-btn")) {
      ev.preventDefault();
      ev.stopPropagation();

      const config = readConfigFromCard(cardEl);
      const error = validateConfig(config);

      if (error) {
        showProgress("magic_digest", error, "fail", 5000);
        return;
      }

      target.setAttribute("disabled", "true");
      target.textContent = "测试中...";

      try {
        const result = await testModelConnection(config);

        showProgress(
          "magic_digest",
          `连接成功：${config.name}，返回：${result.content.slice(0, 80)}`,
          "success",
          6000,
        );
      } catch (e: any) {
        showProgress(
          "magic_digest",
          `连接失败：${e?.message || String(e)}`,
          "fail",
          9000,
        );
      } finally {
        target.removeAttribute("disabled");
        target.textContent = "测试";
      }
    }
  });
}


const READER_CARD_TYPE_COLORS_PREF_FOR_DIALOG = "extensions.magic_digest.reader.cardTypeColors";
const READER_TAG_COLORS_PREF_FOR_DIALOG = "extensions.magic_digest.reader.tagColors";
const READER_DEFAULT_SORT_PREF_FOR_DIALOG = "extensions.magic_digest.reader.defaultSort";
const READER_UI_LANGUAGE_PREF_FOR_DIALOG = "extensions.magic_digest.reader.uiLanguage";

const DEFAULT_CARD_TYPE_COLORS_JSON_FOR_DIALOG = JSON.stringify(
  {
    insight: "#2563eb",
    background: "#64748b",
    term: "#10b981",
    method: "#8b5cf6",
    result: "#f59e0b",
    table: "#06b6d4",
    figure: "#ec4899",
    limitation: "#ef4444",
    comparison: "#a855f7",
  },
  null,
  2,
);

const DEFAULT_TAG_COLORS_JSON_FOR_DIALOG = JSON.stringify(
  {
    default: "#233554",
    located: "#16a34a",
    "auto-located": "#0ea5e9",
    "full-pdf-auto-located": "#0ea5e9",
    unresolved: "#64748b",
    vision: "#ec4899",
    figure: "#ec4899",
    table: "#06b6d4",
  },
  null,
  2,
);

function getReaderDialogPref(key: string, fallback = ""): string {
  try {
    const value = (Zotero as any).Prefs?.get?.(key, true);
    if (typeof value === "string" && value.trim()) return value;
  } catch {
    // ignore
  }

  try {
    const value = (Zotero as any).Prefs?.get?.(key);
    if (typeof value === "string" && value.trim()) return value;
  } catch {
    // ignore
  }

  return fallback;
}

function setReaderDialogPref(key: string, value: string): void {
  try {
    (Zotero as any).Prefs?.set?.(key, value, true);
    return;
  } catch {
    // ignore
  }

  try {
    (Zotero as any).Prefs?.set?.(key, value);
  } catch {
    // ignore
  }
}

function validateReaderDialogColorJSON(raw: string, fallback: string): string {
  const value = String(raw || "").trim();
  if (!value) return fallback;

  const parsed = JSON.parse(value);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("\u989C\u8272\u914D\u7F6E\u5FC5\u987B\u662F JSON object");
  }

  for (const [key, color] of Object.entries(parsed)) {
    if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new Error("\u989C\u8272\u503C\u683C\u5F0F\u9519\u8BEF: " + key);
    }
  }

  return JSON.stringify(parsed, null, 2);
}

function appendReaderDisplaySettingsToSettingsDialog(modal: HTMLElement): void {
  if (modal.querySelector("#magic-digest-reader-display-settings-dialog")) return;

  const doc = modal.ownerDocument || ((globalThis as any).document as Document | undefined);

  if (!doc) {
    return;
  }

  const list =
    modal.querySelector("#magic-digest-settings-list") ||
    modal.querySelector(".magic-digest-settings-list") ||
    modal.querySelector(".magic-digest-settings-panel");

  const section = doc.createElement("div");
  section.id = "magic-digest-reader-display-settings-dialog";

  section.setAttribute(
    "style",
    [
      "margin:12px 0 16px",
      "padding:12px",
      "border:1px solid #334155",
      "border-radius:8px",
      "background:#020617",
      "color:#e5e7eb",
      "font-size:13px",
    ].join(";"),
  );

  const currentSort = getReaderDialogPref(READER_DEFAULT_SORT_PREF_FOR_DIALOG, "page");
  const currentLang = getReaderDialogPref(READER_UI_LANGUAGE_PREF_FOR_DIALOG, "auto");

  const typeColors = getReaderDialogPref(
    READER_CARD_TYPE_COLORS_PREF_FOR_DIALOG,
    DEFAULT_CARD_TYPE_COLORS_JSON_FOR_DIALOG,
  );

  const tagColors = getReaderDialogPref(
    READER_TAG_COLORS_PREF_FOR_DIALOG,
    DEFAULT_TAG_COLORS_JSON_FOR_DIALOG,
  );

  section.innerHTML = [
    '<div style="font-size:15px;font-weight:800;margin-bottom:10px;">Reader \u5361\u7247\u663E\u793A\u8BBE\u7F6E</div>',

    '<label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">\u9ED8\u8BA4\u6392\u5E8F</label>',
    '<select id="magic-digest-reader-default-sort-dialog" style="width:220px;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:5px 8px;margin-bottom:10px;">',
      '<option value="page"', currentSort === "page" ? " selected" : "", '>\u6309\u9875\u6392\u5E8F</option>',
      '<option value="type"', currentSort === "type" ? " selected" : "", '>\u6309\u7C7B\u578B\u6392\u5E8F</option>',
      '<option value="title"', currentSort === "title" ? " selected" : "", '>\u6309\u6807\u9898\u6392\u5E8F</option>',
    '</select>',

    '<label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">Reader \u8BED\u8A00</label>',
    '<select id="magic-digest-reader-ui-language-dialog" style="width:220px;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:5px 8px;margin-bottom:10px;">',
      '<option value="auto"', currentLang === "auto" ? " selected" : "", '>\u81EA\u52A8</option>',
      '<option value="zh"', currentLang === "zh" ? " selected" : "", '>\u4E2D\u6587</option>',
      '<option value="en"', currentLang === "en" ? " selected" : "", '>English</option>',
    '</select>',

    '<label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">\u5361\u7247\u7C7B\u578B\u989C\u8272 JSON</label>',
    '<textarea id="magic-digest-card-type-colors-dialog" style="width:100%;height:120px;box-sizing:border-box;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:8px;font-family:monospace;font-size:12px;margin-bottom:10px;"></textarea>',

    '<label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">\u6807\u7B7E\u989C\u8272 JSON</label>',
    '<textarea id="magic-digest-tag-colors-dialog" style="width:100%;height:105px;box-sizing:border-box;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:8px;font-family:monospace;font-size:12px;margin-bottom:10px;"></textarea>',

    '<button id="magic-digest-save-reader-display-settings-dialog" style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;">\u4FDD\u5B58 Reader \u663E\u793A\u8BBE\u7F6E</button>',
    '<span id="magic-digest-reader-display-settings-dialog-msg" style="margin-left:10px;color:#94a3b8;"></span>',
  ].join("");

  const typeArea = section.querySelector("#magic-digest-card-type-colors-dialog") as HTMLTextAreaElement | null;
  const tagArea = section.querySelector("#magic-digest-tag-colors-dialog") as HTMLTextAreaElement | null;

  if (typeArea) typeArea.value = typeColors;
  if (tagArea) tagArea.value = tagColors;

  if (list && list.parentElement) {
    list.parentElement.insertBefore(section, list);
  } else {
    modal.appendChild(section);
  }

  const saveBtn = section.querySelector(
    "#magic-digest-save-reader-display-settings-dialog",
  ) as HTMLButtonElement | null;

  saveBtn?.addEventListener("click", () => {
    const msg = section.querySelector(
      "#magic-digest-reader-display-settings-dialog-msg",
    ) as HTMLElement | null;

    try {
      const sort = String(
        (section.querySelector("#magic-digest-reader-default-sort-dialog") as HTMLSelectElement | null)?.value || "page",
      );

      const lang = String(
        (section.querySelector("#magic-digest-reader-ui-language-dialog") as HTMLSelectElement | null)?.value || "auto",
      );

      const typeColorsNext = String(
        (section.querySelector("#magic-digest-card-type-colors-dialog") as HTMLTextAreaElement | null)?.value || "",
      );

      const tagColorsNext = String(
        (section.querySelector("#magic-digest-tag-colors-dialog") as HTMLTextAreaElement | null)?.value || "",
      );

      setReaderDialogPref(
        READER_DEFAULT_SORT_PREF_FOR_DIALOG,
        ["page", "type", "title"].includes(sort) ? sort : "page",
      );

      setReaderDialogPref(
        READER_UI_LANGUAGE_PREF_FOR_DIALOG,
        ["auto", "zh", "en"].includes(lang) ? lang : "auto",
      );

      setReaderDialogPref(
        READER_CARD_TYPE_COLORS_PREF_FOR_DIALOG,
        validateReaderDialogColorJSON(typeColorsNext, DEFAULT_CARD_TYPE_COLORS_JSON_FOR_DIALOG),
      );

      setReaderDialogPref(
        READER_TAG_COLORS_PREF_FOR_DIALOG,
        validateReaderDialogColorJSON(tagColorsNext, DEFAULT_TAG_COLORS_JSON_FOR_DIALOG),
      );

      if (msg) {
        msg.textContent = "\u5DF2\u4FDD\u5B58\u3002\u8BF7\u91CD\u65B0\u6253\u5F00 PDF \u5361\u7247\u5C42\u3002";
        msg.style.color = "#22c55e";
      }
    } catch (e: any) {
      if (msg) {
        msg.textContent = "\u4FDD\u5B58\u5931\u8D25\uFF1A" + (e?.message || String(e));
        msg.style.color = "#ef4444";
      }
    }
  });
}

export function showSettingsDialog() {
  const win = getMainWindow();
  const doc = win.document;

  const old = doc.getElementById("magic-digest-settings-modal");
  old?.remove();

  let configs = createDefaultDisplayConfigs();

  const modal = doc.createElement("div");
  modal.id = "magic-digest-settings-modal";

  modal.setAttribute(
    "style",
    [
      "position:fixed",
      "left:0",
      "top:0",
      "right:0",
      "bottom:0",
      "z-index:10000000",
      "background:rgba(0,0,0,.55)",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    ].join(";"),
  );

  modal.innerHTML = `
    <div style="
      width:820px;
      max-width:94vw;
      max-height:90vh;
      overflow:auto;
      background:#0f172a;
      color:#e5e7eb;
      border:1px solid #334155;
      border-radius:12px;
      box-shadow:0 24px 80px rgba(0,0,0,.55);
      padding:16px;
    ">
      <div style="position:relative;display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <button id="magic-digest-settings-close-x"
          title="关闭"
          style="position:absolute;right:-6px;top:-8px;background:#1f2937;color:#e5e7eb;border:1px solid #475569;border-radius:999px;width:24px;height:24px;line-height:20px;text-align:center;cursor:pointer;z-index:4;">
          ×
        </button>
        <div>
          <div style="font-size:18px;font-weight:900;">magic_digest 设置</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:2px;">
            管理用于论文解析的 OpenAI-compatible 模型 API。最多 ${MAX_MODEL_CONFIGS} 个。
          </div>
        </div>

        <button id="magic-digest-settings-close"
          style="background:#334155;color:#e5e7eb;border:0;border-radius:8px;padding:5px 10px;cursor:pointer;">
          关闭
        </button>
      </div>

      <div style="
        border:1px solid #1e293b;
        background:#020617;
        border-radius:10px;
        padding:10px;
        margin-bottom:12px;
        font-size:12px;
        color:#cbd5e1;
        line-height:1.5;
      ">
        <div><b>规则：</b></div>
        <div>1. 默认只显示 3 个 API 配置窗口。</div>
        <div>2. 只有点击 “+ 添加模型 API” 才会新增配置窗口。</div>
        <div>3. 最多支持 8 个 API 配置。</div>
        <div>4. 每个 API 都可以自定义名称，并可以设为默认解析模型。</div>
      </div>

      <div id="magic-digest-model-list"></div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;">
        <button id="magic-digest-add-model"
          style="background:#0369a1;color:#fff;border:0;border-radius:8px;padding:6px 12px;cursor:pointer;">
          + 添加模型 API
        </button>

        <div style="display:flex;gap:8px;">
          <button id="magic-digest-save-settings"
            style="background:#16a34a;color:#fff;border:0;border-radius:8px;padding:6px 12px;cursor:pointer;">
            保存设置
          </button>
        </div>
      </div>
    </div>
  `;

  const root = doc.documentElement || doc.body;
  if (!root) {
    throw new Error("无法找到设置窗口挂载节点");
  }

  root.appendChild(modal);

  const magicDigestForceCloseSettingsModal = () => {
    try {
      const m = doc.getElementById("magic-digest-settings-modal");
      if (m && m.parentNode) {
        m.parentNode.removeChild(m);
      }
    } catch {
      // ignore
    }

    try {
      doc.removeEventListener("keydown", magicDigestForceSettingsEscListener, true);
    } catch {
      // ignore
    }
  };

  const magicDigestForceSettingsEscListener = (ev: Event) => {
    const kev = ev as KeyboardEvent;
    if (kev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      magicDigestForceCloseSettingsModal();
    }
  };

  doc.addEventListener("keydown", magicDigestForceSettingsEscListener, true);

  const bindForceClose = (selector: string) => {
    const btn = modal.querySelector(selector) as HTMLElement | null;
    if (!btn) return;

    btn.setAttribute("style", (btn.getAttribute("style") || "") + ";pointer-events:auto;z-index:99999999;");

    btn.addEventListener(
      "mousedown",
      (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
        magicDigestForceCloseSettingsModal();
      },
      true,
    );

    btn.addEventListener(
      "click",
      (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
        magicDigestForceCloseSettingsModal();
      },
      true,
    );
  };

  bindForceClose("#magic-digest-settings-close");
  bindForceClose("#magic-digest-settings-close-x");

  // 点击黑色遮罩关闭；点击内部面板不关闭
  modal.addEventListener(
    "mousedown",
    (ev: Event) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;

      const panel = target.closest(".magic-digest-settings-panel");
      if (!panel) {
        ev.preventDefault();
        ev.stopPropagation();
        magicDigestForceCloseSettingsModal();
      }
    },
    true,
  );


  const listEl = modal.querySelector("#magic-digest-model-list") as HTMLElement;
  appendReaderDisplaySettingsToSettingsDialog(modal);

  renderCards(listEl, configs);

  const closeSettingsModal = () => {
    try {
      modal.remove();
    } catch {
      // ignore
    }

    try {
      doc.removeEventListener("keydown", settingsEscListener);
    } catch {
      // ignore
    }
  };

  const settingsEscListener = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeSettingsModal();
    }
  };

  doc.addEventListener("keydown", settingsEscListener);

  const closeBtn = modal.querySelector(
    "#magic-digest-settings-close",
  ) as HTMLButtonElement | null;

  const closeXBtn = modal.querySelector(
    "#magic-digest-settings-close-x",
  ) as HTMLButtonElement | null;

  const bindCloseButton = (btn: HTMLButtonElement | null) => {
    if (!btn) return;

    btn.onclick = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeSettingsModal();
    };

    btn.addEventListener("click", (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeSettingsModal();
    });
  };

  bindCloseButton(closeBtn);
  bindCloseButton(closeXBtn);

  // 点击黑色遮罩关闭；点击面板内部不关闭
  modal.addEventListener("click", (ev: Event) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;

    const panel = target.closest(".magic-digest-settings-panel");
    if (!panel) {
      ev.preventDefault();
      ev.stopPropagation();
      closeSettingsModal();
    }
  });


  const setConfigs = (next: MagicDigestModelConfig[]) => {
    configs = next.slice(0, MAX_MODEL_CONFIGS);
  };

  const getConfigsLocal = () => configs;

  bindModelCardEvents({
    dialog: modal,
    listEl,
    getConfigs: getConfigsLocal,
    setConfigs,
  });

  modal
    .querySelector("#magic-digest-settings-close")
    ?.addEventListener("click", () => {
      modal.remove();
    });

  modal
    .querySelector("#magic-digest-add-model")
    ?.addEventListener("click", () => {
      const current = collectConfigsFromDialog(modal);

      if (current.length >= MAX_MODEL_CONFIGS) {
        showProgress(
          "magic_digest",
          `最多只能添加 ${MAX_MODEL_CONFIGS} 个 API 配置`,
          "fail",
          5000,
        );
        return;
      }

      current.push(createEmptyModelConfig(current.length + 1));
      setConfigs(current);
      renderCards(listEl, current);
    });

  modal
    .querySelector("#magic-digest-save-settings")
    ?.addEventListener("click", () => {
      saveReaderAppearanceSettings(modal);

      const next = collectConfigsFromDialog(modal);

      const nonEmpty = next.filter(
        (config) =>
          config.baseURL ||
          config.apiKey ||
          config.model ||
          config.name,
      );

      for (const config of nonEmpty) {
        // 只要用户填了任意字段，就要求完整
        const hasRealAPI =
          config.baseURL || config.apiKey || config.model;

        if (hasRealAPI) {
          const error = validateConfig(config);
          if (error) {
            showProgress("magic_digest", error, "fail", 5000);
            return;
          }
        }
      }

      const validConfigs = nonEmpty.filter(
        (x) => x.baseURL && x.apiKey && x.model,
      );

      if (!validConfigs.length) {
        showProgress(
          "magic_digest",
          "请至少配置一个可用的模型 API",
          "fail",
          5000,
        );
        return;
      }

      validConfigs.forEach((x) => upsertModelConfig(x));

      const defaultID = getDefaultModelId();
      if (!validConfigs.some((x) => x.id === defaultID)) {
        setDefaultModelId(validConfigs[0].id);
      }

      showProgress("magic_digest", "模型 API 设置已保存 ✅", "success");

      configs = createDefaultDisplayConfigs();
      renderCards(listEl, configs);
    });
}

// 为了兼容项目里可能存在的不同调用名，统一导出别名
export const openSettingsDialog = showSettingsDialog;
export const showMagicDigestSettingsDialog = showSettingsDialog;
export const openMagicDigestSettingsDialog = showSettingsDialog;