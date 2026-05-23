import { config } from "../../package.json";

export type MagicDigestConfig = {
  deepseekBaseURL: string;
  deepseekAPIKey: string;
  deepseekModel: string;
  deepseekTemperature: string;
  deepseekMaxTokens: string;

  /**
   * llm-for-zotero 的 MinerU 缓存根目录。
   * 子目录名 = Zotero PDF 附件 itemID。
   */
  llmForZoteroMineruRootDir: string;

  /**
   * magic_digest 自己的分析数据目录。
   * 子目录名 = Zotero PDF 附件 itemID。
   */
  magicDigestDataRootDir: string;

  /**
   * 兼容旧字段。后续会逐步移除。
   */
  cacheRootDir: string;
  mineruBaseURL: string;
  mineruAPIKey: string;
  mineruSubmitPath: string;
  mineruResultPath: string;
  mineruFileURL: string;
};

const KEYS = {
  deepseekBaseURL: `${config.prefsPrefix}.deepseek.baseURL`,
  deepseekAPIKey: `${config.prefsPrefix}.deepseek.apiKey`,
  deepseekModel: `${config.prefsPrefix}.deepseek.model`,
  deepseekTemperature: `${config.prefsPrefix}.deepseek.temperature`,
  deepseekMaxTokens: `${config.prefsPrefix}.deepseek.maxTokens`,

  llmForZoteroMineruRootDir: `${config.prefsPrefix}.llmForZotero.mineruRootDir`,
  magicDigestDataRootDir: `${config.prefsPrefix}.magicDigest.dataRootDir`,

  cacheRootDir: `${config.prefsPrefix}.cache.rootDir`,
  mineruBaseURL: `${config.prefsPrefix}.mineru.baseURL`,
  mineruAPIKey: `${config.prefsPrefix}.mineru.apiKey`,
  mineruSubmitPath: `${config.prefsPrefix}.mineru.submitPath`,
  mineruResultPath: `${config.prefsPrefix}.mineru.resultPath`,
  mineruFileURL: `${config.prefsPrefix}.mineru.fileURL`,
} as const;

function getDefaultDataBaseDir(): string {
  try {
    const zoteroDataDir = (Zotero as any).DataDirectory || Zotero.getProfileDirectory?.();
    if (zoteroDataDir) {
      const pathUtils = (globalThis as any).PathUtils;
      if (pathUtils) {
        return pathUtils.join(String(zoteroDataDir), "magic-digest-data");
      }
      return String(zoteroDataDir).replace(/[\\/][^\\/]*$/, "") + "\\magic-digest-data";
    }
  } catch {
    // Zotero 未初始化
  }
  return "";
}

const DEFAULTS: MagicDigestConfig = {
  deepseekBaseURL: "https://api.deepseek.com",
  deepseekAPIKey: "",
  deepseekModel: "deepseek-chat",
  deepseekTemperature: "0.2",
  deepseekMaxTokens: "4096",

  llmForZoteroMineruRootDir: "",
  magicDigestDataRootDir: "",

  cacheRootDir: "",
  mineruBaseURL: "",
  mineruAPIKey: "",
  mineruSubmitPath: "",
  mineruResultPath: "",
  mineruFileURL: "",
};

function getPref(key: string, fallback = ""): string {
  const v = Zotero.Prefs.get(key, true);
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim();
  return s || fallback;
}

function setPref(key: string, value: string) {
  Zotero.Prefs.set(key, value, true);
}

export function ensureDefaultConfig() {
  const entries = Object.entries(KEYS) as Array<[keyof typeof KEYS, string]>;
  for (const [name, prefKey] of entries) {
    const oldValue = getPref(prefKey, "");
    if (!oldValue) {
      // 数据目录使用动态默认值
      if (
        name === "llmForZoteroMineruRootDir" ||
        name === "magicDigestDataRootDir" ||
        name === "cacheRootDir"
      ) {
        const dynamicDefault = getDefaultDataBaseDir();
        if (dynamicDefault) {
          setPref(prefKey, dynamicDefault);
          continue;
        }
      }
      setPref(prefKey, DEFAULTS[name]);
    }
  }
}

