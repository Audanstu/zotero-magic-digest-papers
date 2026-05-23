import { unzipSync } from "fflate";
import { ensureDefaultConfig, getConfig } from "./configService";

type MineruBatchCreateResponse = {
  data?: {
    batch_id?: string;
    file_urls?: string[];
  };
  msg?: string;
  code?: number;
  [key: string]: unknown;
};

type MineruBatchPollResponse = {
  data?: {
    extract_result?: Array<{
      state?: string;
      full_zip_url?: string;
    }>;
  };
  msg?: string;
  code?: number;
  [key: string]: unknown;
};

function getFetch(): typeof fetch {
  return ztoolkit.getGlobal("fetch") as typeof fetch;
}

function buildApiBase(baseURL: string): string {
  const b = (baseURL || "").replace(/\/+$/, "");
  return b || "https://mineru.net/api/v4";
}

async function httpJson(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; data: unknown }> {
  const xhr = await Zotero.HTTP.request(method, url, {
    headers,
    body: body ?? undefined,
    responseType: "text",
    successCodes: false,
    timeout: 60000,
  });

  let data: unknown = null;
  try {
    data = JSON.parse(xhr.responseText || "null");
  } catch {
    data = xhr.responseText || null;
  }

  return {
    status: xhr.status,
    data,
  };
}

async function readPdfBytes(pdfPath: string): Promise<Uint8Array | null> {
  const io = (globalThis as unknown as {
    IOUtils?: {
      read?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
    };
  }).IOUtils;

  if (io?.read) {
    try {
      const data = await io.read(pdfPath);
      if (data instanceof Uint8Array) return data;
      return new Uint8Array(data);
    } catch (e) {
      ztoolkit.log("magic_digest MinerU: IOUtils.read failed", e);
    }
  }

  const osFile = (globalThis as unknown as {
    OS?: {
      File?: {
        read?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
      };
    };
  }).OS?.File;

  if (osFile?.read) {
    try {
      const data = await osFile.read(pdfPath);
      if (data instanceof Uint8Array) return data;
      return new Uint8Array(data);
    } catch (e) {
      ztoolkit.log("magic_digest MinerU: OS.File.read failed", e);
    }
  }

  return null;
}

async function httpPutBinary(
  url: string,
  bytes: Uint8Array,
): Promise<{ status: number }> {
  try {
    const resp = await getFetch()(url, {
      method: "PUT",
      body: new Uint8Array(bytes),
    });
    return { status: resp.status };
  } catch (e) {
    ztoolkit.log("magic_digest MinerU: fetch PUT failed", e);
  }

  try {
    const xhr = await Zotero.HTTP.request("PUT", url, {
      body: new Uint8Array(bytes),
      successCodes: false,
      timeout: 180000,
      errorDelayMax: 0,
    });
    return { status: xhr.status };
  } catch (e) {
    ztoolkit.log("magic_digest MinerU: Zotero.HTTP PUT failed", e);
  }

  return { status: 0 };
}

async function downloadBinary(url: string): Promise<Uint8Array | null> {
  try {
    const resp = await getFetch()(url);
    if (resp.ok) {
      return new Uint8Array(await resp.arrayBuffer());
    }
  } catch (e) {
    ztoolkit.log("magic_digest MinerU: fetch download failed", e);
  }

  try {
    const xhr = await Zotero.HTTP.request("GET", url, {
      responseType: "arraybuffer",
      successCodes: false,
      timeout: 120000,
      errorDelayMax: 0,
    });
    if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
      return new Uint8Array(xhr.response as ArrayBuffer);
    }
  } catch (e) {
    ztoolkit.log("magic_digest MinerU: Zotero.HTTP download failed", e);
  }

  return null;
}

