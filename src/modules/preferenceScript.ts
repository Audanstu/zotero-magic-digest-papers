import {
  getDefaultModelConfig,
  getDefaultModelId,
  getModelConfigs,
  maskAPIKey,
  saveModelConfigs,
  setDefaultModelId,
  testModelConnection,
  type MagicDigestModelConfig,
} from "./modelApiSettings";

const MAX_MODEL_CONFIGS = 8;
const DEFAULT_VISIBLE_CONFIG_SLOTS = 3;

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

function normalizeBaseURL(baseURL: string): string {
  return String(baseURL || "").trim().replace(/\/+$/, "");
}

function getPrefDocument(): Document {
  const doc = (globalThis as any).document as Document | undefined;
  if (!doc) {
    throw new Error("preferenceScript: document is not available");
  }
  return doc;
}

function delay(fn: () => void, ms: number) {
  const st = (globalThis as any).setTimeout;
  if (typeof st === "function") {
    st(fn, ms);
  }
}

function showProgress(
  text: string,
  type: "success" | "fail" | "default" = "default",
  closeTime = 4500,
) {
  new ztoolkit.ProgressWindow("magic_digest", {
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

function getDisplayConfigs(): MagicDigestModelConfig[] {
  const existing = getModelConfigs();
  const result = [...existing];

  while (result.length < DEFAULT_VISIBLE_CONFIG_SLOTS) {
    result.push(createEmptyModelConfig(result.length + 1));
  }

  return result.slice(0, MAX_MODEL_CONFIGS);
}

function setText(id: string, text: string) {
  const doc = getPrefDocument();
  const el = doc.getElementById(id);
  if (el) {
    el.textContent = text;
  }
}

function refreshCurrentModelText() {
  try {
    const config = getDefaultModelConfig();
    const configs = getModelConfigs();

    if (!configs.length) {
      setText("magic-digest-pref-current-model", "当前默认解析模型：未配置");
      return;
    }

    if (!config) {
      setText("magic-digest-pref-current-model", "当前默认解析模型：未设置");
      return;
    }

    const status = config.enabled ? "启用" : "禁用";

    setText(
      "magic-digest-pref-current-model",
      `当前默认解析模型：${config.name} / ${config.model} / ${status}`,
    );
  } catch (e: any) {
    setText(
      "magic-digest-pref-current-model",
      `当前默认解析模型：读取失败：${e?.message || String(e)}`,
    );
  }
}

function renderModelCardHTML(params: {
  config: MagicDigestModelConfig;
  index: number;
  defaultModelId: string;
  total: number;
}): string {
  const { config, index, defaultModelId, total } = params;
  const isDefault = config.id === defaultModelId;

  const canDelete = total > DEFAULT_VISIBLE_CONFIG_SLOTS;

  return `
    <div class="magic-digest-model-card"
      data-config-id="${escapeHTML(config.id)}"
      data-created-at="${escapeHTML(config.createdAt || nowISO())}"
      style="
        border: 1px solid var(--fill-quinary);
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 12px;
        background: ${isDefault ? "rgba(37,99,235,.13)" : "var(--material-background)"};
        box-shadow: ${isDefault ? "0 0 0 2px rgba(37,99,235,.22)" : "none"};
      "
    >
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">
        <div style="font-weight:700;font-size:14px;">
          API 配置 ${index + 1}
          ${
            isDefault
              ? `<span style="margin-left:6px;background:#2563eb;color:#fff;border-radius:999px;padding:1px 7px;font-size:11px;">默认解析模型</span>`
              : ""
          }
        </div>

        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <label style="font-size:12px;display:flex;align-items:center;gap:4px;">
            <input class="magic-digest-model-enabled" type="checkbox" ${
              config.enabled ? "checked" : ""
            } />
            启用
          </label>

          <button class="magic-digest-test-model-btn" type="button"
            style="background:#0f766e;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;">
            测试
          </button>

          <button class="magic-digest-set-default-model-btn" type="button"
            style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;">
            设为默认
          </button>

          ${
            canDelete
              ? `<button class="magic-digest-delete-model-btn" type="button"
                  style="background:#991b1b;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;">
                  删除
                </button>`
              : ""
          }
        </div>
      </div>

      <div style="display:grid;grid-template-columns:120px minmax(0, 1fr);gap:8px 10px;align-items:center;">
        <label style="font-size:12px;color:var(--fill-secondary);">自定义名称</label>
        <input class="magic-digest-model-name"
          value="${escapeHTML(config.name || "")}"
          placeholder="例如：DeepSeek 官方 / Kimi 32K / 本地 Ollama"
          style="width:100%;box-sizing:border-box;border:1px solid var(--fill-quaternary);border-radius:6px;padding:6px 8px;font-size:13px;" />

        <label style="font-size:12px;color:var(--fill-secondary);">Base URL</label>
        <input class="magic-digest-model-baseurl"
          value="${escapeHTML(config.baseURL || "")}"
          placeholder="https://api.deepseek.com 或 https://api.openai.com/v1"
          style="width:100%;box-sizing:border-box;border:1px solid var(--fill-quaternary);border-radius:6px;padding:6px 8px;font-size:13px;" />

        <label style="font-size:12px;color:var(--fill-secondary);">API Key</label>
        <input class="magic-digest-model-apikey"
          value="${escapeHTML(config.apiKey || "")}"
          placeholder="${escapeHTML(maskAPIKey(config.apiKey || "") || "sk-...")}"
          type="password"
          style="width:100%;box-sizing:border-box;border:1px solid var(--fill-quaternary);border-radius:6px;padding:6px 8px;font-size:13px;" />

        <label style="font-size:12px;color:var(--fill-secondary);">Model</label>
        <input class="magic-digest-model-model"
          value="${escapeHTML(config.model || "")}"
          placeholder="deepseek-chat / gpt-4o-mini / qwen-plus / moonshot-v1-32k"
          style="width:100%;box-sizing:border-box;border:1px solid var(--fill-quaternary);border-radius:6px;padding:6px 8px;font-size:13px;" />
      </div>

      <div style="font-size:11px;color:var(--fill-tertiary);margin-top:8px;">
        当前仅要求兼容 OpenAI Chat Completions：/v1/chat/completions
      </div>
    </div>
  `;
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
  const createdAt = String(cardEl.dataset.createdAt || "").trim() || nowISO();

  return {
    id,
    name: getInputValue(cardEl, ".magic-digest-model-name") || "未命名模型",
    provider: "openai-compatible",
    baseURL: normalizeBaseURL(getInputValue(cardEl, ".magic-digest-model-baseurl")),
    apiKey: getInputValue(cardEl, ".magic-digest-model-apikey"),
    model: getInputValue(cardEl, ".magic-digest-model-model"),
    enabled: getCheckboxValue(cardEl, ".magic-digest-model-enabled"),
    createdAt,
    updatedAt: nowISO(),
  };
}

function collectConfigs(): MagicDigestModelConfig[] {
  const doc = getPrefDocument();
  const cards = Array.from(
    doc.querySelectorAll(".magic-digest-model-card"),
  ) as HTMLElement[];

  return cards.map((card) => readConfigFromCard(card));
}

function isBlankConfig(config: MagicDigestModelConfig): boolean {
  return !config.baseURL && !config.apiKey && !config.model;
}

function validateConfig(config: MagicDigestModelConfig): string | null {
  if (!config.name) return "请填写 API 配置名称";
  if (!config.baseURL) return `请填写 ${config.name} 的 Base URL`;
  if (!config.apiKey) return `请填写 ${config.name} 的 API Key`;
  if (!config.model) return `请填写 ${config.name} 的 Model 名称`;
  return null;
}

let displayConfigs: MagicDigestModelConfig[] = [];

function renderModelList() {
  const doc = getPrefDocument();
  const list = doc.getElementById("magic-digest-model-list") as HTMLElement | null;

  if (!list) return;

  const defaultModelId = getDefaultModelId();

  list.innerHTML = displayConfigs
    .slice(0, MAX_MODEL_CONFIGS)
    .map((config, index) =>
      renderModelCardHTML({
        config,
        index,
        defaultModelId,
        total: displayConfigs.length,
      }),
    )
    .join("");

  refreshCurrentModelText();
}

function saveCurrentConfigs(): boolean {
  const configs = collectConfigs();

  const validConfigs: MagicDigestModelConfig[] = [];

  for (const config of configs) {
    if (isBlankConfig(config)) {
      continue;
    }

    const error = validateConfig(config);
    if (error) {
      showProgress(error, "fail", 6000);
      return false;
    }

    validConfigs.push(config);
  }

  if (!validConfigs.length) {
    showProgress("请至少配置一个可用的模型 API", "fail", 6000);
    return false;
  }

  saveModelConfigs(validConfigs);

  const defaultID = getDefaultModelId();
  if (!validConfigs.some((x) => x.id === defaultID)) {
    setDefaultModelId(validConfigs[0].id);
  }

  displayConfigs = getDisplayConfigs();

  try {
    renderMagicDigestReaderSettingsPage();
  } catch (e) {
    ztoolkit.log("magic_digest render reader settings in preferenceScript failed", e);
  }
  renderModelList();
  showProgress("模型 API 设置已保存 ✅", "success");

  return true;
}

function bindEvents() {
  const doc = getPrefDocument();

  const addBtn = doc.getElementById("magic-digest-add-model");
  addBtn?.addEventListener("click", (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();

    const current = collectConfigs();

    if (current.length >= MAX_MODEL_CONFIGS) {
      showProgress(`最多只能添加 ${MAX_MODEL_CONFIGS} 个 API 配置`, "fail");
      return;
    }

    current.push(createEmptyModelConfig(current.length + 1));
    displayConfigs = current;
    renderModelList();
  });

  const saveBtn = doc.getElementById("magic-digest-save-settings");
  saveBtn?.addEventListener("click", (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    saveCurrentConfigs();
  });

  const list = doc.getElementById("magic-digest-model-list");
  list?.addEventListener("click", async (ev: Event) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;

    const cardEl = target.closest(".magic-digest-model-card") as HTMLElement | null;
    if (!cardEl) return;

    if (target.classList.contains("magic-digest-delete-model-btn")) {
      ev.preventDefault();
      ev.stopPropagation();

      const config = readConfigFromCard(cardEl);

      const confirmed = (globalThis as any).confirm
        ? (globalThis as any).confirm(`确定删除 API 配置「${config.name}」吗？`)
        : true;

      if (!confirmed) return;

      displayConfigs = collectConfigs().filter((x) => x.id !== config.id);

      while (displayConfigs.length < DEFAULT_VISIBLE_CONFIG_SLOTS) {
        displayConfigs.push(createEmptyModelConfig(displayConfigs.length + 1));
      }

      renderModelList();
      return;
    }

    if (target.classList.contains("magic-digest-set-default-model-btn")) {
      ev.preventDefault();
      ev.stopPropagation();

      const config = readConfigFromCard(cardEl);
      const error = validateConfig(config);

      if (error) {
        showProgress(error, "fail", 6000);
        return;
      }

      const all = collectConfigs().filter((x) => !isBlankConfig(x));
      saveModelConfigs(all);
      setDefaultModelId(config.id);

      displayConfigs = getDisplayConfigs();
      renderModelList();

      showProgress(`已设为默认解析模型：${config.name}`, "success");
      return;
    }

    if (target.classList.contains("magic-digest-test-model-btn")) {
      ev.preventDefault();
      ev.stopPropagation();

      const btn = target as HTMLButtonElement;
      const config = readConfigFromCard(cardEl);
      const error = validateConfig(config);

      if (error) {
        showProgress(error, "fail", 6000);
        return;
      }

      btn.disabled = true;
      btn.textContent = "测试中...";

      try {
        const result = await testModelConnection(config);

        showProgress(
          `连接成功：${config.name}，返回：${result.content.slice(0, 80)}`,
          "success",
          7000,
        );
      } catch (e: any) {
        showProgress(
          `连接失败：${e?.message || String(e)}`,
          "fail",
          9000,
        );
      } finally {
        btn.disabled = false;
        btn.textContent = "测试";
      }
    }
  });
}


const READER_CARD_TYPE_COLORS_PREF_SCRIPT = "extensions.magic_digest.reader.cardTypeColors";
const READER_TAG_COLORS_PREF_SCRIPT = "extensions.magic_digest.reader.tagColors";
const READER_DEFAULT_SORT_PREF_SCRIPT = "extensions.magic_digest.reader.defaultSort";
const READER_UI_LANGUAGE_PREF_SCRIPT = "extensions.magic_digest.reader.uiLanguage";

const DEFAULT_CARD_TYPE_COLORS_JSON_SCRIPT = JSON.stringify(
  {
    insight: "#2563eb",
    background: "#64748b",
    term: "#10b981",
    method: "#8b5cf6",
    result: "#f59e0b",
    table: "#06b6d4",
    figure: "#ec4899",
    limitation: "#ef4444",
    comparison: "#a855f7"
  },
  null,
  2
);

const DEFAULT_TAG_COLORS_JSON_SCRIPT = JSON.stringify(
  {
    default: "#233554",
    located: "#16a34a",
    "auto-located": "#0ea5e9",
    "full-pdf-auto-located": "#0ea5e9",
    unresolved: "#64748b",
    vision: "#ec4899",
    figure: "#ec4899",
    table: "#06b6d4"
  },
  null,
  2
);

function getReaderScriptPref(key: string, fallback = ""): string {
  try {
    const value = (Zotero as any).Prefs?.get?.(key, true);
    if (typeof value === "string" && value.trim()) return value;
  } catch {}

  try {
    const value = (Zotero as any).Prefs?.get?.(key);
    if (typeof value === "string" && value.trim()) return value;
  } catch {}

  return fallback;
}

function setReaderScriptPref(key: string, value: string): void {
  try {
    (Zotero as any).Prefs?.set?.(key, value, true);
    return;
  } catch {}

  try {
    (Zotero as any).Prefs?.set?.(key, value);
  } catch {}
}

function escapeReaderSettingsHTMLScript(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function validateReaderSettingsColorJSONScript(raw: string, fallback: string): string {
  const value = String(raw || "").trim();
  if (!value) return fallback;

  const parsed = JSON.parse(value);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("颜色配置必须是 JSON object");
  }

  for (const [key, color] of Object.entries(parsed)) {
    if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new Error("颜色值格式错误: " + key);
    }
  }

  return JSON.stringify(parsed, null, 2);
}

function renderMagicDigestReaderSettingsPage(): void {
  const doc = getPrefDocument();

  if (doc.getElementById("magic-digest-reader-settings-script")) {
    return;
  }

  const root =
    doc.getElementById("magic-digest-pref-root") ||
    doc.getElementById("magic-digest-model-settings-root") ||
    doc.body ||
    doc.documentElement;

  if (!root) return;

  const currentSort = getReaderScriptPref(READER_DEFAULT_SORT_PREF_SCRIPT, "page");
  const currentLang = getReaderScriptPref(READER_UI_LANGUAGE_PREF_SCRIPT, "auto");
  const typeColors = getReaderScriptPref(
    READER_CARD_TYPE_COLORS_PREF_SCRIPT,
    DEFAULT_CARD_TYPE_COLORS_JSON_SCRIPT,
  );
  const tagColors = getReaderScriptPref(
    READER_TAG_COLORS_PREF_SCRIPT,
    DEFAULT_TAG_COLORS_JSON_SCRIPT,
  );

  const section = doc.createElement("div");
  section.id = "magic-digest-reader-settings-script";
  section.setAttribute(
    "style",
    [
      "margin:12px 0 18px",
      "padding:14px",
      "border:1px solid #334155",
      "border-radius:8px",
      "background:#020617",
      "color:#e5e7eb",
      "font-size:13px"
    ].join(";"),
  );

  section.innerHTML = [
    '<div style="display:flex;gap:8px;margin-bottom:12px;border-bottom:1px solid #334155;padding-bottom:8px;">',
      '<button id="magic-digest-pref-tab-api-visible" style="background:#334155;color:#e5e7eb;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:700;">API 设置</button>',
      '<button id="magic-digest-pref-tab-reader-visible" style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:700;">Reader 显示</button>',
    '</div>',

    '<div style="font-size:16px;font-weight:800;margin-bottom:12px;">Reader 卡片显示设置</div>',

    '<label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">默认排序</label>',
    '<select id="magic-digest-reader-default-sort-script" style="width:240px;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:6px 8px;margin-bottom:12px;">',
      '<option value="page"', currentSort === "page" ? " selected" : "", '>按页排序</option>',
      '<option value="type"', currentSort === "type" ? " selected" : "", '>按类型排序</option>',
      '<option value="title"', currentSort === "title" ? " selected" : "", '>按标题排序</option>',
    '</select>',

    '<label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">Reader 语言</label>',
    '<select id="magic-digest-reader-ui-language-script" style="width:240px;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:6px 8px;margin-bottom:12px;">',
      '<option value="auto"', currentLang === "auto" ? " selected" : "", '>自动</option>',
      '<option value="zh"', currentLang === "zh" ? " selected" : "", '>中文</option>',
      '<option value="en"', currentLang === "en" ? " selected" : "", '>English</option>',
    '</select>',

    '<label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">卡片类型颜色 JSON</label>',
    '<textarea id="magic-digest-card-type-colors-script" style="width:100%;height:150px;box-sizing:border-box;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:8px;font-family:monospace;font-size:12px;margin-bottom:12px;">',
      escapeReaderSettingsHTMLScript(typeColors),
    '</textarea>',

    '<label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">标签颜色 JSON</label>',
    '<textarea id="magic-digest-tag-colors-script" style="width:100%;height:130px;box-sizing:border-box;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:8px;font-family:monospace;font-size:12px;margin-bottom:12px;">',
      escapeReaderSettingsHTMLScript(tagColors),
    '</textarea>',

    '<div style="font-size:11px;color:#94a3b8;margin-bottom:12px;">颜色格式为 #RRGGBB。保存后请关闭并重新打开 PDF 卡片层。</div>',

    '<button id="magic-digest-save-reader-settings-script" style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:700;">保存 Reader 显示设置</button>',
    '<span id="magic-digest-reader-settings-script-msg" style="margin-left:10px;color:#94a3b8;"></span>'
  ].join("");

  root.insertBefore(section, root.firstChild);

  const saveBtn = section.querySelector(
    "#magic-digest-save-reader-settings-script",
  ) as HTMLButtonElement | null;

  saveBtn?.addEventListener("click", () => {
    const msg = section.querySelector(
      "#magic-digest-reader-settings-script-msg",
    ) as HTMLElement | null;

    try {
      const sort = String(
        (section.querySelector("#magic-digest-reader-default-sort-script") as HTMLSelectElement | null)?.value || "page",
      );

      const lang = String(
        (section.querySelector("#magic-digest-reader-ui-language-script") as HTMLSelectElement | null)?.value || "auto",
      );

      const typeColorsNext = String(
        (section.querySelector("#magic-digest-card-type-colors-script") as HTMLTextAreaElement | null)?.value || "",
      );

      const tagColorsNext = String(
        (section.querySelector("#magic-digest-tag-colors-script") as HTMLTextAreaElement | null)?.value || "",
      );

      setReaderScriptPref(
        READER_DEFAULT_SORT_PREF_SCRIPT,
        ["page", "type", "title"].includes(sort) ? sort : "page",
      );

      setReaderScriptPref(
        READER_UI_LANGUAGE_PREF_SCRIPT,
        ["auto", "zh", "en"].includes(lang) ? lang : "auto",
      );

      setReaderScriptPref(
        READER_CARD_TYPE_COLORS_PREF_SCRIPT,
        validateReaderSettingsColorJSONScript(typeColorsNext, DEFAULT_CARD_TYPE_COLORS_JSON_SCRIPT),
      );

      setReaderScriptPref(
        READER_TAG_COLORS_PREF_SCRIPT,
        validateReaderSettingsColorJSONScript(tagColorsNext, DEFAULT_TAG_COLORS_JSON_SCRIPT),
      );

      if (msg) {
        msg.textContent = "已保存。请重新打开 PDF 卡片层。";
        msg.style.color = "#22c55e";
      }
    } catch (e: any) {
      if (msg) {
        msg.textContent = "保存失败：" + (e?.message || String(e));
        msg.style.color = "#ef4444";
      }
    }
  });
}

function initPreferencePane() {
  ztoolkit.log("magic_digest preferenceScript loaded");

  displayConfigs = getDisplayConfigs();

  renderModelList();
  bindEvents();
  refreshCurrentModelText();

  // 设置页打开后延迟刷新一次，避免 Prefs 初始化顺序问题
  delay(() => {
    displayConfigs = getDisplayConfigs();
    renderModelList();
  }, 300);
}

const prefDoc = getPrefDocument();

if (prefDoc.readyState === "loading") {
  prefDoc.addEventListener("DOMContentLoaded", initPreferencePane, {
    once: true,
  });
} else {
  initPreferencePane();
}