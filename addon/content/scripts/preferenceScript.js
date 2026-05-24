
(function () {
  if (globalThis.__magicDigestPreferenceScriptLoaded) {
    return;
  }
  globalThis.__magicDigestPreferenceScriptLoaded = true;

  try {
    const marker = document.getElementById("magic-digest-model-settings-root");
    if (marker) {
      marker.textContent = "模型 API 表单脚本已加载，正在渲染...";
    }
  } catch (e) {
    // ignore
  }

  const MAX = 8;
  const DEFAULT_SLOTS = 3;
  const PREF_CONFIGS = "extensions.my_vibero.modelConfigs";
  const PREF_DEFAULT = "extensions.my_vibero.defaultModelId";

  function now() {
    return new Date().toISOString();
  }

  function id(prefix) {
    return (prefix || "model") + "-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function prefGet(key, fallback) {
    try {
      const v = Zotero.Prefs.get(key, true);
      if (v === undefined || v === null) return fallback || "";
      return String(v);
    } catch (e) {
      try {
        const v = Zotero.Prefs.get(key);
        if (v === undefined || v === null) return fallback || "";
        return String(v);
      } catch (e2) {
        return fallback || "";
      }
    }
  }

  function prefSet(key, value) {
    try {
      Zotero.Prefs.set(key, String(value), true);
    } catch (e) {
      Zotero.Prefs.set(key, String(value));
    }
  }

  function cleanBaseURL(s) {
    return String(s || "").trim().replace(/\/+$/, "");
  }

  function deepseekTemplate() {
    const t = now();
    return {
      id: "deepseek-default",
      name: "DeepSeek 官方",
      provider: "openai-compatible",
      baseURL: "https://api.deepseek.com",
      apiKey: "",
      model: "deepseek-chat",
      enabled: true,
      createdAt: t,
      updatedAt: t,
    };
  }

  function emptyConfig(n) {
    const t = now();
    return {
      id: id("model"),
      name: "自定义模型 " + n,
      provider: "openai-compatible",
      baseURL: "",
      apiKey: "",
      model: "",
      enabled: true,
      createdAt: t,
      updatedAt: t,
    };
  }

  function sanitize(x) {
    const t = now();
    x = x || {};
    return {
      id: String(x.id || "").trim() || id("model"),
      name: String(x.name || "").trim() || "未命名模型",
      provider: "openai-compatible",
      baseURL: cleanBaseURL(x.baseURL || ""),
      apiKey: String(x.apiKey || "").trim(),
      model: String(x.model || "").trim(),
      enabled: x.enabled !== false,
      createdAt: String(x.createdAt || "").trim() || t,
      updatedAt: t,
    };
  }

  function getConfigs() {
    const raw = prefGet(PREF_CONFIGS, "");
    if (!raw) return [deepseekTemplate()];

    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [deepseekTemplate()];

      const configs = arr.map(sanitize).slice(0, MAX);
      if (!configs.length) return [deepseekTemplate()];

      return configs;
    } catch (e) {
      return [deepseekTemplate()];
    }
  }

  function saveConfigs(configs) {
    prefSet(PREF_CONFIGS, JSON.stringify(configs.map(sanitize).slice(0, MAX)));
  }

  function getDefaultId() {
    const current = prefGet(PREF_DEFAULT, "");
    if (current) return current;
    const first = getConfigs().find((x) => x.enabled) || getConfigs()[0];
    return first ? first.id : "";
  }

  function setDefaultId(modelId) {
    prefSet(PREF_DEFAULT, modelId);
  }

  function displayConfigs() {
    const configs = getConfigs();
    while (configs.length < DEFAULT_SLOTS) {
      configs.push(emptyConfig(configs.length + 1));
    }
    return configs.slice(0, MAX);
  }

  function msg(text, type) {
    try {
      new ztoolkit.ProgressWindow("magic_digest", {
        closeOnClick: true,
        closeTime: type === "fail" ? 8000 : 4500,
      })
        .createLine({
          text,
          type: type || "default",
          progress: 100,
        })
        .show();
    } catch (e) {
      alert(text);
    }
  }

  let configs = displayConfigs();

  function isBlank(c) {
    return !c.baseURL && !c.apiKey && !c.model;
  }

  function validate(c) {
    if (!c.name) return "请填写 API 配置名称";
    if (!c.baseURL) return "请填写「" + c.name + "」的 Base URL";
    if (!c.apiKey) return "请填写「" + c.name + "」的 API Key";
    if (!c.model) return "请填写「" + c.name + "」的 Model 名称";
    return "";
  }

  function readCard(card) {
    function val(sel) {
      const el = card.querySelector(sel);
      return String(el && el.value ? el.value : "").trim();
    }

    function checked(sel) {
      const el = card.querySelector(sel);
      return !!(el && el.checked);
    }

    return {
      id: String(card.dataset.id || "").trim() || id("model"),
      name: val(".mv-name") || "未命名模型",
      provider: "openai-compatible",
      baseURL: cleanBaseURL(val(".mv-base")),
      apiKey: val(".mv-key"),
      model: val(".mv-model"),
      enabled: checked(".mv-enabled"),
      createdAt: String(card.dataset.createdAt || "").trim() || now(),
      updatedAt: now(),
    };
  }

  function collect() {
    return Array.from(document.querySelectorAll(".mv-card")).map(readCard);
  }

  function cardHTML(c, i, total, def) {
    const isDefault = c.id === def;
    const canDelete = total > DEFAULT_SLOTS;

    return ''
      + '<div class="mv-card" data-id="' + esc(c.id) + '" data-created-at="' + esc(c.createdAt || now()) + '"'
      + ' style="border:1px solid var(--fill-quinary);border-radius:8px;padding:12px;margin-bottom:12px;'
      + 'background:' + (isDefault ? "rgba(37,99,235,.16)" : "var(--material-background)") + ';'
      + 'box-shadow:' + (isDefault ? "0 0 0 2px rgba(37,99,235,.25)" : "none") + ';">'

      + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:10px;">'
      + '<div style="font-weight:700;">API 配置 ' + (i + 1)
      + (isDefault ? '<span style="margin-left:8px;background:#2563eb;color:#fff;border-radius:999px;padding:1px 8px;font-size:11px;">默认解析模型</span>' : '')
      + '</div>'

      + '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'
      + '<label style="font-size:12px;"><input class="mv-enabled" type="checkbox" ' + (c.enabled ? "checked" : "") + ' /> 启用</label>'
      + '<button class="mv-test" type="button" style="background:#0f766e;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;">测试</button>'
      + '<button class="mv-default" type="button" style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;">设为默认</button>'
      + (canDelete ? '<button class="mv-delete" type="button" style="background:#991b1b;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;">删除</button>' : '')
      + '</div></div>'

      + '<div style="display:grid;grid-template-columns:120px minmax(0,1fr);gap:8px 10px;align-items:center;">'
      + '<label>自定义名称</label>'
      + '<input class="mv-name" value="' + esc(c.name) + '" placeholder="例如：DeepSeek 官方 / Kimi 32K / 本地 Ollama" style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid var(--fill-quaternary);" />'

      + '<label>Base URL</label>'
      + '<input class="mv-base" value="' + esc(c.baseURL) + '" placeholder="https://api.deepseek.com 或 https://api.openai.com/v1" style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid var(--fill-quaternary);" />'

      + '<label>API Key</label>'
      + '<input class="mv-key" type="password" value="' + esc(c.apiKey) + '" placeholder="sk-..." style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid var(--fill-quaternary);" />'

      + '<label>Model</label>'
      + '<input class="mv-model" value="' + esc(c.model) + '" placeholder="deepseek-chat / gpt-4o-mini / qwen-plus" style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid var(--fill-quaternary);" />'
      + '</div>'

      + '<div style="font-size:11px;color:var(--fill-tertiary);margin-top:8px;">兼容 OpenAI Chat Completions：/v1/chat/completions</div>'
      + '</div>';
  }

  function render() {
    const root = document.getElementById("magic-digest-model-settings-root");
    if (!root) return;

    const def = getDefaultId();
    root.innerHTML = ''
      + '<div id="mv-current" style="margin-bottom:12px;padding:8px 10px;border:1px solid var(--fill-quinary);border-radius:6px;">'
      + currentText()
      + '</div>'
      + '<div id="mv-list">'
      + configs.map(function (c, i) { return cardHTML(c, i, configs.length, def); }).join("")
      + '</div>'
      + '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px;">'
      + '<button id="mv-add" type="button" style="background:#0369a1;color:white;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;">+ 添加模型 API</button>'
      + '<button id="mv-save" type="button" style="background:#16a34a;color:white;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;">保存模型设置</button>'
      + '</div>';

    bind();
  }

  function currentText() {
    const def = getDefaultId();
    const c = getConfigs().find(function (x) { return x.id === def; }) || getConfigs()[0];

    if (!c) return "当前默认解析模型：未配置";

    return "当前默认解析模型：" + c.name + " / " + c.model + " / " + (c.enabled ? "启用" : "禁用");
  }

  function saveFromUI() {
    const all = collect();
    const valid = [];

    for (const c of all) {
      if (isBlank(c)) continue;

      const err = validate(c);
      if (err) {
        msg(err, "fail");
        return false;
      }

      valid.push(c);
    }

    if (!valid.length) {
      msg("请至少配置一个可用的模型 API", "fail");
      return false;
    }

    saveConfigs(valid);

    const def = getDefaultId();
    if (!valid.some(function (x) { return x.id === def; })) {
      setDefaultId(valid[0].id);
    }

    configs = displayConfigs();
    render();

    msg("模型 API 设置已保存 ✅", "success");
    return true;
  }

  async function testConfig(c) {
    const base = cleanBaseURL(c.baseURL);
    const url = base.endsWith("/chat/completions")
      ? base
      : base.endsWith("/v1")
        ? base + "/chat/completions"
        : base + "/v1/chat/completions";

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + c.apiKey,
      },
      body: JSON.stringify({
        model: c.model,
        temperature: 0,
        max_tokens: 80,
        messages: [
          { role: "system", content: "You are a connectivity test assistant." },
          { role: "user", content: "请只回复一句中文：magic_digest 模型连接成功。" },
        ],
      }),
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error("HTTP " + res.status + ": " + text.slice(0, 800));
    }

    let json = {};
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error("返回不是 JSON：" + text.slice(0, 800));
    }

    return String(json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content || "");
  }

  function bind() {
    const add = document.getElementById("mv-add");
    const save = document.getElementById("mv-save");
    const list = document.getElementById("mv-list");

    if (add) {
      add.onclick = function (ev) {
        ev.preventDefault();
        configs = collect();

        if (configs.length >= MAX) {
          msg("最多只能添加 " + MAX + " 个 API 配置", "fail");
          return;
        }

        configs.push(emptyConfig(configs.length + 1));
        render();
      };
    }

    if (save) {
      save.onclick = function (ev) {
        ev.preventDefault();
        saveFromUI();
      };
    }

    if (list) {
      list.onclick = async function (ev) {
        const target = ev.target;
        if (!target) return;

        const card = target.closest(".mv-card");
        if (!card) return;

        if (target.classList.contains("mv-delete")) {
          ev.preventDefault();
          const c = readCard(card);
          if (!confirm("确定删除 API 配置「" + c.name + "」吗？")) return;

          configs = collect().filter(function (x) { return x.id !== c.id; });

          while (configs.length < DEFAULT_SLOTS) {
            configs.push(emptyConfig(configs.length + 1));
          }

          render();
          return;
        }

        if (target.classList.contains("mv-default")) {
          ev.preventDefault();

          const c = readCard(card);
          const err = validate(c);
          if (err) {
            msg(err, "fail");
            return;
          }

          const valid = collect().filter(function (x) { return !isBlank(x); });
          saveConfigs(valid);
          setDefaultId(c.id);

          configs = displayConfigs();
          render();

          msg("已设为默认解析模型：" + c.name, "success");
          return;
        }

        if (target.classList.contains("mv-test")) {
          ev.preventDefault();

          const btn = target;
          const c = readCard(card);
          const err = validate(c);
          if (err) {
            msg(err, "fail");
            return;
          }

          btn.disabled = true;
          btn.textContent = "测试中...";

          try {
            const content = await testConfig(c);
            msg("连接成功：" + c.name + "，返回：" + content.slice(0, 80), "success");
          } catch (e) {
            msg("连接失败：" + (e && e.message ? e.message : String(e)), "fail");
          } finally {
            btn.disabled = false;
            btn.textContent = "测试";
          }
        }
      };
    }
  }

  function init() {
    const root = document.getElementById("magic-digest-model-settings-root");
    if (!root) return;

    configs = displayConfigs();
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
