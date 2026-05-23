import {
  getDefaultModelConfig,
  getDefaultModelId,
  getModelConfigs,
  saveModelConfigs,
  setDefaultModelId,
  testModelConnection,
  getDefaultVisionModelConfig,
  getDefaultVisionModelId,
  setDefaultVisionModelId,
  testVisionModelConnection,
  type MagicDigestModelConfig,
} from "./modelApiSettings";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const MAX = 8;
const SLOTS = 3;

function nowISO(): string {
  return new Date().toISOString();
}

function makeID(prefix = "model"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeBaseURL(baseURL: string): string {
  return String(baseURL || "").trim().replace(/\/+$/, "");
}

function createEmptyConfig(index: number): MagicDigestModelConfig {
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

  while (configs.length < SLOTS) {
    configs.push(createEmptyConfig(configs.length + 1));
  }

  return configs.slice(0, MAX);
}

function isBlank(config: MagicDigestModelConfig): boolean {
  return !config.baseURL && !config.apiKey && !config.model;
}

function validate(config: MagicDigestModelConfig): string | null {
  if (!config.name) return "请填写 API 配置名称";
  if (!config.baseURL) return `请填写「${config.name}」的 Base URL`;
  if (!config.apiKey) return `请填写「${config.name}」的 API Key`;
  if (!config.model) return `请填写「${config.name}」的 Model 名称`;
  return null;
}

function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const el = doc.createElementNS(XHTML_NS, tag) as HTMLElementTagNameMap[K];

  if (className) {
    el.className = className;
  }

  return el;
}

