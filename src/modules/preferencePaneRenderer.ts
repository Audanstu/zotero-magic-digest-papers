import {
  getDefaultModelConfig,
  getDefaultModelId,
  getModelConfigs,
  saveModelConfigs,
  setDefaultModelId,
  testModelConnection,
  type MagicDigestModelConfig,
} from "./modelApiSettings";

const MAX_MODEL_CONFIGS = 8;
const DEFAULT_VISIBLE_CONFIG_SLOTS = 3;

let rendererStarted = false;
const observedDocs = new WeakSet<Document>();

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
  const configs = [...getModelConfigs()];

  while (configs.length < DEFAULT_VISIBLE_CONFIG_SLOTS) {
    configs.push(createEmptyModelConfig(configs.length + 1));
  }

  return configs.slice(0, MAX_MODEL_CONFIGS);
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

function isBlankConfig(config: MagicDigestModelConfig): boolean {
  return !config.baseURL && !config.apiKey && !config.model;
}

function validateConfig(config: MagicDigestModelConfig): string | null {
  if (!config.name) return "请填写 API 配置名称";
  if (!config.baseURL) return `请填写「${config.name}」的 Base URL`;
  if (!config.apiKey) return `请填写「${config.name}」的 API Key`;
  if (!config.model) return `请填写「${config.name}」的 Model 名称`;
  return null;
}

function readConfigFromCard(card: HTMLElement): MagicDigestModelConfig {
  const val = (selector: string) => {
    const el = card.querySelector(selector) as HTMLInputElement | null;
    return String(el?.value || "").trim();
  };

  const checked = (selector: string) => {
    const el = card.querySelector(selector) as HTMLInputElement | null;
    return !!el?.checked;
  };

  return {
    id: String(card.dataset.id || "").trim() || makeID("model"),
    name: val(".mv-name") || "未命名模型",
    provider: "openai-compatible",
    baseURL: normalizeBaseURL(val(".mv-base")),
    apiKey: val(".mv-key"),
    model: val(".mv-model"),
    enabled: checked(".mv-enabled"),
    createdAt: String(card.dataset.createdAt || "").trim() || nowISO(),
    updatedAt: nowISO(),
  };
}

function collectConfigs(root: HTMLElement): MagicDigestModelConfig[] {
  return Array.from(root.querySelectorAll(".mv-card")).map((el) =>
    readConfigFromCard(el as HTMLElement),
  );
}

function getCurrentModelText(): string {
  const config = getDefaultModelConfig();

  if (!config) {
    return "当前默认解析模型：未配置";
  }

  return `当前默认解析模型：${config.name} / ${config.model} / ${
    config.enabled ? "启用" : "禁用"
  }`;
}