export function getConfig(): MagicDigestConfig {
  return {
    deepseekBaseURL: getPref(KEYS.deepseekBaseURL, DEFAULTS.deepseekBaseURL),
    deepseekAPIKey: getPref(KEYS.deepseekAPIKey, DEFAULTS.deepseekAPIKey),
    deepseekModel: getPref(KEYS.deepseekModel, DEFAULTS.deepseekModel),
    deepseekTemperature: getPref(
      KEYS.deepseekTemperature,
      DEFAULTS.deepseekTemperature,
    ),
    deepseekMaxTokens: getPref(
      KEYS.deepseekMaxTokens,
      DEFAULTS.deepseekMaxTokens,
    ),

    llmForZoteroMineruRootDir: getPref(
      KEYS.llmForZoteroMineruRootDir,
      DEFAULTS.llmForZoteroMineruRootDir,
    ),
    magicDigestDataRootDir: getPref(
      KEYS.magicDigestDataRootDir,
      DEFAULTS.magicDigestDataRootDir,
    ),

    cacheRootDir: getPref(KEYS.cacheRootDir, DEFAULTS.cacheRootDir),
    mineruBaseURL: getPref(KEYS.mineruBaseURL, DEFAULTS.mineruBaseURL),
    mineruAPIKey: getPref(KEYS.mineruAPIKey, DEFAULTS.mineruAPIKey),
    mineruSubmitPath: getPref(KEYS.mineruSubmitPath, DEFAULTS.mineruSubmitPath),
    mineruResultPath: getPref(KEYS.mineruResultPath, DEFAULTS.mineruResultPath),
    mineruFileURL: getPref(KEYS.mineruFileURL, DEFAULTS.mineruFileURL),
  };
}

export function setConfigPatch(patch: Partial<MagicDigestConfig>) {
  if (patch.deepseekBaseURL !== undefined)
    setPref(KEYS.deepseekBaseURL, patch.deepseekBaseURL);
  if (patch.deepseekAPIKey !== undefined)
    setPref(KEYS.deepseekAPIKey, patch.deepseekAPIKey);
  if (patch.deepseekModel !== undefined)
    setPref(KEYS.deepseekModel, patch.deepseekModel);
  if (patch.deepseekTemperature !== undefined)
    setPref(KEYS.deepseekTemperature, patch.deepseekTemperature);
  if (patch.deepseekMaxTokens !== undefined)
    setPref(KEYS.deepseekMaxTokens, patch.deepseekMaxTokens);

  if (patch.llmForZoteroMineruRootDir !== undefined)
    setPref(KEYS.llmForZoteroMineruRootDir, patch.llmForZoteroMineruRootDir);
  if (patch.magicDigestDataRootDir !== undefined)
    setPref(KEYS.magicDigestDataRootDir, patch.magicDigestDataRootDir);

  if (patch.cacheRootDir !== undefined)
    setPref(KEYS.cacheRootDir, patch.cacheRootDir);
  if (patch.mineruBaseURL !== undefined)
    setPref(KEYS.mineruBaseURL, patch.mineruBaseURL);
  if (patch.mineruAPIKey !== undefined)
    setPref(KEYS.mineruAPIKey, patch.mineruAPIKey);
  if (patch.mineruSubmitPath !== undefined)
    setPref(KEYS.mineruSubmitPath, patch.mineruSubmitPath);
  if (patch.mineruResultPath !== undefined)
    setPref(KEYS.mineruResultPath, patch.mineruResultPath);
  if (patch.mineruFileURL !== undefined)
    setPref(KEYS.mineruFileURL, patch.mineruFileURL);
}