function clear(el: Element) {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

function setMsg(
  doc: Document,
  text: string,
  type: "default" | "success" | "fail" = "default",
) {
  const el = doc.getElementById("mv-msg") as HTMLElement | null;
  if (!el) return;

  el.textContent = text;

  if (type === "success") {
    el.style.color = "#bbf7d0";
    el.style.background = "#0f1f11";
  } else if (type === "fail") {
    el.style.color = "#fecaca";
    el.style.background = "#1f1111";
  } else {
    el.style.color = "";
    el.style.background = "var(--material-background)";
  }
}

function currentText(): string {
  const textConfig = getDefaultModelConfig();
  const visionConfig = getDefaultVisionModelConfig();

  const textLine = textConfig
    ? `Text model: ${textConfig.name} / ${textConfig.model} / ${textConfig.enabled ? "enabled" : "disabled"}`
    : "Text model: not configured";

  const visionLine = visionConfig
    ? `Vision model: ${visionConfig.name} / ${visionConfig.model} / ${visionConfig.enabled ? "enabled" : "disabled"}`
    : "Vision model: not configured";

  return textLine + " | " + visionLine;
}

function makeInput(params: {
  doc: Document;
  className: string;
  value: string;
  placeholder: string;
  type?: string;
}): HTMLInputElement {
  const input = h(params.doc, "input", params.className) as HTMLInputElement;

  input.type = params.type || "text";
  input.value = params.value || "";
  input.placeholder = params.placeholder || "";
  input.style.cssText =
    "width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid var(--fill-quaternary);background:var(--material-background);color:var(--fill-primary);";

  return input;
}

function addField(
  doc: Document,
  grid: HTMLElement,
  labelText: string,
  input: HTMLInputElement,
) {
  const label = h(doc, "label");
  label.textContent = labelText;
  label.style.cssText = "font-size:13px;color:var(--fill-secondary);";

  grid.appendChild(label);
  grid.appendChild(input);
}

function createButton(
  doc: Document,
  className: string,
  text: string,
  color: string,
): HTMLButtonElement {
  const btn = h(doc, "button", className) as HTMLButtonElement;
  btn.type = "button";
  btn.textContent = text;
  btn.style.cssText = `background:${color};color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;`;
  return btn;
}

function renderCard(
  doc: Document,
  config: MagicDigestModelConfig,
  index: number,
  total: number,
  defaultID: string,
): HTMLElement {
  const isDefault = config.id === defaultID;
  const isVisionDefault = config.id === getDefaultVisionModelId();
  const canDelete = total > SLOTS;

  const card = h(doc, "div", "mv-card");
  card.setAttribute("data-id", config.id);
  card.setAttribute("data-created-at", config.createdAt || nowISO());
  card.style.cssText = [
    "border:1px solid var(--fill-quinary)",
    "border-radius:8px",
    "padding:12px",
    "margin-bottom:12px",
    `background:${isDefault ? "rgba(37,99,235,.16)" : "var(--material-background)"}`,
    `box-shadow:${isDefault ? "0 0 0 2px rgba(37,99,235,.25)" : "none"}`,
  ].join(";");

  const header = h(doc, "div");
  header.style.cssText =
    "display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:10px;";

  const title = h(doc, "div");
  title.style.cssText = "font-weight:700;";
  title.textContent = `API 配置 ${index + 1}`;

  if (isDefault) {
    const badge = h(doc, "span");
    badge.textContent = "默认解析模型";
    badge.style.cssText =
      "margin-left:8px;background:#2563eb;color:#fff;border-radius:999px;padding:1px 8px;font-size:11px;";
    title.appendChild(badge);
  }

  const actions = h(doc, "div");
  actions.style.cssText =
    "display:flex;gap:6px;align-items:center;flex-wrap:wrap;";

  const enabledLabel = h(doc, "label");
  enabledLabel.style.cssText =
    "font-size:12px;display:flex;gap:4px;align-items:center;";

  const enabled = h(doc, "input", "mv-enabled") as HTMLInputElement;
  enabled.type = "checkbox";
  enabled.checked = !!config.enabled;

  enabledLabel.appendChild(enabled);
  enabledLabel.appendChild(doc.createTextNode("启用"));

  actions.appendChild(enabledLabel);
  actions.appendChild(createButton(doc, "mv-test", "测试", "#0f766e"));
  actions.appendChild(createButton(doc, "mv-default", "Text Default", "#2563eb"));
  actions.appendChild(createButton(doc, "mv-vision-default", "Vision Default", "#7c3aed"));
  actions.appendChild(createButton(doc, "mv-vision-test", "Test Image", "#9333ea"));

  if (canDelete) {
    actions.appendChild(createButton(doc, "mv-delete", "删除", "#991b1b"));
  }

  header.appendChild(title);
  header.appendChild(actions);
  card.appendChild(header);

  const grid = h(doc, "div");
  grid.style.cssText =
    "display:grid;grid-template-columns:120px minmax(0,1fr);gap:8px 10px;align-items:center;";

  addField(
    doc,
    grid,
    "自定义名称",
    makeInput({
      doc,
      className: "mv-name",
      value: config.name,
      placeholder: "例如：DeepSeek 官方 / Kimi 32K / 本地 Ollama",
    }),
  );

  addField(
    doc,
    grid,
    "Base URL",
    makeInput({
      doc,
      className: "mv-base",
      value: config.baseURL,
      placeholder: "https://api.deepseek.com 或 https://api.openai.com/v1",
    }),
  );

  addField(
    doc,
    grid,
    "API Key",
    makeInput({
      doc,
      className: "mv-key",
      value: config.apiKey,
      placeholder: "sk-...",
      type: "password",
    }),
  );

  addField(
    doc,
    grid,
    "Model",
    makeInput({
      doc,
      className: "mv-model",
      value: config.model,
      placeholder: "deepseek-chat / gpt-4o-mini / qwen-plus",
    }),
  );

  card.appendChild(grid);

  const note = h(doc, "div");
  note.textContent = "兼容 OpenAI Chat Completions：/v1/chat/completions";
  note.style.cssText =
    "font-size:11px;color:var(--fill-tertiary);margin-top:8px;";
  card.appendChild(note);

  return card;
}

function readCard(card: HTMLElement): MagicDigestModelConfig {
  const val = (selector: string) => {
    const el = card.querySelector(selector) as HTMLInputElement | null;
    return String(el?.value || "").trim();
  };

  const checked = (selector: string) => {
    const el = card.querySelector(selector) as HTMLInputElement | null;
    return !!el?.checked;
  };

  return {
    id: String(card.getAttribute("data-id") || "").trim() || makeID("model"),
    name: val(".mv-name") || "未命名模型",
    provider: "openai-compatible",
    baseURL: normalizeBaseURL(val(".mv-base")),
    apiKey: val(".mv-key"),
    model: val(".mv-model"),
    enabled: checked(".mv-enabled"),
    createdAt:
      String(card.getAttribute("data-created-at") || "").trim() || nowISO(),
    updatedAt: nowISO(),
  };
}

function collect(doc: Document): MagicDigestModelConfig[] {
  return Array.from(doc.querySelectorAll(".mv-card")).map((x) =>
    readCard(x as HTMLElement),
  );
}

function render(doc: Document, configs = getDisplayConfigs()) {
  const list = doc.getElementById("mv-list") as HTMLElement | null;
  if (!list) return;

  clear(list);

  const defaultID = getDefaultModelId();

  configs.forEach((config, index) => {
    list.appendChild(renderCard(doc, config, index, configs.length, defaultID));
  });

  setMsg(doc, currentText(), "default");
}

function bind(doc: Document) {
  const addBtn = doc.getElementById("mv-add") as HTMLButtonElement | null;
  const saveBtn = doc.getElementById("mv-save") as HTMLButtonElement | null;
  const list = doc.getElementById("mv-list") as HTMLElement | null;

  addBtn?.addEventListener("click", (ev: Event) => {
    ev.preventDefault();

    const configs = collect(doc);

    if (configs.length >= MAX) {
      setMsg(doc, `最多只能添加 ${MAX} 个 API 配置`, "fail");
      return;
    }

    configs.push(createEmptyConfig(configs.length + 1));
    render(doc, configs);
  });

  saveBtn?.addEventListener("click", (ev: Event) => {
    ev.preventDefault();

    const all = collect(doc);
    const valid: MagicDigestModelConfig[] = [];

    for (const config of all) {
      if (isBlank(config)) continue;

      const err = validate(config);
      if (err) {
        setMsg(doc, err, "fail");
        return;
      }

      valid.push(config);
    }

    if (!valid.length) {
      setMsg(doc, "请至少配置一个可用的模型 API", "fail");
      return;
    }

    saveModelConfigs(valid);

    const defaultID = getDefaultModelId();
    if (!valid.some((x) => x.id === defaultID)) {
      setDefaultModelId(valid[0].id);
    }

    render(doc);
    setMsg(doc, "模型 API 设置已保存 ✓", "success");
  });

  list?.addEventListener("click", async (ev: Event) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;

    const card = target.closest(".mv-card") as HTMLElement | null;
    if (!card) return;

    if (target.classList.contains("mv-delete")) {
      ev.preventDefault();

      const config = readCard(card);
      const win = doc.defaultView;
      const confirmed = win?.confirm
        ? win.confirm(`确定删除 API 配置「${config.name}」吗？`)
        : true;

      if (!confirmed) return;

      let configs = collect(doc).filter((x) => x.id !== config.id);

      while (configs.length < SLOTS) {
        configs.push(createEmptyConfig(configs.length + 1));
      }

      render(doc, configs);
      return;
    }

    if (target.classList.contains("mv-default")) {
      ev.preventDefault();

      const config = readCard(card);
      const err = validate(config);

      if (err) {
        setMsg(doc, err, "fail");
        return;
      }

      const valid = collect(doc).filter((x) => !isBlank(x));
      saveModelConfigs(valid);
      setDefaultModelId(config.id);

      render(doc);
      setMsg(doc, `已设为默认解析模型：${config.name}`, "success");
      return;
    }

    if (target.classList.contains("mv-vision-default")) {
      ev.preventDefault();

      const config = readCard(card);
      const err = validate(config);

      if (err) {
        setMsg(doc, err, "fail");
        return;
      }

      const valid = collect(doc).filter((x) => !isBlank(x));
      saveModelConfigs(valid);
      setDefaultVisionModelId(config.id);

      render(doc);
      setMsg(doc, `Set vision model: ${config.name}`, "success");
      return;
    }

    if (target.classList.contains("mv-vision-test")) {
      ev.preventDefault();

      const btn = target as HTMLButtonElement;
      const config = readCard(card);
      const err = validate(config);

      if (err) {
        setMsg(doc, err, "fail");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Testing image...";

      try {
        const result = await testVisionModelConnection(config);
        setMsg(
          doc,
          `Image test OK: ${config.name}, reply: ${result.content.slice(0, 120)}`,
          "success",
        );
      } catch (e: any) {
        setMsg(doc, `Image test failed: ${e?.message || String(e)}`, "fail");
      } finally {
        btn.disabled = false;
        btn.textContent = "Test Image";
      }

      return;
    }

    if (target.classList.contains("mv-test")) {
      ev.preventDefault();

      const btn = target as HTMLButtonElement;
      const config = readCard(card);
      const err = validate(config);

      if (err) {
        setMsg(doc, err, "fail");
        return;
      }

      btn.disabled = true;
      btn.textContent = "测试中...";

      try {
        const result = await testModelConnection(config);
        setMsg(
          doc,
          `连接成功：${config.name}，返回：${result.content.slice(0, 80)}`,
          "success",
        );
      } catch (e: any) {
        setMsg(doc, `连接失败：${e?.message || String(e)}`, "fail");
      } finally {
        btn.disabled = false;
        btn.textContent = "测试";
      }
    }
  });
}


const READER_CARD_TYPE_COLORS_PREF = "extensions.magic_digest.reader.cardTypeColors";
const READER_TAG_COLORS_PREF = "extensions.magic_digest.reader.tagColors";
const READER_DEFAULT_SORT_PREF = "extensions.magic_digest.reader.defaultSort";
const READER_UI_LANGUAGE_PREF = "extensions.magic_digest.reader.uiLanguage";

const DEFAULT_READER_CARD_TYPE_COLORS_JSON = JSON.stringify(
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

const DEFAULT_READER_TAG_COLORS_JSON = JSON.stringify(
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

function getReaderDisplayPref(key: string, fallback = ""): string {
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

function setReaderDisplayPref(key: string, value: string): void {
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

function validateReaderColorJSON(raw: string, fallback: string): string {
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


function escapeHTML(str: string): string {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderReaderDisplaySettings(doc: Document): void {
  if (doc.getElementById("magic-digest-reader-display-settings")) {
    return;
  }

  const root =
    doc.getElementById("mv-root") ||
    doc.getElementById("magic-digest-model-settings-root") ||
    doc.body ||
    doc.documentElement;

  if (!root) return;

  const section = doc.createElement("div");
  section.id = "magic-digest-reader-display-settings";

  section.setAttribute(
    "style",
    [
      "margin:12px 0 18px",
      "padding:14px",
      "border:1px solid #334155",
      "border-radius:8px",
      "background:#020617",
      "color:#e5e7eb",
      "font-size:13px",
    ].join(";"),
  );

  const currentSort = getReaderDisplayPref(READER_DEFAULT_SORT_PREF, "page");
  const currentLang = getReaderDisplayPref(READER_UI_LANGUAGE_PREF, "auto");
  const typeColors = getReaderDisplayPref(
    READER_CARD_TYPE_COLORS_PREF,
    DEFAULT_READER_CARD_TYPE_COLORS_JSON,
  );
  const tagColors = getReaderDisplayPref(
    READER_TAG_COLORS_PREF,
    DEFAULT_READER_TAG_COLORS_JSON,
  );

  section.innerHTML = [
    '<div style="font-size:15px;font-weight:800;margin-bottom:10px;">Reader 卡片显示设置</div>',

    '<label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">默认排序</label>',
    '<select id="magic-digest-reader-default-sort" style="width:220px;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:5px 8px;margin-bottom:10px;">',
      '<option value="page"', currentSort === "page" ? " selected" : "", '>按页排序</option>',
      '<option value="type"', currentSort === "type" ? " selected" : "", '>按类型排序</option>',
      '<option value="title"', currentSort === "title" ? " selected" : "", '>按标题排序</option>',
    '</select>',

    '<label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">Reader 语言</label>',
    '<select id="magic-digest-reader-ui-language" style="width:220px;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:5px 8px;margin-bottom:10px;">',
      '<option value="auto"', currentLang === "auto" ? " selected" : "", '>自动</option>',
      '<option value="zh"', currentLang === "zh" ? " selected" : "", '>中文</option>',
      '<option value="en"', currentLang === "en" ? " selected" : "", '>English</option>',
    '</select>',

    '<label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">卡片类型颜色 JSON</label>',
    '<textarea id="magic-digest-card-type-colors" style="width:100%;height:130px;box-sizing:border-box;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:8px;font-family:monospace;font-size:12px;margin-bottom:10px;">',
      escapeHTML(typeColors),
    '</textarea>',

    '<label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">标签颜色 JSON</label>',
    '<textarea id="magic-digest-tag-colors" style="width:100%;height:115px;box-sizing:border-box;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:8px;font-family:monospace;font-size:12px;margin-bottom:10px;">',
      escapeHTML(tagColors),
    '</textarea>',

    '<div style="font-size:11px;color:#94a3b8;margin-bottom:10px;">颜色格式：#RRGGBB。保存后重新打开 PDF 卡片层生效。</div>',

    '<button id="magic-digest-save-reader-display-settings" style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;">保存 Reader 显示设置</button>',
    '<span id="magic-digest-reader-display-settings-msg" style="margin-left:10px;color:#94a3b8;"></span>',
  ].join("");

  const mvList = doc.getElementById("mv-list");
  if (mvList && mvList.parentElement) {
    mvList.parentElement.insertBefore(section, mvList);
  } else {
    root.insertBefore(section, root.firstChild);
  }

  const saveBtn = section.querySelector(
    "#magic-digest-save-reader-display-settings",
  ) as HTMLButtonElement | null;

  saveBtn?.addEventListener("click", () => {
    const msg = section.querySelector(
      "#magic-digest-reader-display-settings-msg",
    ) as HTMLElement | null;

    try {
      const sortSelect = section.querySelector(
        "#magic-digest-reader-default-sort",
      ) as HTMLSelectElement | null;

      const langSelect = section.querySelector(
        "#magic-digest-reader-ui-language",
      ) as HTMLSelectElement | null;

      const typeColorsEl = section.querySelector(
        "#magic-digest-card-type-colors",
      ) as HTMLTextAreaElement | null;

      const tagColorsEl = section.querySelector(
        "#magic-digest-tag-colors",
      ) as HTMLTextAreaElement | null;

      const sort = sortSelect?.value || "page";
      const lang = langSelect?.value || "auto";

      setReaderDisplayPref(
        READER_DEFAULT_SORT_PREF,
        ["page", "type", "title"].includes(sort) ? sort : "page",
      );

      setReaderDisplayPref(
        READER_UI_LANGUAGE_PREF,
        ["auto", "zh", "en"].includes(lang) ? lang : "auto",
      );

      setReaderDisplayPref(
        READER_CARD_TYPE_COLORS_PREF,
        validateReaderColorJSON(
          typeColorsEl?.value || "",
          DEFAULT_READER_CARD_TYPE_COLORS_JSON,
        ),
      );

      setReaderDisplayPref(
        READER_TAG_COLORS_PREF,
        validateReaderColorJSON(
          tagColorsEl?.value || "",
          DEFAULT_READER_TAG_COLORS_JSON,
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


const STATIC_READER_CARD_TYPE_COLORS_PREF = "extensions.magic_digest.reader.cardTypeColors";
const STATIC_READER_TAG_COLORS_PREF = "extensions.magic_digest.reader.tagColors";
const STATIC_READER_DEFAULT_SORT_PREF = "extensions.magic_digest.reader.defaultSort";
const STATIC_READER_UI_LANGUAGE_PREF = "extensions.magic_digest.reader.uiLanguage";

const STATIC_DEFAULT_CARD_TYPE_COLORS = JSON.stringify(
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

const STATIC_DEFAULT_TAG_COLORS = JSON.stringify(
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

function getStaticReaderPref(key: string, fallback: string): string {
  try {
    const v = (Zotero as any).Prefs?.get?.(key, true);
    if (typeof v === "string" && v.trim()) return v;
  } catch {}

  try {
    const v = (Zotero as any).Prefs?.get?.(key);
    if (typeof v === "string" && v.trim()) return v;
  } catch {}

  return fallback;
}

function setStaticReaderPref(key: string, value: string): void {
  try {
    (Zotero as any).Prefs?.set?.(key, value, true);
    return;
  } catch {}

  try {
    (Zotero as any).Prefs?.set?.(key, value);
  } catch {}
}

function validateStaticReaderColorJSON(raw: string, fallback: string): string {
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


function parseReaderColorJSONForPicker(raw: string, fallback: string): Record<string, string> {
  try {
    const parsed = JSON.parse(String(raw || "").trim() || fallback);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return JSON.parse(fallback);
    }

    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) {
        result[String(key)] = value;
      }
    }

    return result;
  } catch {
    return JSON.parse(fallback);
  }
}

function stringifyReaderColorMapForPicker(map: Record<string, string>): string {
  return JSON.stringify(map, null, 2);
}

function getReaderColorTypeLabel(key: string): string {
  const labels: Record<string, string> = {
    insight: "洞见 insight",
    background: "背景 background",
    term: "术语 term",
    method: "方法 method",
    result: "结果 result",
    table: "表格 table",
    figure: "图像 figure",
    limitation: "局限 limitation",
    comparison: "对比 comparison",
    default: "默认 default",
    located: "已定位 located",
    "auto-located": "自动定位 auto-located",
    "full-pdf-auto-located": "全文定位 full-pdf-auto-located",
    unresolved: "未定位 unresolved",
    vision: "视觉 vision",
  };

  return labels[key] || key;
}

function renderReaderColorPickerGroup(params: {
  doc: Document;
  container: HTMLElement;
  textarea: HTMLTextAreaElement;
  fallbackJSON: string;
  title: string;
  groupID: string;
}): void {
  const { doc, container, textarea, fallbackJSON, title, groupID } = params;

  if (container.querySelector("#" + groupID)) return;

  const map = parseReaderColorJSONForPicker(textarea.value, fallbackJSON);

  const panel = doc.createElement("div");
  panel.id = groupID;

  panel.setAttribute(
    "style",
    [
      "margin:8px 0 10px",
      "padding:10px",
      "border:1px solid #334155",
      "border-radius:8px",
      "background:#0f172a",
    ].join(";"),
  );

  const titleEl = doc.createElement("div");
  titleEl.textContent = title;
  titleEl.setAttribute(
    "style",
    "font-size:13px;font-weight:800;color:#e5e7eb;margin-bottom:8px;",
  );
  panel.appendChild(titleEl);

  const grid = doc.createElement("div");
  grid.setAttribute(
    "style",
    [
      "display:grid",
      "grid-template-columns:repeat(auto-fit,minmax(220px,1fr))",
      "gap:8px",
    ].join(";"),
  );

  const syncToTextarea = () => {
    const next: Record<string, string> = {};

    const inputs = Array.from(
      panel.querySelectorAll("input[data-reader-color-key]"),
    ) as HTMLInputElement[];

    for (const input of inputs) {
      const key = input.getAttribute("data-reader-color-key") || "";
      const value = input.value;

      if (key && /^#[0-9a-fA-F]{6}$/.test(value)) {
        next[key] = value;
      }
    }

    textarea.value = stringifyReaderColorMapForPicker(next);
  };

  for (const [key, value] of Object.entries(map)) {
    const row = doc.createElement("label");
    row.setAttribute(
      "style",
      [
        "display:flex",
        "align-items:center",
        "gap:8px",
        "background:#020617",
        "border:1px solid #1e293b",
        "border-radius:6px",
        "padding:7px 8px",
        "cursor:pointer",
      ].join(";"),
    );

    const color = doc.createElement("input");
    color.type = "color";
    color.value = value;
    color.setAttribute("data-reader-color-key", key);
    color.setAttribute(
      "style",
      "width:38px;height:28px;border:0;background:transparent;cursor:pointer;",
    );

    const name = doc.createElement("span");
    name.textContent = getReaderColorTypeLabel(key);
    name.setAttribute("style", "color:#e5e7eb;font-size:12px;flex:1;");

    const valueText = doc.createElement("span");
    valueText.textContent = value;
    valueText.setAttribute(
      "style",
      "color:#94a3b8;font-size:11px;font-family:monospace;",
    );

    color.addEventListener("input", () => {
      valueText.textContent = color.value;
      syncToTextarea();
    });

    row.appendChild(color);
    row.appendChild(name);
    row.appendChild(valueText);
    grid.appendChild(row);
  }

  panel.appendChild(grid);

  const advanced = doc.createElement("button");
  advanced.type = "button";
  advanced.textContent = "显示/隐藏 JSON 高级编辑";
  advanced.setAttribute(
    "style",
    [
      "margin-top:10px",
      "background:#334155",
      "color:#e5e7eb",
      "border:0",
      "border-radius:6px",
      "padding:4px 8px",
      "cursor:pointer",
      "font-size:12px",
    ].join(";"),
  );

  textarea.style.display = "none";

  advanced.addEventListener("click", () => {
    textarea.style.display = textarea.style.display === "none" ? "block" : "none";
  });

  panel.appendChild(advanced);

  container.insertBefore(panel, textarea);
}

function bindStaticReaderSettingsControls(doc: Document): void {
  const section = doc.getElementById("mv-reader-settings-static");
  if (!section || section.getAttribute("data-bound") === "true") return;

  section.setAttribute("data-bound", "true");

  const sort = doc.getElementById("mv-reader-default-sort") as HTMLSelectElement | null;
  const lang = doc.getElementById("mv-reader-ui-language") as HTMLSelectElement | null;
  const typeColors = doc.getElementById("mv-reader-card-type-colors") as HTMLTextAreaElement | null;
  const tagColors = doc.getElementById("mv-reader-tag-colors") as HTMLTextAreaElement | null;
  const save = doc.getElementById("mv-reader-save") as HTMLButtonElement | null;
  const msg = doc.getElementById("mv-reader-msg") as HTMLElement | null;

  if (sort) sort.value = getStaticReaderPref(STATIC_READER_DEFAULT_SORT_PREF, "page");
  if (lang) lang.value = getStaticReaderPref(STATIC_READER_UI_LANGUAGE_PREF, "auto");
  if (typeColors) typeColors.value = getStaticReaderPref(STATIC_READER_CARD_TYPE_COLORS_PREF, STATIC_DEFAULT_CARD_TYPE_COLORS);
  if (tagColors) tagColors.value = getStaticReaderPref(STATIC_READER_TAG_COLORS_PREF, STATIC_DEFAULT_TAG_COLORS);

  if (typeColors) {
    renderReaderColorPickerGroup({
      doc,
      container: section as HTMLElement,
      textarea: typeColors,
      fallbackJSON: STATIC_DEFAULT_CARD_TYPE_COLORS,
      title: "卡片类型颜色",
      groupID: "mv-reader-card-type-color-picker",
    });
  }

  if (tagColors) {
    renderReaderColorPickerGroup({
      doc,
      container: section as HTMLElement,
      textarea: tagColors,
      fallbackJSON: STATIC_DEFAULT_TAG_COLORS,
      title: "标签颜色",
      groupID: "mv-reader-tag-color-picker",
    });
  }

  save?.addEventListener("click", () => {
    try {
      const sortValue = sort?.value || "page";
      const langValue = lang?.value || "auto";

      setStaticReaderPref(
        STATIC_READER_DEFAULT_SORT_PREF,
        ["page", "type", "title"].includes(sortValue) ? sortValue : "page",
      );

      setStaticReaderPref(
        STATIC_READER_UI_LANGUAGE_PREF,
        ["auto", "zh", "en"].includes(langValue) ? langValue : "auto",
      );

      setStaticReaderPref(
        STATIC_READER_CARD_TYPE_COLORS_PREF,
        validateStaticReaderColorJSON(typeColors?.value || "", STATIC_DEFAULT_CARD_TYPE_COLORS),
      );

      setStaticReaderPref(
        STATIC_READER_TAG_COLORS_PREF,
        validateStaticReaderColorJSON(tagColors?.value || "", STATIC_DEFAULT_TAG_COLORS),
      );

      if (msg) {
        msg.textContent = "已保存。请重新打开 PDF 卡片层。";
        msg.style.color = "#16a34a";
      }
    } catch (e: any) {
      if (msg) {
        msg.textContent = "保存失败：" + (e?.message || String(e));
        msg.style.color = "#dc2626";
      }
    }
  });
}

function bindDataDirSetting(doc: Document) {
  const input = doc.getElementById("mv-data-dir") as HTMLInputElement | null;
  const saveBtn = doc.getElementById("mv-data-dir-save") as HTMLButtonElement | null;
  const msg = doc.getElementById("mv-data-dir-msg") as HTMLElement | null;
  if (!input || !saveBtn) return;

  const PREF_KEY = "extensions.zotero.my_vibero.magicDigest.dataRootDir";

  const current = String(Zotero.Prefs.get(PREF_KEY, true) || "").trim();
  input.value = current || "";

  saveBtn.addEventListener("click", () => {
    try {
      const val = input.value.trim();
      Zotero.Prefs.set(PREF_KEY, val, true);
      if (msg) {
        msg.textContent = "✅ 已保存";
        msg.style.color = "#16a34a";
        setTimeout(function () { msg.textContent = ""; }, 2000);
      }
    } catch (e: any) {
      if (msg) {
        msg.textContent = "❌ 保存失败：" + (e?.message || String(e));
        msg.style.color = "#dc2626";
      }
    }
  });
}

export function initMagicDigestPreferencePane(doc: Document) {
  try {
    bindStaticReaderSettingsControls(doc);
  } catch (e) {
    ztoolkit.log("magic_digest bind static reader settings failed", e);
  }
  try {
    bindDataDirSetting(doc);
  } catch (e) {
    ztoolkit.log("magic_digest bind data dir setting failed", e);
  }
  try {
    const root = doc.getElementById("mv-root") as HTMLElement | null;
    if (!root) return;

    if (root.dataset.initialized === "1") {
      return;
    }

    root.dataset.initialized = "1";

    render(doc);
    bind(doc);
  } catch (e: any) {
    setMsg(doc, "初始化失败：" + (e?.message || String(e)), "fail");
  }

  try {
    renderReaderDisplaySettings(doc);
  } catch (e) {
    ztoolkit.log("magic_digest render reader display settings failed", e);
  }
}

// ----- end of file marker (do not remove) -----
