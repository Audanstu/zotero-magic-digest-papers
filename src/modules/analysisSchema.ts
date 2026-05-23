export type MagicDigestCardSide = "left" | "right";

export type MagicDigestCardType =
  | "background"
  | "method"
  | "result"
  | "insight"
  | "figure"
  | "table"
  | "limitation"
  | "quote"
  | "term"
  | "comparison";

export type MagicDigestEditableText = {
  aiOriginal: string;
  userEdited: string;
  edited: boolean;
  editedAt: string | null;
};

export type MagicDigestCard = {
  id: string;
  page: number;
  side: MagicDigestCardSide;
  type: MagicDigestCardType;
  title: string;
  anchorText: string;
  source: "deepseek" | "doubao-vision" | "ocr" | "mineru" | "user";
  importance: number;
  content: MagicDigestEditableText;
  tags: string[];
};

export type MagicDigestPageCards = {
  page: number;
  skipped: boolean;
  left: MagicDigestCard[];
  right: MagicDigestCard[];
};

export type MagicDigestGlobalPanel = {
  titleCard: MagicDigestEditableText;
  backgroundAndProblem: MagicDigestEditableText;
  coreInnovations: MagicDigestEditableText[];
  methodOverview: MagicDigestEditableText[];
  mainFindings: MagicDigestEditableText[];
  limitations: MagicDigestEditableText[];
};

export type MagicDigestFigureAnalysis = {
  id: string;
  page: number;
  type: "figure";
  source: "doubao-vision" | "mineru";
  model: string;
  imagePath: string;
  imageUrl: string;
  caption: string;
  visionInputMode: "base64" | "url" | "upload" | "";
  aiOriginal: {
    figureType: string;
    content: string;
    keyElements: string[];
    paperRole: string;
    sidebarSummary: string;
  };
  userEdited: string;
  edited: boolean;
  editedAt: string | null;
};

export type MagicDigestTableAnalysis = {
  id: string;
  page: number;
  type: "table";
  source: "mineru" | "ocr" | "doubao-vision";
  title: string;
  rawText: string;
  aiOriginal: string;
  userEdited: string;
  edited: boolean;
  editedAt: string | null;
};

export type MagicDigestReadingCardDraft = MagicDigestEditableText;

export type MagicDigestBoardNodeDraft = {
  id: string;
  sourceCardId: string;
  type:
    | "paper"
    | "background"
    | "method"
    | "result"
    | "limitation"
    | "figure"
    | "table"
    | "insight";
  title: string;
  content: string;
  page: number | null;
  selected: boolean;
};

export type MagicDigestAnalysisMeta = {
  schemaVersion: string;
  promptVersion: string;
  textModel: string;
  visionModel: string;
  pdfHash: string;
  createdAt: string;
  updatedAt: string;
};

export type MagicDigestAnalysisOptions = {
  skippedPages: number[];
  skipAppliedToLLMOnly: boolean;
  includeVision: boolean;
  maxVisionImages: number;
};

export type MagicDigestAnalysis = {
  meta: MagicDigestAnalysisMeta;
  analysisOptions: MagicDigestAnalysisOptions;
  globalPanel: MagicDigestGlobalPanel;
  pageCards: MagicDigestPageCards[];
  figures: MagicDigestFigureAnalysis[];
  tables: MagicDigestTableAnalysis[];
  readingCardDraft: MagicDigestReadingCardDraft;
  boardNodesDraft: MagicDigestBoardNodeDraft[];
};

export const MAGIC_DIGEST_ANALYSIS_SCHEMA_VERSION = "1.0";
export const MAGIC_DIGEST_ANALYSIS_PROMPT_VERSION = "1.0";

export function emptyEditableText(): MagicDigestEditableText {
  return {
    aiOriginal: "",
    userEdited: "",
    edited: false,
    editedAt: null,
  };
}

export function createEmptyAnalysis(params: {
  pdfHash: string;
  textModel: string;
  visionModel: string;
  skippedPages?: number[];
  includeVision?: boolean;
  maxVisionImages?: number;
}): MagicDigestAnalysis {
  const now = new Date().toISOString();

  return {
    meta: {
      schemaVersion: MAGIC_DIGEST_ANALYSIS_SCHEMA_VERSION,
      promptVersion: MAGIC_DIGEST_ANALYSIS_PROMPT_VERSION,
      textModel: params.textModel,
      visionModel: params.visionModel,
      pdfHash: params.pdfHash,
      createdAt: now,
      updatedAt: now,
    },
    analysisOptions: {
      skippedPages: params.skippedPages || [],
      skipAppliedToLLMOnly: true,
      includeVision: Boolean(params.includeVision),
      maxVisionImages: Number(params.maxVisionImages || 10),
    },
    globalPanel: {
      titleCard: emptyEditableText(),
      backgroundAndProblem: emptyEditableText(),
      coreInnovations: [],
      methodOverview: [],
      mainFindings: [],
      limitations: [],
    },
    pageCards: [],
    figures: [],
    tables: [],
    readingCardDraft: emptyEditableText(),
    boardNodesDraft: [],
  };
}

export function markEditableTextEdited(
  item: MagicDigestEditableText,
  userEdited: string,
): MagicDigestEditableText {
  return {
    ...item,
    userEdited,
    edited: true,
    editedAt: new Date().toISOString(),
  };
}

export function getEditableDisplayText(item: MagicDigestEditableText): string {
  if (item.edited && item.userEdited.trim()) {
    return item.userEdited;
  }
  return item.aiOriginal || "";
}