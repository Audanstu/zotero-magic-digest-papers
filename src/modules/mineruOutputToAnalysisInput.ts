import type { LlmForZoteroMineruOutput } from "./llmForZoteroMineruProvider";
import { readTextFile } from "./magicDigestAnalysisCache";

export type MineruContentListItem = {
  type?: string;
  text?: string;
  page_idx?: number;
  page?: number;
  text_level?: number;
  img_path?: string;
  table_body?: string;
  table_caption?: string;
  [key: string]: unknown;
};

export type PageTextBlock = {
  page: number; // internal 0-based
  text: string;
  type: string;
};

export type AnalysisInputBundle = {
  attachmentItemID: number;
  title: string;
  totalPages: number;
  skippedPages: number[]; // internal 0-based
  pages: Array<{
    page: number; // internal 0-based
    displayPage: number; // UI 1-based
    text: string;
  }>;
  figures: Array<{
    label: string;
    path: string;
    caption: string;
    page: number;
    section: string;
  }>;
  tables: Array<{
    label: string;
    path: string;
    caption: string;
    page: number;
    section: string;
  }>;
  rawManifestSummary: string;
};

async function readJSONFile<T>(path: string): Promise<T | null> {
  const text = await readTextFile(path);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function normalizePage(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function makeManifestSummary(output: LlmForZoteroMineruOutput): string {
  const manifest = output.manifest;
  if (!manifest) return "";

  const sections = Array.isArray(manifest.sections) ? manifest.sections : [];
  const lines: string[] = [];

  lines.push(`totalPages: ${manifest.totalPages ?? "unknown"}`);
  lines.push(`totalChars: ${manifest.totalChars ?? "unknown"}`);
  lines.push("");
  lines.push("Sections:");

  for (const section of sections) {
    const heading = normalizeText(section.heading);
    const page = section.page;
    if (!heading) continue;
    lines.push(`- page ${page}: ${heading}`);
  }

  return lines.join("\n");
}

function extractTitle(output: LlmForZoteroMineruOutput): string {
  const sections = Array.isArray(output.manifest?.sections)
    ? output.manifest!.sections!
    : [];

  const firstHeading = normalizeText(sections[0]?.heading);
  if (firstHeading) return firstHeading;

  const md = output.fullMarkdown || "";
  const firstTitle = md
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));

  return firstTitle ? firstTitle.replace(/^#\s+/, "").trim() : "";
}

export async function buildAnalysisInputFromMineruOutput(params: {
  output: LlmForZoteroMineruOutput;
  skippedPages?: number[]; // internal 0-based
}): Promise<AnalysisInputBundle> {
  const output = params.output;
  const skippedSet = new Set((params.skippedPages || []).map((p) => Math.floor(p)));

  let contentList: MineruContentListItem[] | null = null;

  if (output.contentListPath) {
    contentList = await readJSONFile<MineruContentListItem[]>(
      output.contentListPath,
    );
  }

  const pageMap = new Map<number, PageTextBlock[]>();

  if (Array.isArray(contentList)) {
    for (const item of contentList) {
      const page =
        normalizePage(item.page_idx) ??
        normalizePage(item.page);

      if (page === null) continue;
      if (skippedSet.has(page)) continue;

      const text = normalizeText(item.text || item.table_body);
      if (!text) continue;

      const type = normalizeText(item.type) || "text";
      const arr = pageMap.get(page) || [];
      arr.push({ page, text, type });
      pageMap.set(page, arr);
    }
  }

  // 如果 content_list 为空，兜底使用 full.md，但 page 用 0。
  if (!pageMap.size && output.fullMarkdown) {
    pageMap.set(0, [
      {
        page: 0,
        text: output.fullMarkdown,
        type: "markdown",
      },
    ]);
  }

  const pages = [...pageMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, blocks]) => ({
      page,
      displayPage: page + 1,
      text: blocks.map((b) => b.text).join("\n\n"),
    }));

  const figures = Array.isArray(output.manifest?.allFigures)
    ? output.manifest!.allFigures!.map((f) => ({
        label: normalizeText(f.label),
        path: normalizeText(f.path),
        caption: normalizeText(f.caption),
        page: Number(f.page ?? 0),
        section: normalizeText(f.section),
      }))
    : [];

  const tables = Array.isArray(output.manifest?.allTables)
    ? output.manifest!.allTables!.map((t) => ({
        label: normalizeText(t.label),
        path: normalizeText(t.path),
        caption: normalizeText(t.caption),
        page: Number(t.page ?? 0),
        section: normalizeText(t.section),
      }))
    : [];

  return {
    attachmentItemID: output.attachmentItemID,
    title: extractTitle(output),
    totalPages: Number(output.manifest?.totalPages || pages.length || 0),
    skippedPages: [...skippedSet].sort((a, b) => a - b),
    pages,
    figures,
    tables,
    rawManifestSummary: makeManifestSummary(output),
  };
}

export function formatAnalysisInputForPrompt(input: AnalysisInputBundle): string {
  const lines: string[] = [];

  lines.push(`# Paper`);
  lines.push(`Title: ${input.title || "Unknown"}`);
  lines.push(`Total pages: ${input.totalPages}`);
  lines.push(
    `Skipped pages: ${
      input.skippedPages.length
        ? input.skippedPages.map((p) => p + 1).join(", ")
        : "none"
    }`,
  );
  lines.push("");
  lines.push(`# Manifest summary`);
  lines.push(input.rawManifestSummary || "No manifest summary.");
  lines.push("");
  lines.push(`# Figures`);
  for (const fig of input.figures) {
    lines.push(
      `- ${fig.label || "figure"} | page ${fig.page + 1} | ${fig.section || ""} | ${fig.caption || ""}`,
    );
  }
  lines.push("");
  lines.push(`# Tables`);
  for (const table of input.tables) {
    lines.push(
      `- ${table.label || "table"} | page ${table.page + 1} | ${table.section || ""} | ${table.caption || ""}`,
    );
  }
  lines.push("");
  lines.push(`# Page texts`);
  for (const page of input.pages) {
    lines.push(`\n\n## Page ${page.displayPage}`);
    lines.push(page.text);
  }

  return lines.join("\n");
}