function renderCardHTML(
  config: MagicDigestModelConfig,
  index: number,
  total: number,
  defaultID: string,
): string {
  const isDefault = config.id === defaultID;
  const canDelete = total > DEFAULT_VISIBLE_CONFIG_SLOTS;

  return `
    <div
      class="mv-card"
      data-id="${escapeHTML(config.id)}"
      data-created-at="${escapeHTML(config.createdAt || nowISO())}"
      style="
        border:1px solid var(--fill-quinary);
        border-radius:8px;
        padding:12px;
        margin-bottom:12px;
        background:${isDefault ? "rgba(37,99,235,.16)" : "var(--material-background)"};
        box-shadow:${isDefault ? "0 0 0 2px rgba(37,99,235,.25)" : "none"};
      "
    >
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:10px;">
        <div style="font-weight:700;">
          API 配置 ${index + 1}
          ${
            isDefault
              ? `<span style="margin-left:8px;background:#2563eb;color:#fff;border-radius:999px;padding:1px 8px;font-size:11px;">默认解析模型</span>`
              : ""
          }
        </div>

        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <label style="font-size:12px;">
            <input class="mv-enabled" type="checkbox" ${
              config.enabled ? "checked" : ""
            } />
            启用
          </label>

          <button class="mv-test" type="button"
            style="background:#0f766e;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;">
            测试
          </button>

          <button class="mv-default" type="button"
            style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;">
            设为默认
          </button>

          ${
            canDelete
              ? `<button class="mv-delete" type="button"
                  style="background:#991b1b;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;">
                  删除
                </button>`
              : ""
          }
        </div>
      </div>

      <div style="display:grid;grid-template-columns:120px minmax(0,1fr);gap:8px 10px;align-items:center;">
        <label>自定义名称</label>
        <input class="mv-name"
          value="${escapeHTML(config.name)}"
          placeholder="例如：DeepSeek 官方 / Kimi 32K / 本地 Ollama"
          style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid var(--fill-quaternary);" />

        <label>Base URL</label>
        <input class="mv-base"
          value="${escapeHTML(config.baseURL)}"
          placeholder="https://api.deepseek.com 或 https://api.openai.com/v1"
          style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid var(--fill-quaternary);" />

        <label>API Key</label>
        <input class="mv-key"
          type="password"
          value="${escapeHTML(config.apiKey)}"
          placeholder="sk-..."
          style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid var(--fill-quaternary);" />

        <label>Model</label>
        <input class="mv-model"
          value="${escapeHTML(config.model)}"
          placeholder="deepseek-chat / gpt-4o-mini / qwen-plus"
          style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid var(--fill-quaternary);" />
      </div>

      <div style="font-size:11px;color:var(--fill-tertiary);margin-top:8px;">
        兼容 OpenAI Chat Completions：/v1/chat/completions
      </div>
    </div>
  `;
}


const READER_CARD_TYPE_COLORS_PREF_FOR_RENDERER =
  "extensions.magic_digest.reader.cardTypeColors";
const READER_TAG_COLORS_PREF_FOR_RENDERER =
  "extensions.magic_digest.reader.tagColors";
const READER_DEFAULT_SORT_PREF_FOR_RENDERER =
  "extensions.magic_digest.reader.defaultSort";
const READER_UI_LANGUAGE_PREF_FOR_RENDERER =
  "extensions.magic_digest.reader.uiLanguage";