function unzipFirstMarkdown(zipBytes: Uint8Array): string | null {
  try {
    const entries = unzipSync(zipBytes);

    if (entries["full.md"]) {
      return new TextDecoder("utf-8").decode(entries["full.md"]);
    }

    for (const [name, bytes] of Object.entries(entries)) {
      if (name.toLowerCase().endsWith(".md")) {
        return new TextDecoder("utf-8").decode(bytes);
      }
    }

    return null;
  } catch (e) {
    ztoolkit.log("magic_digest MinerU: unzip failed", e);
    return null;
  }
}

export async function parsePdfWithMineru(filePath: string): Promise<{
  taskID: string;
  markdown: string;
  fullZipURL: string;
  rawBatch: MineruBatchCreateResponse;
  rawPoll: MineruBatchPollResponse;
}> {
  ensureDefaultConfig();
  const cfg = getConfig();

  const apiBase = buildApiBase(cfg.mineruBaseURL);
  const apiKey = String(cfg.mineruAPIKey || "").trim();

  if (!apiKey) {
    throw new Error("MinerU apiKey is empty");
  }

  const pdfBytes = await readPdfBytes(filePath);
  if (!pdfBytes || !pdfBytes.length) {
    throw new Error("PDF file is empty or unreadable");
  }

  const rawName = filePath.split(/[\\/]/).pop() || "paper.pdf";
  const fileName = rawName.replace(/[^\x20-\x7E]/g, "_") || "paper.pdf";

  const batchURL = `${apiBase}/file-urls/batch`;

  const batchBody = {
    enable_formula: true,
    enable_table: true,
    language: "ch",
    model_version: "pipeline",
    files: [
      {
        name: fileName,
        is_ocr: false,
      },
    ],
  };

  const batchResult = await httpJson(
    "POST",
    batchURL,
    {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    JSON.stringify(batchBody),
  );

  if (batchResult.status < 200 || batchResult.status >= 300) {
    throw new Error(
      `MinerU batch create failed: HTTP ${batchResult.status} ${JSON.stringify(batchResult.data)}`,
    );
  }

  const rawBatch = batchResult.data as MineruBatchCreateResponse;
  const taskID = String(rawBatch.data?.batch_id || "");
  const uploadURL = String(rawBatch.data?.file_urls?.[0] || "");

  if (!taskID || !uploadURL) {
    throw new Error(`MinerU batch response missing batch_id or file_urls: ${JSON.stringify(rawBatch)}`);
  }

  const uploadResult = await httpPutBinary(uploadURL, pdfBytes);
  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error(`MinerU upload failed: HTTP ${uploadResult.status}`);
  }

  const pollURL = `${apiBase}/extract-results/batch/${encodeURIComponent(taskID)}`;
  const maxPoll = 120;
  const pollIntervalMs = 3000;

  for (let i = 0; i < maxPoll; i++) {
    const pollResult = await httpJson(
      "GET",
      pollURL,
      {
        Authorization: `Bearer ${apiKey}`,
      },
    );

    if (pollResult.status >= 200 && pollResult.status < 300) {
      const rawPoll = pollResult.data as MineruBatchPollResponse;
      const item = rawPoll.data?.extract_result?.[0];
      const state = String(item?.state || "").toLowerCase();
      const fullZipURL = String(item?.full_zip_url || "");

      ztoolkit.log("magic_digest MinerU poll", { state, taskID });

      if (state === "done" && fullZipURL) {
        const zipBytes = await downloadBinary(fullZipURL);
        if (!zipBytes) {
          throw new Error("MinerU full_zip_url download failed");
        }

        const markdown = unzipFirstMarkdown(zipBytes);
        if (!markdown) {
          throw new Error("MinerU ZIP does not contain readable markdown");
        }

        return {
          taskID,
          markdown,
          fullZipURL,
          rawBatch,
          rawPoll,
        };
      }

      if (state === "failed") {
        throw new Error(`MinerU task failed: ${JSON.stringify(rawPoll)}`);
      }
    }

    await Zotero.Promise.delay(pollIntervalMs);
  }

  throw new Error("MinerU poll timeout");
}