const DEFAULT_READER_CARD_TYPE_COLORS_JSON_FOR_RENDERER = JSON.stringify(
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

const DEFAULT_READER_TAG_COLORS_JSON_FOR_RENDERER = JSON.stringify(
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

function getRendererPref(key: string, fallback = ""): string {
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

function setRendererPref(key: string, value: string): void {
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

function escapeReaderSettingsHTML(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function validateRendererColorJSON(raw: string, fallback: string): string {
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

function setupMagicDigestPreferenceTabs(root: HTMLElement): void {
  const doc = root.ownerDocument;
  if (!doc) return;

  if (root.querySelector("#magic-digest-pref-tabs")) {
    return;
  }

  const oldChildren = Array.from(root.childNodes).filter(
    (child): child is Node => child != null,
  );

  const tabs = doc.createElement("div");
  tabs.id = "magic-digest-pref-tabs";
  tabs.setAttribute(
    "style",
    [
      "display:flex",
      "gap:8px",
      "margin:0 0 12px",
      "border-bottom:1px solid #334155",
      "padding-bottom:8px",
    ].join(";"),
  );

  const apiBtn = doc.createElement("button");
  apiBtn.id = "magic-digest-pref-tab-api";
  apiBtn.textContent = "API 设置";
  apiBtn.setAttribute(
    "style",
    [
      "background:#2563eb",
      "color:#fff",
      "border:0",
      "border-radius:6px",
      "padding:6px 12px",
      "cursor:pointer",
      "font-weight:700",
    ].join(";"),
  );

  const readerBtn = doc.createElement("button");
  readerBtn.id = "magic-digest-pref-tab-reader";
  readerBtn.textContent = "Reader 显示";
  readerBtn.setAttribute(
    "style",
    [
      "background:#334155",
      "color:#e5e7eb",
      "border:0",
      "border-radius:6px",
      "padding:6px 12px",
      "cursor:pointer",
      "font-weight:700",
    ].join(";"),
  );

  tabs.appendChild(apiBtn);
  tabs.appendChild(readerBtn);

  const apiPage = doc.createElement("div");
  apiPage.id = "magic-digest-pref-page-api";

  const readerPage = doc.createElement("div");
  readerPage.id = "magic-digest-pref-page-reader";
  readerPage.style.display = "none";

  for (const child of oldChildren) {
    apiPage.appendChild(child as Node);
  }

  const currentSort = getRendererPref(
    READER_DEFAULT_SORT_PREF_FOR_RENDERER,
    "page",
  );

  const currentLang = getRendererPref(
    READER_UI_LANGUAGE_PREF_FOR_RENDERER,
    "auto",
  );

  const typeColors = getRendererPref(
    READER_CARD_TYPE_COLORS_PREF_FOR_RENDERER,
    DEFAULT_READER_CARD_TYPE_COLORS_JSON_FOR_RENDERER,
  );

  const tagColors = getRendererPref(
    READER_TAG_COLORS_PREF_FOR_RENDERER,
    DEFAULT_READER_TAG_COLORS_JSON_FOR_RENDERER,
  );

  readerPage.innerHTML = [
    '<div style="padding:14px;border:1px solid #334155;border-radius:8px;background:#020617;color:#e5e7eb;">',
      '<div style="font-size:16px;font-weight:800;margin-bottom:12px;">Reader 卡片显示设置</div>',

      '<label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">默认排序</label>',
      '<select id="magic-digest-reader-default-sort-renderer" style="width:240px;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:6px 8px;margin-bottom:12px;">',
        '<option value="page"', currentSort === "page" ? " selected" : "", '>按页排序</option>',
        '<option value="type"', currentSort === "type" ? " selected" : "", '>按类型排序</option>',
        '<option value="title"', currentSort === "title" ? " selected" : "", '>按标题排序</option>',
      '</select>',

      '<label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">Reader 语言</label>',
      '<select id="magic-digest-reader-ui-language-renderer" style="width:240px;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:6px 8px;margin-bottom:12px;">',
        '<option value="auto"', currentLang === "auto" ? " selected" : "", '>自动</option>',
        '<option value="zh"', currentLang === "zh" ? " selected" : "", '>中文</option>',
        '<option value="en"', currentLang === "en" ? " selected" : "", '>English</option>',
      '</select>',

      '<label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">卡片类型颜色 JSON</label>',
      '<textarea id="magic-digest-card-type-colors-renderer" style="width:100%;height:150px;box-sizing:border-box;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:8px;font-family:monospace;font-size:12px;margin-bottom:12px;">',
        escapeReaderSettingsHTML(typeColors),
      '</textarea>',

      '<label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">标签颜色 JSON</label>',
      '<textarea id="magic-digest-tag-colors-renderer" style="width:100%;height:130px;box-sizing:border-box;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:8px;font-family:monospace;font-size:12px;margin-bottom:12px;">',
        escapeReaderSettingsHTML(tagColors),
      '</textarea>',

      '<div style="font-size:11px;color:#94a3b8;margin-bottom:12px;">颜色格式为 #RRGGBB。保存后请关闭并重新打开 PDF 卡片层。</div>',

      '<button id="magic-digest-save-reader-display-renderer" style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:700;">保存 Reader 显示设置</button>',
      '<span id="magic-digest-reader-display-renderer-msg" style="margin-left:10px;color:#94a3b8;"></span>',
    '</div>',
  ].join("");

  root.appendChild(tabs);
  root.appendChild(apiPage);
  root.appendChild(readerPage);

  const setActiveTab = (name: "api" | "reader") => {
    const isAPI = name === "api";

    apiPage.style.display = isAPI ? "block" : "none";
    readerPage.style.display = isAPI ? "none" : "block";

    apiBtn.style.background = isAPI ? "#2563eb" : "#334155";
    apiBtn.style.color = isAPI ? "#fff" : "#e5e7eb";

    readerBtn.style.background = !isAPI ? "#2563eb" : "#334155";
    readerBtn.style.color = !isAPI ? "#fff" : "#e5e7eb";
  };

  apiBtn.addEventListener("click", () => setActiveTab("api"));
  readerBtn.addEventListener("click", () => setActiveTab("reader"));

  const saveBtn = readerPage.querySelector(
    "#magic-digest-save-reader-display-renderer",
  ) as HTMLButtonElement | null;

  saveBtn?.addEventListener("click", () => {
    const msg = readerPage.querySelector(
      "#magic-digest-reader-display-renderer-msg",
    ) as HTMLElement | null;

    try {
      const sort = String(
        (
          readerPage.querySelector(
            "#magic-digest-reader-default-sort-renderer",
          ) as HTMLSelectElement | null
        )?.value || "page",
      );

      const lang = String(
        (
          readerPage.querySelector(
            "#magic-digest-reader-ui-language-renderer",
          ) as HTMLSelectElement | null
        )?.value || "auto",
      );

      const typeColorsNext = String(
        (
          readerPage.querySelector(
            "#magic-digest-card-type-colors-renderer",
          ) as HTMLTextAreaElement | null
        )?.value || "",
      );

      const tagColorsNext = String(
        (
          readerPage.querySelector(
            "#magic-digest-tag-colors-renderer",
          ) as HTMLTextAreaElement | null
        )?.value || "",
      );

      setRendererPref(
        READER_DEFAULT_SORT_PREF_FOR_RENDERER,
        ["page", "type", "title"].includes(sort) ? sort : "page",
      );

      setRendererPref(
        READER_UI_LANGUAGE_PREF_FOR_RENDERER,
        ["auto", "zh", "en"].includes(lang) ? lang : "auto",
      );

      setRendererPref(
        READER_CARD_TYPE_COLORS_PREF_FOR_RENDERER,
        validateRendererColorJSON(
          typeColorsNext,
          DEFAULT_READER_CARD_TYPE_COLORS_JSON_FOR_RENDERER,
        ),
      );

      setRendererPref(
        READER_TAG_COLORS_PREF_FOR_RENDERER,
        validateRendererColorJSON(
          tagColorsNext,
          DEFAULT_READER_TAG_COLORS_JSON_FOR_RENDERER,
        ),
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

function renderPreferenceForm(root: HTMLElement) {
  const configs = getDisplayConfigs();
  const defaultID = getDefaultModelId();

  root.innerHTML = `
    <div
      id="mv-current"
      style="
        margin-bottom:12px;
        padding:8px 10px;
        border:1px solid var(--fill-quinary);
        border-radius:6px;
        background:var(--material-background);
      "
    >
      ${escapeHTML(getCurrentModelText())}
    </div>

    <div
      style="
        margin-bottom:12px;
        padding:8px 10px;
        border:1px solid var(--fill-quinary);
        border-radius:6px;
        background:var(--material-background);
        color:var(--fill-secondary);
        font-size:12px;
        line-height:1.5;
      "
    >
      <div><b>规则：</b></div>
      <div>1. 默认显示 3 个 API 配置槽。</div>
      <div>2. 只有点击 “+ 添加模型 API” 才新增配置槽。</div>
      <div>3. 最多支持 8 个 API 配置。</div>
      <div>4. 每个 API 都可以自定义名称，并可设为默认解析模型。</div>
    </div>

    <div id="mv-list">
      ${configs
        .map((config, index) =>
          renderCardHTML(config, index, configs.length, defaultID),
        )
        .join("")}
    </div>

    <div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px;">
      <button id="mv-add" type="button"
        style="background:#0369a1;color:white;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;">
        + 添加模型 API
      </button>

      <button id="mv-save" type="button"
        style="background:#16a34a;color:white;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;">
        保存模型设置
      </button>
    </div>
  `;

  setupMagicDigestPreferenceTabs(root);
  bindPreferenceFormEvents(root);
}

function saveFromUI(root: HTMLElement): boolean {
  const all = collectConfigs(root);
  const valid: MagicDigestModelConfig[] = [];

  for (const config of all) {
    if (isBlankConfig(config)) continue;

    const err = validateConfig(config);
    if (err) {
      showProgress(err, "fail", 7000);
      return false;
    }

    valid.push(config);
  }

  if (!valid.length) {
    showProgress("请至少配置一个可用的模型 API", "fail", 7000);
    return false;
  }

  saveModelConfigs(valid);

  const defaultID = getDefaultModelId();
  if (!valid.some((x) => x.id === defaultID)) {
    setDefaultModelId(valid[0].id);
  }

  renderPreferenceForm(root);
  showProgress("模型 API 设置已保存 ✅", "success");
  return true;
}

function bindPreferenceFormEvents(root: HTMLElement) {
  const win = root.ownerDocument?.defaultView || null;

  const addBtn = root.querySelector("#mv-add") as HTMLButtonElement | null;
  const saveBtn = root.querySelector("#mv-save") as HTMLButtonElement | null;
  const list = root.querySelector("#mv-list") as HTMLElement | null;

  addBtn?.addEventListener("click", (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();

    const configs = collectConfigs(root);

    if (configs.length >= MAX_MODEL_CONFIGS) {
      showProgress(`最多只能添加 ${MAX_MODEL_CONFIGS} 个 API 配置`, "fail");
      return;
    }

    configs.push(createEmptyModelConfig(configs.length + 1));

    root.innerHTML = `
      <div style="color:var(--fill-secondary);">正在添加模型配置...</div>
    `;

    const currentDefault = getDefaultModelId();

    root.innerHTML = `
      <div
        id="mv-current"
        style="margin-bottom:12px;padding:8px 10px;border:1px solid var(--fill-quinary);border-radius:6px;background:var(--material-background);"
      >
        ${escapeHTML(getCurrentModelText())}
      </div>

      <div id="mv-list">
        ${configs
          .map((config, index) =>
            renderCardHTML(config, index, configs.length, currentDefault),
          )
          .join("")}
      </div>

      <div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px;">
        <button id="mv-add" type="button"
          style="background:#0369a1;color:white;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;">
          + 添加模型 API
        </button>
        <button id="mv-save" type="button"
          style="background:#16a34a;color:white;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;">
          保存模型设置
        </button>
      </div>
    `;

    bindPreferenceFormEvents(root);
  });

  saveBtn?.addEventListener("click", (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    saveFromUI(root);
  });

  list?.addEventListener("click", async (ev: Event) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;

    const card = target.closest(".mv-card") as HTMLElement | null;
    if (!card) return;

    if (target.classList.contains("mv-delete")) {
      ev.preventDefault();
      ev.stopPropagation();

      const config = readConfigFromCard(card);
      const confirmed = win?.confirm
        ? win.confirm(`确定删除 API 配置「${config.name}」吗？`)
        : true;

      if (!confirmed) return;

      let configs = collectConfigs(root).filter((x) => x.id !== config.id);

      while (configs.length < DEFAULT_VISIBLE_CONFIG_SLOTS) {
        configs.push(createEmptyModelConfig(configs.length + 1));
      }

      root.innerHTML = `
        <div id="mv-list">
          ${configs
            .map((x, index) =>
              renderCardHTML(x, index, configs.length, getDefaultModelId()),
            )
            .join("")}
        </div>

        <div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px;">
          <button id="mv-add" type="button"
            style="background:#0369a1;color:white;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;">
            + 添加模型 API
          </button>
          <button id="mv-save" type="button"
            style="background:#16a34a;color:white;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;">
            保存模型设置
          </button>
        </div>
      `;

      bindPreferenceFormEvents(root);
      return;
    }

    if (target.classList.contains("mv-default")) {
      ev.preventDefault();
      ev.stopPropagation();

      const config = readConfigFromCard(card);
      const err = validateConfig(config);

      if (err) {
        showProgress(err, "fail", 7000);
        return;
      }

      const valid = collectConfigs(root).filter((x) => !isBlankConfig(x));
      saveModelConfigs(valid);
      setDefaultModelId(config.id);

      renderPreferenceForm(root);
      showProgress(`已设为默认解析模型：${config.name}`, "success");
      return;
    }

    if (target.classList.contains("mv-test")) {
      ev.preventDefault();
      ev.stopPropagation();

      const btn = target as HTMLButtonElement;
      const config = readConfigFromCard(card);
      const err = validateConfig(config);

      if (err) {
        showProgress(err, "fail", 7000);
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
          10000,
        );
      } finally {
        btn.disabled = false;
        btn.textContent = "测试";
      }
    }
  });
}


function showPreferenceRenderError(root: HTMLElement, e: unknown): void {
  const message =
    e && typeof e === "object" && "message" in e
      ? String((e as any).message)
      : String(e);

  root.dataset.magicDigestRendered = "error";

  root.setAttribute(
    "style",
    [
      "margin-top:16px",
      "padding:12px",
      "border:1px solid #ef4444",
      "border-radius:8px",
      "background:#1f1111",
      "color:#fecaca",
      "font-size:13px",
      "line-height:1.5",
      "white-space:pre-wrap",
    ].join(";"),
  );

  root.innerHTML =
    "<b>magic_digest 模型 API 表单渲染失败</b><br/>" +
    escapeHTML(message) +
    "<br/><br/>请把这段错误文字发给我。";
}

function tryRenderInDocument(doc: Document) {
  const root = doc.getElementById(
    "magic-digest-model-settings-root",
  ) as HTMLElement | null;

  if (!root) {
    return;
  }

  if (root.dataset.magicDigestRendered === "1") {
    return;
  }

  root.dataset.magicDigestRendered = "1";

  root.setAttribute(
    "style",
    [
      "margin-top:16px",
      "padding:12px",
      "border:1px solid var(--fill-quinary)",
      "border-radius:8px",
      "background:var(--material-background)",
      "color:var(--fill-primary)",
      "font-size:13px",
      "line-height:1.5",
      "min-height:80px",
    ].join(";"),
  );

  root.textContent = "模型 API 表单脚本已由主插件加载，正在渲染...";

  try {
    renderPreferenceForm(root);
  } catch (e) {
    showPreferenceRenderError(root, e);
  }
}

function observeDocument(doc: Document) {
  if (observedDocs.has(doc)) {
    return;
  }

  observedDocs.add(doc);

  tryRenderInDocument(doc);

  const win = doc.defaultView as any;
  const MutationObserverCtor = win?.MutationObserver;

  if (!MutationObserverCtor) {
    return;
  }

  const observer = new MutationObserverCtor(() => {
    tryRenderInDocument(doc);
  });

  const target = doc.documentElement || doc.body;
  if (target) {
    observer.observe(target, {
      childList: true,
      subtree: true,
    });
  }
}

function getCandidateDocuments(): Document[] {
  const docs: Document[] = [];

  try {
    for (const win of Zotero.getMainWindows()) {
      if (win?.document) {
        docs.push(win.document);
      }
    }
  } catch {
    // ignore
  }

  try {
    const mainWin = Zotero.getMainWindow?.();
    if (mainWin?.document) {
      docs.push(mainWin.document);
    }
  } catch {
    // ignore
  }

  try {
    const ServicesAny = (globalThis as any).Services;
    const enumerator = ServicesAny?.wm?.getEnumerator?.(null);

    while (enumerator?.hasMoreElements?.()) {
      const win = enumerator.getNext();
      const doc = win?.document as Document | undefined;

      if (doc) {
        docs.push(doc);
      }
    }
  } catch {
    // ignore
  }

  return Array.from(new Set(docs));
}

export function startMagicDigestPreferencePaneRenderer() {
  if (rendererStarted) {
    return;
  }

  rendererStarted = true;

  const scan = () => {
    for (const doc of getCandidateDocuments()) {
      observeDocument(doc);
      tryRenderInDocument(doc);
    }
  };

  scan();

  const st = (globalThis as any).setInterval;
  if (typeof st === "function") {
    st(scan, 1000);
  }

  ztoolkit.log("magic_digest preference pane DOM renderer started");
}