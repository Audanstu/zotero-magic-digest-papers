import {
  readAnalysisFile,
  writeAnalysisFile,
} from "./magicDigestAnalysisCache";
import type { MagicDigestAnalysis, MagicDigestCard } from "./analysisSchema";
import { mergeFigureAnalysisIntoAnalysis } from "./figureCardsProvider";
import { mergeBlockFirstCardsIntoAnalysis } from "./blockFirstCardsProvider";

let registered = false;
let toolbarHandler: ((event: any) => void) | null = null;

const CARD_WIDTH = 220;
const CARD_GAP = 18;
const CARD_SIDE_GAP = 14;
const HOVER_DELAY = 500;

// Anchor target position inside the PDF viewer.
// 0.50 means exact vertical center.
// 0.56 leaves some room for Zotero toolbar and the magic_digest header.
const ANCHOR_VIEW_RATIO = 0.56;

type PDFContext = {
  pdfWin: Window;
  viewer: any;
  iframeEl: HTMLElement | null;
  viewerContainer: HTMLElement | null;
};

type OverlayCardItem = {
  card: MagicDigestCard;
  page: number;
  side: "left" | "right";
  index: number;
  el: HTMLElement;
  hoverTimer: number | null;
};

type OverlayState = {
  active: boolean;
  analysis: MagicDigestAnalysis | null;
  attachmentItemID: number | null;
  overlay: HTMLElement | null;
  flashLayer: HTMLElement | null;
  persistentLayer: HTMLElement | null;
  cards: OverlayCardItem[];
  cleanup: Array<() => void>;
};

const stateByDocument = new WeakMap<Document, OverlayState>();
const hoveredConnectorKeyByDocument = new WeakMap<Document, string | null>();


const collapsedCardsByDocument = new WeakMap<Document, Set<string>>();
const globalCollapsedByDocument = new WeakMap<Document, boolean>();
const hideUnresolvedByDocument = new WeakMap<Document, boolean>();
const jumpScrollTimersByDocument = new WeakMap<Document, number[]>();
const jumpVersionByDocument = new WeakMap<Document, number>();
const jumpLockedElByDocument = new WeakMap<Document, Set<HTMLElement>>();
const lastStableJumpKeyByDocument = new WeakMap<Document, string>();
const autoRestoreAttemptedByDocument = new WeakMap<Document, boolean>();

function getCollapsedSet(doc: Document): Set<string> {
  let set = collapsedCardsByDocument.get(doc);
  if (!set) {
    set = new Set<string>();
    collapsedCardsByDocument.set(doc, set);
  }
  return set;
}

function normalizeCardKeyText(str: string): string {
  return String(str || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s\-]/gu, "")
    .trim()
    .slice(0, 160);
}

function getCardStableKey(card: MagicDigestCard): string {
  const anchor = (card as any).anchor || {};
  const anchorBlockId = String((card as any).anchorBlockId || "");
  const elementId = String(anchor.elementId || "");
  const page = String(card.page ?? "");
  const type = String(card.type || "");
  const title = normalizeCardKeyText(card.title || "");
  const anchorText = normalizeCardKeyText(card.anchorText || "");

  if (anchorBlockId) return "block:" + anchorBlockId;
  if (elementId) return "element:" + elementId;
  return ["fallback", page, type, title, anchorText].join("|");
}

function isCardCollapsed(doc: Document, card: MagicDigestCard): boolean {
  const globalCollapsed = globalCollapsedByDocument.get(doc) === true;
  const defaultCollapsed = globalCollapsed || isLowLearningValueCard(card);

  const set = getCollapsedSet(doc);
  const key = getCardStableKey(card);

  // set 中记录的是“用户对默认状态的反转”
  if (set.has(key)) {
    return !defaultCollapsed;
  }

  return defaultCollapsed;
}

function toggleCardCollapsed(doc: Document, card: MagicDigestCard): void {
  const globalCollapsed = globalCollapsedByDocument.get(doc) === true;
  const set = getCollapsedSet(doc);
  const key = getCardStableKey(card);

  if (set.has(key)) set.delete(key);
  else set.add(key);
}

function toggleAllCardsCollapsed(doc: Document): void {
  const current = globalCollapsedByDocument.get(doc) === true;
  globalCollapsedByDocument.set(doc, !current);
  getCollapsedSet(doc).clear();
}

function isDuplicateCard(card: MagicDigestCard, seen: Set<string>): boolean {
  const key = getCardStableKey(card);
  if (seen.has(key)) return true;
  seen.add(key);
  return false;
}


function getPluginID(): string {
  try {
    return (
      (addon?.data?.config as any)?.addonID ||
      (addon?.data?.config as any)?.id ||
      "magic-digest@local.xpi"
    );
  } catch {
    return "magic-digest@local.xpi";
  }
}

function escapeHTML(str: string): string {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ==============================
// 单栏/双栏自动检测 + 侧边自动分配
// + 卡片拖动 + 连线自动跟随
// ==============================

function detectPageColumnLayoutForCards(cards: MagicDigestCard[]): "single" | "double" {
  if (cards.length < 2) return "single";

  const xCenters: number[] = [];
  for (const card of cards) {
    const rect = getAnchorRect(card);
    if (rect) {
      xCenters.push((rect[0] + rect[2]) / 2);
    }
  }

  if (xCenters.length < 2) return "single";

  // 改进检测：按 x 中心排序，找最大空隙
  // 如果最大空隙 > 12% 页宽且位于页面中间区域（25%-75%），判定为双栏
  const sorted = [...xCenters].sort((a, b) => a - b);
  let maxGap = 0;
  let gapPos = 0;

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > maxGap) {
      maxGap = gap;
      gapPos = (sorted[i] + sorted[i - 1]) / 2;
    }
  }

  // 空隙 > 12% 页宽且在 25%-75% 位置 → 双栏
  if (maxGap > 0.12 && gapPos > 0.25 && gapPos < 0.75) {
    return "double";
  }

  // 补充：范围 > 30% 且均值在 40-60% → 双栏
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const range = max - min;
  const mean = xCenters.reduce((a, b) => a + b, 0) / xCenters.length;

  if (range > 0.30 && mean > 0.38 && mean < 0.62) {
    return "double";
  }

  return "single";
}

function assignAutoSide(
  card: MagicDigestCard,
  layout: "single" | "double",
  index: number,
  originalSide?: "left" | "right",
): "left" | "right" {
  if (layout === "double") {
    const rect = getAnchorRect(card);
    if (rect) {
      const xCenter = (rect[0] + rect[2]) / 2;
      return xCenter < 0.5 ? "left" : "right";
    }
    // 双栏无锚点：保留 AI 原始分配
    if (originalSide) return originalSide;
  }

  // 单栏：交替分配让两侧均匀；双栏兜底也交替
  return index % 2 === 0 ? "left" : "right";
}

// ==============================
// Minimal Drag — 卡片最小拖动
// 最终位置 = stable 原始位置 + 用户手动偏移
// ==============================

type MinimalDragOnlyOffset = {
  dx: number;
  dy: number;
  side?: "left" | "right";
};

// ==============================
// 连线样式：直线 vs 折线
// ==============================

function getConnectorStyleStorageKey(reader: any, doc: Document): string {
  return getReaderStateStorageKey(reader, doc, "connectorStyle");
}

function readConnectorStyle(reader: any, doc: Document): "polyline" | "straight" {
  try {
    const win = doc.defaultView as any;
    const raw = win?.localStorage?.getItem(
      getConnectorStyleStorageKey(reader, doc),
    );
    if (raw === "straight") return "straight";
  } catch {
    // ignore
  }
  return "polyline";
}

function writeConnectorStyle(
  reader: any,
  doc: Document,
  style: "polyline" | "straight",
): void {
  try {
    const win = doc.defaultView as any;
    win?.localStorage?.setItem(
      getConnectorStyleStorageKey(reader, doc),
      style,
    );
  } catch {
    // ignore
  }
}

function getMinimalDragStorageKey(reader: any, doc: Document): string {
  return getReaderStateStorageKey(reader, doc, "minimalDragOnlyOffsets");
}

function readMinimalDragOffsets(
  reader: any,
  doc: Document,
): Record<string, MinimalDragOnlyOffset> {
  try {
    const win = doc.defaultView as any;
    const raw = win?.localStorage?.getItem(
      getMinimalDragStorageKey(reader, doc),
    );
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, MinimalDragOnlyOffset>;
    }
  } catch {
    // ignore
  }
  return {};
}

function writeMinimalDragOffsets(
  reader: any,
  doc: Document,
  offsets: Record<string, MinimalDragOnlyOffset>,
): void {
  try {
    const win = doc.defaultView as any;
    win?.localStorage?.setItem(
      getMinimalDragStorageKey(reader, doc),
      JSON.stringify(offsets),
    );
  } catch {
    // ignore
  }
}

function getMinimalDragCardKey(card: MagicDigestCard, index: number): string {
  const stableKey = getCardStableKey(card);
  if (stableKey && !stableKey.startsWith("fallback|")) return stableKey;
  const anchor = getAnchorRect(card);
  const rectStr = anchor ? anchor.slice(0, 4).join(",") : "norect";
  return ["card", card.id, card.page, card.type, card.title, rectStr, index]
    .join("|");
}

function ensureMinimalDragStyles(doc: Document): void {
  if (doc.getElementById("magic-digest-minimal-drag-styles")) return;
  const style = doc.createElement("style");
  style.id = "magic-digest-minimal-drag-styles";
  style.textContent = [
    ".magic-digest-drag-handle{",
    "position:absolute;width:18px;height:100%;top:0;",
    "cursor:grab;display:flex;align-items:center;justify-content:center;",
    "color:#475569;font-size:12px;user-select:none;z-index:3;",
    "background:rgba(148,163,184,.25);",
    "opacity:.7;transition:opacity .15s;}",
    ".magic-digest-drag-handle:hover{opacity:1;color:#0f172a;}",
    ".magic-digest-drag-handle:active{cursor:grabbing;}",
    '.magic-digest-floating-card[data-side="right"] .magic-digest-drag-handle{left:2px;border-radius:0 4px 4px 0;}',
    '.magic-digest-floating-card[data-side="left"] .magic-digest-drag-handle{right:2px;border-radius:4px 0 0 4px;}',
  ].join("");
  if (doc.head) doc.head.appendChild(style);
}

function applyMinimalDragOffsets(reader: any, doc: Document): void {
  const state = getOrCreateState(doc);
  if (!state.active) return;

  const offsets = readMinimalDragOffsets(reader, doc);

  state.cards.forEach((item, index) => {
    const key = getMinimalDragCardKey(item.card, index);
    const offset = offsets[key];
    if (!offset) return;

    const el = item.el;

    // 应用侧边覆盖
    if (offset.side && offset.side !== item.side) {
      item.side = offset.side;
      el.dataset.side = offset.side;
    }

    if (offset.dx === 0 && offset.dy === 0) return;

    const baseLeft = parseFloat(el.style.left) || 0;
    const baseTop = parseFloat(el.style.top) || 0;

    el.dataset.baseLeft = String(Math.round(baseLeft));
    el.dataset.baseTop = String(Math.round(baseTop));

    el.style.left = Math.round(baseLeft + offset.dx) + "px";
    el.style.top = Math.round(baseTop + offset.dy) + "px";
  });
}

function enableMinimalDragForCard(
  reader: any,
  doc: Document,
  item: OverlayCardItem,
  index: number,
): void {
  const el = item.el;
  if (el.dataset.minimalDragEnabled === "true") return;
  el.dataset.minimalDragEnabled = "true";

  ensureMinimalDragStyles(doc);

  const handle = doc.createElement("div");
  handle.className = "magic-digest-drag-handle";
  handle.textContent = "↕";
  handle.title = "拖动卡片 | 双击重置位置";
  el.appendChild(handle);

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let baseLeft = 0;
  let baseTop = 0;
  let oldDx = 0;
  let oldDy = 0;

  const clearSelection = () => {
    try {
      const win = doc.defaultView;
      if (win) win.getSelection()?.removeAllRanges();
    } catch {
      // ignore
    }
  };

  handle.addEventListener("pointerdown", (ev: PointerEvent) => {
    ev.preventDefault();
    ev.stopPropagation();

    dragging = true;
    startX = ev.clientX;
    startY = ev.clientY;

    const key = getMinimalDragCardKey(item.card, index);
    const offsets = readMinimalDragOffsets(reader, doc);
    const saved = offsets[key];
    oldDx = saved?.dx || 0;
    oldDy = saved?.dy || 0;

    baseLeft = parseFloat(el.style.left) - oldDx;
    baseTop = parseFloat(el.style.top) - oldDy;

    el.dataset.baseLeft = String(Math.round(baseLeft));
    el.dataset.baseTop = String(Math.round(baseTop));

    el.style.transition = "none";
    el.style.zIndex = "9999999";
    handle.setPointerCapture(ev.pointerId);
    clearSelection();
  });

  handle.addEventListener("pointermove", (ev: PointerEvent) => {
    if (!dragging) return;
    ev.preventDefault();

    const newDx = oldDx + (ev.clientX - startX);
    const newDy = oldDy + (ev.clientY - startY);

    el.style.left = Math.round(baseLeft + newDx) + "px";
    el.style.top = Math.round(baseTop + newDy) + "px";
  });

  handle.addEventListener("pointerup", (ev: PointerEvent) => {
    if (!dragging) return;
    dragging = false;

    const newDx = oldDx + (ev.clientX - startX);
    const newDy = oldDy + (ev.clientY - startY);

    const key = getMinimalDragCardKey(item.card, index);
    const offsets = readMinimalDragOffsets(reader, doc);

    // 检测是否拖到了另一侧
    const cardRect = el.getBoundingClientRect();
    const viewportWidth = doc.defaultView?.innerWidth || 1200;
    const cardCenterX = cardRect.left + cardRect.width / 2;
    const viewportCenterX = viewportWidth / 2;
    const newSide: "left" | "right" = cardCenterX < viewportCenterX ? "left" : "right";

    const offset: MinimalDragOnlyOffset = {
      dx: Math.round(newDx),
      dy: Math.round(newDy),
    };

    if (newSide !== item.side) {
      offset.side = newSide;
    }

    if (Math.abs(newDx) < 1 && Math.abs(newDy) < 1 && !offset.side) {
      delete offsets[key];
    } else {
      offsets[key] = offset;
    }

    writeMinimalDragOffsets(reader, doc, offsets);

    // 如果侧边变了，立即更新
    if (offset.side) {
      item.side = offset.side;
      el.dataset.side = offset.side;
    }

    el.style.transition =
      "transform .12s ease, box-shadow .12s ease, opacity .12s ease";
    el.style.zIndex = String(999900 + index);
    clearSelection();

    // 重绘连线以反映新侧边
    updateConnectors(reader, doc);
  });

  handle.addEventListener("dblclick", (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();

    const key = getMinimalDragCardKey(item.card, index);
    const offsets = readMinimalDragOffsets(reader, doc);
    delete offsets[key];
    writeMinimalDragOffsets(reader, doc, offsets);

    // 恢复自动检测的侧边（保留 AI 原始分配）
    const overlayState = getOrCreateState(doc);
    const allCards = overlayState.cards.map((c) => c.card);
    const layout = detectPageColumnLayoutForCards(allCards.filter((c) => c.page === item.page));

    // 找回原始 side（从 analysis 数据中）
    const pageCards = overlayState.analysis?.pageCards?.find((pc: any) => pc.page === item.page);
    let origSide: "left" | "right" | undefined;
    if (pageCards) {
      const cardInLeft = (pageCards.left || []).find((c: any) => c.id === item.card.id);
      const cardInRight = (pageCards.right || []).find((c: any) => c.id === item.card.id);
      if (cardInLeft) origSide = "left";
      else if (cardInRight) origSide = "right";
    }

    const autoSide = assignAutoSide(item.card, layout, index, origSide);
    item.side = autoSide;
    el.dataset.side = autoSide;

    const bl = parseFloat(el.dataset.baseLeft || "0");
    const bt = parseFloat(el.dataset.baseTop || "0");
    if (bl || bt) {
      el.style.left = Math.round(bl) + "px";
      el.style.top = Math.round(bt) + "px";
    } else {
      positionCards(reader, doc);
    }

    updateConnectors(reader, doc);
  });
  applyMinimalDragOffsets(reader, doc);

}

function cardTypeColor(type: string): string {
  const map: Record<string, string> = {
    background: "#4a90d9",
    method: "#7b61ff",
    result: "#f5a623",
    insight: "#27ae60",
    figure: "#e74c3c",
    table: "#8e44ad",
    limitation: "#e67e22",
    quote: "#2c3e50",
    term: "#1abc9c",
    comparison: "#34495e",
  };
  return map[type] || "#95a5a6";
}

function getReaderAttachmentItemID(reader: any): number | null {
  const candidates = [
    reader?._item?.id,
    reader?.item?.id,
    reader?._itemID,
    reader?.itemID,
    reader?.attachmentItemID,
    reader?._attachmentItemID,
  ];

  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) {
      return Math.floor(n);
    }
  }

  return null;
}


function getReaderStateStorageKey(
  reader: any,
  doc: Document,
  name: string,
): string {
  const attachmentItemID = getReaderAttachmentItemID(reader);
  const id = attachmentItemID != null ? String(attachmentItemID) : "unknown";
  return "magic_digest.reader." + id + "." + name;
}

function readReaderBooleanPreference(
  reader: any,
  doc: Document,
  name: string,
): boolean | null {
  try {
    const win = doc.defaultView;
    const key = getReaderStateStorageKey(reader, doc, name);
    const value = win?.localStorage?.getItem(key);

    if (value === "true") return true;
    if (value === "false") return false;

    return null;
  } catch {
    return null;
  }
}

function writeReaderBooleanPreference(
  reader: any,
  doc: Document,
  name: string,
  value: boolean,
): void {
  try {
    const win = doc.defaultView;
    const key = getReaderStateStorageKey(reader, doc, name);
    win?.localStorage?.setItem(key, value ? "true" : "false");
  } catch {
    // ignore
  }
}


function getCollapsedStateStorageKey(reader: any, doc: Document): string {
  const attachmentItemID = getReaderAttachmentItemID(reader);
  const id = attachmentItemID != null ? String(attachmentItemID) : "unknown";
  return "magic_digest.reader." + id + ".collapsedState";
}

function writeCollapsedStatePreference(reader: any, doc: Document): void {
  try {
    const win = doc.defaultView;
    const key = getCollapsedStateStorageKey(reader, doc);

    const data = {
      globalCollapsed: globalCollapsedByDocument.get(doc) === true,
      toggledCards: Array.from(getCollapsedSet(doc)),
    };

    win?.localStorage?.setItem(key, JSON.stringify(data));
  } catch {
    // ignore
  }
}

function readCollapsedStatePreference(reader: any, doc: Document): void {
  try {
    const win = doc.defaultView;
    const key = getCollapsedStateStorageKey(reader, doc);
    const raw = win?.localStorage?.getItem(key);

    if (!raw) return;

    const data = JSON.parse(raw);

    globalCollapsedByDocument.set(doc, data?.globalCollapsed === true);

    const set = getCollapsedSet(doc);
    set.clear();

    if (Array.isArray(data?.toggledCards)) {
      for (const item of data.toggledCards) {
        if (typeof item === "string" && item) {
          set.add(item);
        }
      }
    }
  } catch {
    // ignore
  }
}

function getOrCreateState(doc: Document): OverlayState {
  let state = stateByDocument.get(doc);
  if (state) return state;

  state = {
    active: false,
    analysis: null,
    attachmentItemID: null,
    overlay: null,
    flashLayer: null,
    persistentLayer: null,
    cards: [],
    cleanup: [],
  };

  stateByDocument.set(doc, state);
  return state;
}

function getCardText(card: MagicDigestCard): string {
  return card.content.edited
    ? card.content.userEdited || ""
    : card.content.aiOriginal || "";
}

function isUnresolvedCard(card: MagicDigestCard): boolean {
  const anchor = (card as any).anchor;
  return (
    anchor?.noAutoMatch === true ||
    anchor?.method === "unresolved" ||
    !getAnchorRect(card)
  );
}

function shouldHideCardInCurrentOverlay(doc: Document, card: MagicDigestCard): boolean {
  if (hideUnresolvedByDocument.get(doc) !== true) {
    return false;
  }

  return isUnresolvedCard(card);
}


function getAnchorRect(card: MagicDigestCard): number[] | null {
  const anchor = (card as any).anchor;
  if (!anchor || anchor.noAutoMatch === true || anchor.method === "unresolved") {
    return null;
  }

  const rects = Array.isArray(anchor.rects) ? anchor.rects : [];
  if (!rects.length || !Array.isArray(rects[0]) || rects[0].length < 4) {
    return null;
  }

  const nums = rects[0].slice(0, 4).map((x: unknown) => Number(x));
  if (!nums.every((x: number) => Number.isFinite(x))) {
    return null;
  }

  let [x1, y1, x2, y2] = nums;
  x1 = clamp(x1, 0, 1);
  y1 = clamp(y1, 0, 1);
  x2 = clamp(x2, 0, 1);
  y2 = clamp(y2, 0, 1);

  if (x2 <= x1 || y2 <= y1) return null;

  return [x1, y1, x2, y2];
}

function getCardAnchorY(card: MagicDigestCard, fallbackIndex: number): number {
  const rect = getAnchorRect(card);
  if (rect) {
    return clamp((rect[1] + rect[3]) / 2, 0.05, 0.92);
  }

  return clamp(0.12 + fallbackIndex * 0.16, 0.08, 0.86);
}


function cardSearchText(card: MagicDigestCard): string {
  const anchor = (card as any).anchor || {};
  const parts = [
    card.type,
    card.title,
    card.anchorText,
    getCardText(card),
    anchor.quote,
    Array.isArray(card.tags) ? card.tags.join(" ") : "",
  ];

  return parts
    .map((x) => String(x || ""))
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isLowLearningValueCard(card: MagicDigestCard): boolean {
  const s = cardSearchText(card);

  if (!s) return false;

  const patterns = [
    // English metadata
    /\bauthor contributions?\b/,
    /\bauthor information\b/,
    /\bauthor list\b/,
    /\bcorresponding author\b/,
    /\bcorrespondence\b/,
    /\baffiliation\b/,
    /\bdepartment of\b/,
    /\bschool of\b/,
    /\bfaculty of\b/,
    /\buniversity\b/,
    /\binstitute of\b/,
    /\bcollege of\b/,
    /\bemail\b/,
    /@/,
    /\bfunding\b/,
    /\bfund\b/,
    /\bgrant\b/,
    /\bsupported by\b/,
    /\bnational natural science foundation\b/,
    /\bconflict[- ]of[- ]interest\b/,
    /\bconflicts? of interest\b/,
    /\bcompeting interests?\b/,
    /\bethics statement\b/,
    /\bdata availability\b/,
    /\borcid\b/,
    /\bdoi\b/,
    /\bissn\b/,
    /\bcitation\b/,
    /\breceived\b/,
    /\baccepted\b/,
    /\bpublished\b/,
    /\bpublisher\b/,
    /\bcopyright\b/,
    /\blicen[cs]e\b/,
    /\bopen[- ]access\b/,
    /\bjournal\b/,
    /\bvolume\b/,
    /\bissue\b/,
    /\bsubmit a manuscript\b/,

    // Chinese metadata
    /作者贡献/,
    /作者信息/,
    /作者列表/,
    /作者机构/,
    /通讯作者/,
    /通信作者/,
    /联系方式/,
    /联系邮箱/,
    /电子邮件/,
    /基金/,
    /资助/,
    /国家自然科学基金/,
    /利益冲突/,
    /伦理声明/,
    /数据可用性/,
    /期刊/,
    /卷/,
    /期/,
    /出版/,
    /版权/,
    /许可/,
    /开放获取/,
    /引用信息/,
    /收稿/,
    /录用/,
  ];

  return patterns.some((re) => re.test(s));
}

function setCardEdited(
  card: MagicDigestCard,
  params: {
    title: string;
    content: string;
    tags: string[];
  },
) {
  card.title = params.title;
  card.content.userEdited = params.content;
  card.content.edited = true;
  card.content.editedAt = new Date().toISOString();
  card.tags = params.tags;
}

function renderFloatingCardHTML(card: MagicDigestCard, doc?: Document): string {
  const color = cardTypeColor(card.type);
  const text = getCardText(card);
  const anchor = (card as any).anchor;
  const method = String(anchor?.method || "");
  const unresolved = isUnresolvedCard(card);
  const collapsed = doc ? isCardCollapsed(doc, card) : false;

  const tags = Array.isArray(card.tags)
    ? card.tags
        .slice(0, collapsed ? 3 : 5)
        .map(
          (t) =>
            `<span style="display:inline-block;background:#233554;color:#64ffda;font-size:10px;padding:1px 5px;border-radius:4px;margin-right:3px;margin-top:4px;">${escapeHTML(
              t,
            )}</span>`,
        )
        .join("")
    : "";

  const edited = card.content.edited
    ? `<span style="display:inline-block;margin-left:4px;background:#ef4444;color:#fff;font-size:9px;padding:1px 4px;border-radius:999px;">已编辑</span>`
    : "";

  const status = unresolved
    ? `<span style="display:inline-block;margin-left:4px;background:#64748b;color:#fff;font-size:9px;padding:1px 4px;border-radius:999px;">未定位</span>`
    : method.includes("layout")
      ? `<span style="display:inline-block;margin-left:4px;background:#16a34a;color:#fff;font-size:9px;padding:1px 4px;border-radius:999px;">Layout</span>`
      : method.includes("mineru")
        ? `<span style="display:inline-block;margin-left:4px;background:#2563eb;color:#fff;font-size:9px;padding:1px 4px;border-radius:999px;">MinerU</span>`
        : "";

  return `
    <button class="magic-digest-edit-card-btn"
      title="编辑卡片"
      style="position:absolute;right:5px;top:5px;background:rgba(15,23,42,.75);color:#fff;border:0;border-radius:4px;font-size:10px;padding:1px 5px;cursor:pointer;">
      编辑
    </button>

    <button class="magic-digest-collapse-card-btn"
      title="${collapsed ? "展开卡片" : "折叠卡片"}"
      style="position:absolute;right:43px;top:5px;background:rgba(15,23,42,.65);color:#fff;border:0;border-radius:4px;font-size:10px;padding:1px 5px;cursor:pointer;">
      ${collapsed ? "展开" : "折叠"}
    </button>

    <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;padding-right:118px;">
      <span style="display:inline-block;background:${color};color:white;font-size:10px;padding:1px 6px;border-radius:999px;font-weight:700;">
        ${escapeHTML(card.type)}
      </span>
      ${edited}
      ${status}
    </div>

    <div style="font-size:12px;font-weight:800;color:#0f172a;line-height:1.35;margin-bottom:${collapsed ? "2px" : "5px"};">
      ${escapeHTML(card.title || "")}
    </div>

    <div class="magic-digest-card-extra" style="${collapsed ? "display:none;" : ""}">
      ${
        card.anchorText
          ? `<div style="font-size:10px;color:#475569;font-style:italic;line-height:1.35;margin-bottom:5px;max-height:30px;overflow:hidden;">
              ${escapeHTML(card.anchorText || "")}
            </div>`
          : ""
      }

      <div style="font-size:11px;line-height:1.45;color:#1e293b;max-height:86px;overflow:hidden;">
        ${escapeHTML(text || "")}
      </div>
    </div>

    <div style="margin-top:4px;">${tags}</div>
  `;
}

function createLayer(
  doc: Document,
  id: string,
  zIndex: number,
): HTMLElement {
  let layer = doc.getElementById(id) as HTMLElement | null;
  if (layer) return layer;

  layer = doc.createElement("div");
  layer.id = id;
  layer.setAttribute(
    "style",
    [
      "position:fixed",
      "left:0",
      "top:0",
      "right:0",
      "bottom:0",
      `z-index:${zIndex}`,
      "pointer-events:none",
      "overflow:visible",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    ].join(";"),
  );
const root = doc.documentElement || doc.body;
  if (!root) throw new Error("Reader document root not found");
  root.appendChild(layer);

  return layer;
}

function getPDFContext(reader: any, doc: Document): PDFContext | null {
  const candidates: Array<{ win: Window | null; iframe: HTMLElement | null }> =
    [];

  try {
    const iframeWin =
      reader?._internalReader?._primaryView?._iframeWindow ||
      reader?._internalReader?._iframeWindow ||
      null;

    candidates.push({
      win: iframeWin,
      iframe:
        (reader?._internalReader?._primaryView?._iframe as HTMLElement | null) ||
        null,
    });
  } catch {
    // ignore
  }

  const docWin = doc.defaultView;
  if (docWin) {
    candidates.push({
      win: docWin,
      iframe: null,
    });
  }

  try {
    const iframes = Array.from(
      doc.querySelectorAll("iframe"),
    ) as HTMLIFrameElement[];
    for (const iframe of iframes) {
      if (iframe.contentWindow) {
        candidates.push({
          win: iframe.contentWindow,
          iframe,
        });
      }
    }
  } catch {
    // ignore
  }

  for (const item of candidates) {
    const win = item.win as any;
    if (!win) continue;

    const viewer =
      win.PDFViewerApplication?.pdfViewer ||
      win.PDFViewerApplication?.pdfViewer?.pdfViewer ||
      null;

    if (viewer) {
      const viewerContainer =
        (win.document?.getElementById("viewerContainer") as HTMLElement | null) ||
        (viewer.container as HTMLElement | null) ||
        null;

      return {
        pdfWin: item.win as Window,
        viewer,
        iframeEl: item.iframe,
        viewerContainer,
      };
    }
  }

  return null;
}

function getPageDiv(ctx: PDFContext, pageIndex: number): HTMLElement | null {
  try {
    const pageView = ctx.viewer?._pages?.[pageIndex];
    const div = pageView?.div as HTMLElement | undefined;
    if (div) return div;
  } catch {
    // ignore
  }

  try {
    const pageNumber = pageIndex + 1;
    return ctx.pdfWin.document.querySelector(
      `.page[data-page-number="${pageNumber}"]`,
    ) as HTMLElement | null;
  } catch {
    return null;
  }
}

function getRectOffset(ctx: PDFContext): { x: number; y: number } {
  if (!ctx.iframeEl) {
    return { x: 0, y: 0 };
  }

  const iframeRect = ctx.iframeEl.getBoundingClientRect();
  return {
    x: iframeRect.left,
    y: iframeRect.top,
  };
}


function ensureConnectorLayer(doc: Document): SVGSVGElement {
  const existing = doc.getElementById(
    "magic-digest-connector-layer",
  ) as SVGSVGElement | null;

  if (existing) return existing;

  const svg = doc.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  ) as unknown as SVGSVGElement;

  svg.id = "magic-digest-connector-layer";

  svg.setAttribute(
    "style",
    [
      "position:fixed",
      "left:0",
      "top:0",
      "right:0",
      "bottom:0",
      "width:100vw",
      "height:100vh",
      "z-index:999890",
      "pointer-events:none",
      "overflow:visible",
    ].join(";"),
  );

  const root = doc.documentElement || doc.body;
  if (!root) throw new Error("Reader document root not found");

  root.appendChild(svg);

  return svg;
}

function ensureAnchorMarkerLayer(doc: Document): HTMLElement {
  let layer = doc.getElementById(
    "magic-digest-anchor-marker-layer",
  ) as HTMLElement | null;

  if (layer) return layer;

  layer = doc.createElement("div");
  layer.id = "magic-digest-anchor-marker-layer";

  layer.setAttribute(
    "style",
    [
      "position:fixed",
      "left:0",
      "top:0",
      "right:0",
      "bottom:0",
      "z-index:999891",
      "pointer-events:none",
      "overflow:visible",
    ].join(";"),
  );

  const root = doc.documentElement || doc.body;
  if (!root) throw new Error("Reader document root not found");
  root.appendChild(layer);

  return layer;
}

function clearConnectors(doc: Document): void {
  const svg = doc.getElementById("magic-digest-connector-layer");
  if (svg) svg.innerHTML = "";

  const markerLayer = doc.getElementById("magic-digest-anchor-marker-layer");
  if (markerLayer) markerLayer.innerHTML = "";
}

function pulseCardElement(el: HTMLElement): void {
  const oldTransform = el.style.transform;
  const oldBoxShadow = el.style.boxShadow;
  const oldZIndex = el.style.zIndex;

  el.style.transform = "scale(1.035)";
  el.style.boxShadow = "0 0 0 3px rgba(59,130,246,.35), 0 10px 24px rgba(15,23,42,.38)";
  el.style.zIndex = "1000001";

  setTimeout(() => {
    el.style.transform = oldTransform;
    el.style.boxShadow = oldBoxShadow;
    el.style.zIndex = oldZIndex;
  }, 900);
}


function setConnectorHoverState(
  doc: Document,
  cardKey: string,
  active: boolean,
): void {
  const lines = Array.from(
    doc.querySelectorAll("#magic-digest-connector-layer polyline"),
  ) as SVGElement[];

  for (const line of lines) {
    const key = line.getAttribute("data-magic-digest-card-key") || "";
    if (key !== cardKey) continue;

    const originalStroke =
      line.getAttribute("data-magic-digest-original-stroke") ||
      line.getAttribute("stroke") ||
      "#64748b";

    if (active) {
      line.setAttribute("stroke", "#a855f7");
      line.setAttribute("stroke-width", "3.2");
      line.setAttribute("stroke-opacity", "0.98");
      line.setAttribute("stroke-dasharray", "0");
      line.setAttribute("filter", "drop-shadow(0 0 4px rgba(168,85,247,.65))");
    } else {
      line.setAttribute("stroke", originalStroke);
      line.setAttribute("stroke-width", "1.5");
      line.setAttribute("stroke-opacity", "0.62");
      line.setAttribute("stroke-dasharray", "4 3");
      line.removeAttribute("filter");
    }
  }

  const markers = Array.from(
    doc.querySelectorAll(".magic-digest-anchor-marker"),
  ) as HTMLElement[];

  for (const marker of markers) {
    const key = marker.getAttribute("data-magic-digest-card-key") || "";
    if (key !== cardKey) continue;

    const originalBackground =
      marker.getAttribute("data-magic-digest-original-background") ||
      marker.style.background ||
      "#64748b";

    if (active) {
      marker.style.background = "#a855f7";
      marker.style.opacity = "1";
      marker.style.boxShadow =
        "0 0 0 4px rgba(168,85,247,.30), 0 0 16px rgba(168,85,247,.75)";
      marker.style.transform = "scale(1.25)";
    } else {
      marker.style.background = originalBackground;
      marker.style.opacity = ".82";
      marker.style.boxShadow = "0 0 0 3px rgba(255,255,255,.55)";
      marker.style.transform = "";
    }
  }
}

function updateConnectors(reader: any, doc: Document): void {
  const state = getOrCreateState(doc);
  if (!state.active) return;

  const ctx = getPDFContext(reader, doc);
  if (!ctx) return;

  const svg = ensureConnectorLayer(doc);
  const markerLayer = ensureAnchorMarkerLayer(doc);

  svg.innerHTML = "";
  markerLayer.innerHTML = "";

  const offset = getRectOffset(ctx);

  for (const item of state.cards) {
    const rect = getAnchorRect(item.card);
    if (!rect) continue;

    if (item.el.style.display === "none") continue;

    const pageDiv = getPageDiv(ctx, item.page);
    if (!pageDiv) continue;

    const pageRectRaw = pageDiv.getBoundingClientRect();

    const pageRect = {
      left: pageRectRaw.left + offset.x,
      top: pageRectRaw.top + offset.y,
      right: pageRectRaw.right + offset.x,
      bottom: pageRectRaw.bottom + offset.y,
      width: pageRectRaw.width,
      height: pageRectRaw.height,
    };

    const [x1, y1, x2, y2] = rect;

    const anchorX =
      item.side === "left"
        ? pageRect.left + x1 * pageRect.width
        : pageRect.left + x2 * pageRect.width;

    const anchorY = pageRect.top + ((y1 + y2) / 2) * pageRect.height;

    const cardRect = item.el.getBoundingClientRect();

    const cardX =
      item.side === "left"
        ? cardRect.right
        : cardRect.left;

    const cardY = cardRect.top + Math.min(34, Math.max(18, cardRect.height / 2));

    const midX =
      item.side === "left"
        ? Math.min(cardX + 24, anchorX - 12)
        : Math.max(cardX - 24, anchorX + 12);

    const hoveredKey = hoveredConnectorKeyByDocument.get(doc) || null;
    const isHoveredConnector = hoveredKey === getCardStableKey(item.card);
    const color = isHoveredConnector ? "#a855f7" : cardTypeColor(item.card.type);

    const connectorStyle = readConnectorStyle(reader, doc);

    const points =
      connectorStyle === "straight"
        ? [
            [cardX, cardY],
            [anchorX, anchorY],
          ]
            .map((p) => p.map((x) => Math.round(x)).join(","))
            .join(" ")
        : [
            [cardX, cardY],
            [midX, cardY],
            [midX, anchorY],
            [anchorX, anchorY],
          ]
            .map((p) => p.map((x) => Math.round(x)).join(","))
            .join(" ");

    const polyline = doc.createElementNS(
      "http://www.w3.org/2000/svg",
      "polyline",
    );

    polyline.setAttribute("points", points);
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", color);
    polyline.setAttribute("stroke-width", isHoveredConnector ? "3" : "1.5");
    polyline.setAttribute("stroke-opacity", isHoveredConnector ? "0.96" : "0.62");
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    polyline.setAttribute("stroke-dasharray", "4 3");

    polyline.setAttribute("data-magic-digest-card-key", getCardStableKey(item.card));
    polyline.setAttribute("data-magic-digest-original-stroke", color);

    svg.appendChild(polyline);

    // 原文定位点：点击原文旁边的小点，定位到对应卡片
    const marker = doc.createElement("button");
    marker.className = "magic-digest-anchor-marker";
    marker.title = "定位到对应 magic_digest 卡片";

    const markerLeft =
      item.side === "left"
        ? anchorX - 12
        : anchorX + 4;

    marker.setAttribute(
      "style",
      [
        "position:fixed",
        "width:10px",
        "height:10px",
        "padding:0",
        "border-radius:999px",
        "border:1px solid rgba(15,23,42,.45)",
        "background:" + color,
        isHoveredConnector
          ? "box-shadow:0 0 0 4px rgba(168,85,247,.30), 0 0 14px rgba(168,85,247,.65)"
          : "box-shadow:0 0 0 3px rgba(255,255,255,.55)",
        "cursor:pointer",
        "pointer-events:auto",
        "opacity:.82",
        "z-index:999999",
        "left:" + Math.round(markerLeft) + "px",
        "top:" + Math.round(anchorY - 5) + "px",
      ].join(";"),
    );

    marker.addEventListener("mouseenter", () => {
      marker.style.opacity = "1";
      pulseCardElement(item.el);
    });

    marker.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      pulseCardElement(item.el);

      try {
        item.el.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "smooth",
        });
      } catch {
        // fixed 元素通常不需要 scrollIntoView
      }
    });

    marker.setAttribute("data-magic-digest-card-key", getCardStableKey(item.card));
    marker.setAttribute("data-magic-digest-original-background", color);

    markerLayer.appendChild(marker);
  }
}

function positionCards(reader: any, doc: Document) {
  const state = getOrCreateState(doc);
  if (!state.active || !state.overlay) return;

  const ctx = getPDFContext(reader, doc);
  if (!ctx) return;

  const offset = getRectOffset(ctx);
  const viewportWidth = doc.defaultView?.innerWidth || 1200;
  const viewportHeight = doc.defaultView?.innerHeight || 800;

  type PositionedCard = {
    item: OverlayCardItem;
    desiredTop: number;
    left: number;
    pageTop: number;
    pageBottom: number;
    height: number;
    finalTop: number;
  };

  const positioned: PositionedCard[] = [];
  const pageSideCounters = new Map<string, number>();

  for (const item of state.cards) {
    // 点击跳转期间锁定卡片位置，不随 PDF 滚动
    const lockedSet = jumpLockedElByDocument.get(doc);
    if (lockedSet?.has(item.el)) {
      continue;
    }

    const pageDiv = getPageDiv(ctx, item.page);
    if (!pageDiv) {
      item.el.style.display = "none";
      continue;
    }

    const pageRectRaw = pageDiv.getBoundingClientRect();

    const pageRect = {
      left: pageRectRaw.left + offset.x,
      top: pageRectRaw.top + offset.y,
      right: pageRectRaw.right + offset.x,
      bottom: pageRectRaw.bottom + offset.y,
      width: pageRectRaw.width,
      height: pageRectRaw.height,
    };

    if (pageRect.bottom < 45 || pageRect.top > viewportHeight + 260) {
      item.el.style.display = "none";
      continue;
    }

    item.el.style.display = "block";
    item.el.style.visibility = "hidden";

    const counterKey = item.page + "-" + item.side;
    const sideIndex = pageSideCounters.get(counterKey) || 0;
    pageSideCounters.set(counterKey, sideIndex + 1);

    const anchorY = getCardAnchorY(item.card, sideIndex);

    let desiredTop = pageRect.top + anchorY * pageRect.height;

    // 未定位卡片没有精确 anchor，按页内顺序粗略展开，后面再统一防重叠
    if (isUnresolvedCard(item.card)) {
      desiredTop = pageRect.top + (0.10 + sideIndex * 0.13) * pageRect.height;
    }

    let left: number;

    if (item.side === "left") {
      left = pageRect.left - CARD_WIDTH - CARD_SIDE_GAP;
      left = clamp(left, 8, Math.max(8, pageRect.left - 20));
    } else {
      left = pageRect.right + CARD_SIDE_GAP;
      left = clamp(left, pageRect.right + 4, viewportWidth - CARD_WIDTH - 8);
    }

    // 先放到大致位置，便于浏览器计算真实高度
    item.el.style.left = Math.round(left) + "px";
    item.el.style.top = Math.round(clamp(desiredTop, 52, viewportHeight - 80)) + "px";

    const measuredHeight =
      item.el.offsetHeight ||
      item.el.scrollHeight ||
      120;

    positioned.push({
      item,
      desiredTop,
      left,
      pageTop: pageRect.top,
      pageBottom: pageRect.bottom,
      height: Math.max(70, Math.min(260, measuredHeight)),
      finalTop: desiredTop,
    });
  }

  // 分左右两侧做防重叠。不同侧互不影响。
  const groups = new Map<string, PositionedCard[]>();

  for (const row of positioned) {
    const key = row.item.side;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const viewportTop = 52;
  const viewportBottom = viewportHeight - 12;
  const minGap = Math.max(8, CARD_GAP);

  for (const rows of groups.values()) {
    rows.sort((a, b) => a.desiredTop - b.desiredTop);

    // 第一遍：从上往下推开，确保不重叠
    let prevBottom = viewportTop - minGap;

    for (const row of rows) {
      let top = row.desiredTop;

      top = Math.max(top, prevBottom + minGap);
      top = Math.max(top, viewportTop);

      row.finalTop = top;
      prevBottom = top + row.height;
    }

    // 如果整体超出视口底部，整体上移一点
    const last = rows[rows.length - 1];
    if (last) {
      const overflow = last.finalTop + last.height - viewportBottom;

      if (overflow > 0) {
        for (const row of rows) {
          row.finalTop -= overflow;
        }

        // 第二遍：上移后再次保证不重叠，且不超过顶部
        prevBottom = viewportTop - minGap;

        for (const row of rows) {
          let top = row.finalTop;

          top = Math.max(top, prevBottom + minGap);
          top = Math.max(top, viewportTop);

          row.finalTop = top;
          prevBottom = top + row.height;
        }
      }
    }

    // 应用最终位置
    rows.forEach((row, index) => {
      row.item.el.style.left = Math.round(row.left) + "px";
      row.item.el.style.top = Math.round(row.finalTop) + "px";
      row.item.el.style.visibility = "visible";
      row.item.el.style.zIndex = String(999900 + index);
    });
  }

  updateConnectors(reader, doc);
}

function drawHighlight(params: {
  doc: Document;
  layer: HTMLElement;
  reader: any;
  card: MagicDigestCard;
  pageIndex: number;
  persistent: boolean;
}) {
  const { doc, layer, reader, card, pageIndex, persistent } = params;

  const rect = getAnchorRect(card);
  if (!rect) {
    return;
  }

  const ctx = getPDFContext(reader, doc);
  if (!ctx) return;

  const pageDiv = getPageDiv(ctx, pageIndex);
  if (!pageDiv) return;

  const offset = getRectOffset(ctx);
  const pageRectRaw = pageDiv.getBoundingClientRect();
  const pageRect = {
    left: pageRectRaw.left + offset.x,
    top: pageRectRaw.top + offset.y,
    width: pageRectRaw.width,
    height: pageRectRaw.height,
  };

  const [x1, y1, x2, y2] = rect;

  const flash = doc.createElement("div");
  flash.className = persistent
    ? "magic-digest-persistent-highlight"
    : "magic-digest-flash-highlight";

  const color =
    String((card as any).anchor?.kind || "").includes("figure") ||
    String((card as any).anchor?.kind || "").includes("table")
      ? "#fb923c"
      : "#facc15";

  flash.setAttribute(
    "style",
    [
      "position:fixed",
      `left:${Math.round(pageRect.left + x1 * pageRect.width)}px`,
      `top:${Math.round(pageRect.top + y1 * pageRect.height)}px`,
      `width:${Math.max(20, Math.round((x2 - x1) * pageRect.width))}px`,
      `height:${Math.max(14, Math.round((y2 - y1) * pageRect.height))}px`,
      `border:2px solid ${color}`,
      "background:rgba(250,204,21,.20)",
      "box-shadow:0 0 0 4px rgba(250,204,21,.14)",
      "border-radius:4px",
      "z-index:999999",
      "pointer-events:none",
      "transition:opacity .3s ease",
    ].join(";"),
  );

  layer.appendChild(flash);

  if (!persistent) {
    setTimeout(() => {
      flash.style.opacity = "0";
    }, 1400);

    setTimeout(() => {
      try {
        flash.remove();
      } catch {
        // ignore
      }
    }, 1900);
  }
}

function clearPersistentHighlight(doc: Document) {
  const state = getOrCreateState(doc);
  if (!state.persistentLayer) return;
  state.persistentLayer.innerHTML = "";
}

function showPersistentHighlight(
  reader: any,
  doc: Document,
  card: MagicDigestCard,
) {
  if (isUnresolvedCard(card)) return;

  const state = getOrCreateState(doc);
  if (!state.persistentLayer) return;

  state.persistentLayer.innerHTML = "";

  const pageIndex = Math.max(0, Math.floor(Number(card.page || 0)));

  drawHighlight({
    doc,
    layer: state.persistentLayer,
    reader,
    card,
    pageIndex,
    persistent: true,
  });
}

function flashAnchor(
  reader: any,
  doc: Document,
  card: MagicDigestCard,
  pageIndex: number,
) {
  if (isUnresolvedCard(card)) return;

  const state = getOrCreateState(doc);
  if (!state.flashLayer) return;

  drawHighlight({
    doc,
    layer: state.flashLayer,
    reader,
    card,
    pageIndex,
    persistent: false,
  });
}



function clearJumpScrollTimers(doc: Document): void {
  const timers = jumpScrollTimersByDocument.get(doc) || [];

  for (const timer of timers) {
    try {
      clearTimeout(timer);
    } catch {
      // ignore
    }
  }

  jumpScrollTimersByDocument.set(doc, []);
}

function addJumpScrollTimer(doc: Document, timer: number): void {
  const timers = jumpScrollTimersByDocument.get(doc) || [];
  timers.push(timer);
  jumpScrollTimersByDocument.set(doc, timers);
}

function offsetTopRelativeToContainer(
  el: HTMLElement,
  container: HTMLElement,
): number {
  const elRect = el.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  return container.scrollTop + (elRect.top - containerRect.top);
}

function findPDFPageElementForIndex(doc: Document, pageIndex: number): HTMLElement | null {
  const pageNumber = pageIndex + 1;

  const isRealPDFPage = (el: Element | null): el is HTMLElement => {
    if (!el) return false;

    const h = el as HTMLElement;
    const cls = String(h.className || "");
    const id = String(h.id || "");

    // Never treat sidebar thumbnails as document pages.
    if (
      h.closest(".thumbnail") ||
      /\bthumbnail\b/i.test(cls) ||
      /thumbnail/i.test(id)
    ) {
      return false;
    }

    // PDF.js real pages are normally div.page or pageContainerN.
    if (h.classList.contains("page")) {
      return true;
    }

    if (/^pageContainer\d+$/i.test(id)) {
      return true;
    }

    // Fallback: real PDF pages usually contain canvas/textLayer/annotationLayer.
    if (
      h.querySelector("canvas") ||
      h.querySelector(".textLayer") ||
      h.querySelector(".annotationLayer")
    ) {
      return true;
    }

    return false;
  };

  const strictSelectors = [
    `#viewer .page[data-page-number="${pageNumber}"]`,
    `.pdfViewer .page[data-page-number="${pageNumber}"]`,
    `.page[data-page-number="${pageNumber}"]`,
    `#viewer .page[data-page-index="${pageIndex}"]`,
    `.pdfViewer .page[data-page-index="${pageIndex}"]`,
    `.page[data-page-index="${pageIndex}"]`,
    `#pageContainer${pageNumber}`,
  ];

  for (const selector of strictSelectors) {
    const el = doc.querySelector(selector);
    if (isRealPDFPage(el)) {
      return el;
    }
  }

  const pages = Array.from(
    doc.querySelectorAll(".pdfViewer .page, #viewer .page, .page"),
  ) as Element[];

  for (const page of pages) {
    if (!isRealPDFPage(page)) continue;

    const rawPageNumber = page.getAttribute("data-page-number");
    const rawPageIndex = page.getAttribute("data-page-index");

    if (
      rawPageNumber &&
      Math.floor(Number(rawPageNumber)) === pageNumber
    ) {
      return page as HTMLElement;
    }

    if (
      rawPageIndex &&
      Math.floor(Number(rawPageIndex)) === pageIndex
    ) {
      return page as HTMLElement;
    }

    const id = String((page as HTMLElement).id || "");
    if (id === `pageContainer${pageNumber}`) {
      return page as HTMLElement;
    }
  }

  // Last fallback through PDF.js page views if available.
  try {
    const ctx = getPDFContext(null, doc);
    const pageView = ctx?.viewer?._pages?.[pageIndex];
    const div = pageView?.div as HTMLElement | undefined;

    if (isRealPDFPage(div || null)) {
      return div || null;
    }
  } catch {
    // ignore
  }

  return null;
}


function getScrollParentOfElement(el: HTMLElement, doc: Document): HTMLElement | null {
  const win = doc.defaultView;
  let node = el.parentElement;

  while (node && node !== doc.body && node !== doc.documentElement) {
    try {
      const style = win?.getComputedStyle(node);
      const overflowY = style?.overflowY || "";
      const canScroll =
        node.scrollHeight > node.clientHeight + 8 &&
        /(auto|scroll|overlay)/i.test(overflowY);

      if (canScroll) {
        return node as HTMLElement;
      }
    } catch {
      // ignore
    }

    node = node.parentElement;
  }

  return null;
}

function getPDFScrollContainer(
  reader: any,
  doc: Document,
  pageEl: HTMLElement,
): HTMLElement | null {
  const ctx = getPDFContext(reader, doc);

  const candidates: Array<HTMLElement | null> = [
    getScrollParentOfElement(pageEl, doc),
    (ctx?.viewerContainer as HTMLElement | null) || null,
    doc.querySelector("#viewerContainer") as HTMLElement | null,
    doc.querySelector(".pdfViewer")?.parentElement as HTMLElement | null,
    doc.scrollingElement as HTMLElement | null,
    doc.documentElement as HTMLElement | null,
    doc.body as HTMLElement | null,
  ];

  for (const el of candidates) {
    if (!el) continue;

    if (
      typeof el.scrollTop === "number" &&
      el.scrollHeight > el.clientHeight + 8
    ) {
      return el;
    }
  }

  return null;
}






function scrollAnchorIntoView(
  reader: any,
  doc: Document,
  card: MagicDigestCard,
  pageIndex: number,
): void {
  const pageEl = findPDFPageElementForIndex(doc, pageIndex);
  if (!pageEl) return;

  const rect = getAnchorRect(card);

  if (!rect) {
    try {
      pageEl.scrollIntoView({ block: "center", inline: "nearest" });
    } catch {
      pageEl.scrollIntoView();
    }
    return;
  }

  const ctx = getPDFContext(reader, doc);
  const win = doc.defaultView;

  try {
    pageEl.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {
    try {
      pageEl.scrollIntoView();
    } catch {
      // ignore
    }
  }

  const [, y1, , y2] = rect;

  const getAnchorCenterY = (): number | null => {
    const pageRect = pageEl.getBoundingClientRect();

    if (pageRect.width <= 0 || pageRect.height <= 0) {
      return null;
    }

    return pageRect.top + ((y1 + y2) / 2) * pageRect.height;
  };

  const collectCandidates = (): HTMLElement[] => {
    const result: HTMLElement[] = [];
    const seen = new Set<HTMLElement>();

    const add = (el: HTMLElement | null | undefined) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      result.push(el);
    };

    add(getScrollParentOfElement(pageEl, doc));
    add(getPDFScrollContainer(reader, doc, pageEl));
    add((ctx?.viewerContainer as HTMLElement | null) || null);
    add(doc.querySelector("#viewerContainer") as HTMLElement | null);
    add(doc.querySelector(".pdfViewer")?.parentElement as HTMLElement | null);

    let parent = pageEl.parentElement;
    while (parent && parent !== doc.body && parent !== doc.documentElement) {
      add(parent as HTMLElement);
      parent = parent.parentElement;
    }

    add(doc.scrollingElement as HTMLElement | null);
    add(doc.documentElement as HTMLElement | null);
    add(doc.body as HTMLElement | null);

    return result.filter(
      (el) =>
        typeof el.scrollTop === "number" &&
        el.scrollHeight > el.clientHeight + 8,
    );
  };

  const tryCenterOnce = (): boolean => {
    const candidates = collectCandidates();

    candidates.sort(
      (a, b) =>
        b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight),
    );

    let bestDistance = Infinity;

    for (const container of candidates) {
      const containerRect = container.getBoundingClientRect();
      if (containerRect.height <= 0) continue;

      const anchorY = getAnchorCenterY();
      if (anchorY == null) return true;

      const desiredY = containerRect.top + containerRect.height * ANCHOR_VIEW_RATIO;
      const distance = Math.abs(anchorY - desiredY);
      bestDistance = Math.min(bestDistance, distance);

      if (distance <= 48) {
        return true;
      }

      const delta = anchorY - desiredY;
      const beforeScrollTop = container.scrollTop;

      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const nextScrollTop = Math.max(
        0,
        Math.min(maxScrollTop, beforeScrollTop + delta),
      );

      if (Math.abs(nextScrollTop - beforeScrollTop) <= 1) {
        continue;
      }

      const beforeAnchorY = anchorY;
      container.scrollTop = nextScrollTop;

      const afterAnchorY = getAnchorCenterY();

      if (
        afterAnchorY != null &&
        Math.abs(afterAnchorY - beforeAnchorY) > 2
      ) {
        return Math.abs(afterAnchorY - desiredY) <= 48;
      }
    }

    if (win) {
      const anchorY = getAnchorCenterY();
      if (anchorY == null) return true;

      const desiredY = (win.innerHeight || 800) * ANCHOR_VIEW_RATIO;
      const delta = anchorY - desiredY;

      if (Math.abs(delta) > 3) {
        try {
          win.scrollBy(0, delta);
          return false;
        } catch {
          // ignore
        }
      }
    }

    return bestDistance <= 48;
  };

  for (let i = 0; i < 6; i++) {
    if (tryCenterOnce()) {
      break;
    }
  }
}


function afterTwoAnimationFrames(doc: Document, callback: () => void): void {
  const win = doc.defaultView;

  if (win?.requestAnimationFrame) {
    win.requestAnimationFrame(() => {
      win.requestAnimationFrame(() => {
        callback();
      });
    });
    return;
  }

  setTimeout(callback, 80);
}

function nextJumpVersion(doc: Document): number {
  const next = (jumpVersionByDocument.get(doc) || 0) + 1;
  jumpVersionByDocument.set(doc, next);
  return next;
}

function isCurrentJumpVersion(doc: Document, version: number): boolean {
  return jumpVersionByDocument.get(doc) === version;
}


function getStableJumpKey(card: MagicDigestCard, pageIndex: number): string {
  const rect = getAnchorRect(card);
  return [
    String(card.id || ""),
    String(pageIndex),
    rect ? rect.map((x) => Number(x).toFixed(4)).join(",") : "no-rect",
  ].join("|");
}


function isAnchorCurrentlyVisible(
  reader: any,
  doc: Document,
  card: MagicDigestCard,
  pageIndex: number,
): boolean {
  const pageEl = findPDFPageElementForIndex(doc, pageIndex);
  const rect = getAnchorRect(card);

  if (!pageEl || !rect) return false;

  const container = getPDFScrollContainer(reader, doc, pageEl);

  if (!container) return false;

  const pageRect = pageEl.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  if (pageRect.width <= 0 || pageRect.height <= 0) return false;
  if (containerRect.height <= 0) return false;

  const [, y1, , y2] = rect;
  const anchorCenterY = pageRect.top + ((y1 + y2) / 2) * pageRect.height;

  const desiredY = containerRect.top + containerRect.height * ANCHOR_VIEW_RATIO;

  // Only skip scrolling if the anchor is already near the desired position.
  // Do not treat "barely visible near bottom/top" as good enough.
  return Math.abs(anchorCenterY - desiredY) <= 72;
}

function scheduleJumpRetry(
  doc: Document,
  version: number,
  delay: number,
  callback: () => void,
): void {
  const timer = setTimeout(() => {
    if (isCurrentJumpVersion(doc, version)) {
      callback();
    }
  }, delay);

  addJumpScrollTimer(doc, timer as unknown as number);
}


function forceNavigatePDFPage(
  reader: any,
  doc: Document,
  ctx: PDFContext,
  pageIndex: number,
): void {
  const pageNumber = pageIndex + 1;
  const win: any = ctx.pdfWin as any;
  const app = win?.PDFViewerApplication;
  const viewer = ctx.viewer;
  const linkService =
    app?.pdfLinkService ||
    app?.pdfViewer?.linkService ||
    viewer?.linkService ||
    viewer?._linkService;

  // Try PDF.js application-level APIs first.
  try {
    if (app && typeof app.page !== "undefined") {
      app.page = pageNumber;
    }
  } catch {
    // ignore
  }

  try {
    if (app?.pdfViewer && typeof app.pdfViewer.currentPageNumber !== "undefined") {
      app.pdfViewer.currentPageNumber = pageNumber;
    }
  } catch {
    // ignore
  }

  try {
    if (viewer && typeof viewer.currentPageNumber !== "undefined") {
      viewer.currentPageNumber = pageNumber;
    }
  } catch {
    // ignore
  }

  try {
    if (linkService && typeof linkService.goToPage === "function") {
      linkService.goToPage(pageNumber);
    }
  } catch {
    // ignore
  }

  // Try scrollPageIntoView variants.
  try {
    if (app?.pdfViewer && typeof app.pdfViewer.scrollPageIntoView === "function") {
      app.pdfViewer.scrollPageIntoView({
        pageNumber,
        destArray: null,
        allowNegativeOffset: true,
      });
    }
  } catch {
    // ignore
  }

  try {
    if (viewer && typeof viewer.scrollPageIntoView === "function") {
      viewer.scrollPageIntoView({
        pageNumber,
        destArray: null,
        allowNegativeOffset: true,
      });
    }
  } catch {
    // ignore
  }

  // Direct DOM fallback if target page already exists.
  try {
    const pageEl = findPDFPageElementForIndex(doc, pageIndex);
    if (pageEl) {
      pageEl.scrollIntoView({ block: "center", inline: "nearest" });
    }
  } catch {
    // ignore
  }
}

function jumpToCard(reader: any, doc: Document, card: MagicDigestCard) {
  clearJumpScrollTimers(doc);

  if (isUnresolvedCard(card)) {
    new ztoolkit.ProgressWindow("magic_digest", {
      closeOnClick: true,
      closeTime: 2200,
    })
      .createLine({
        text: "This card is not located yet, so it cannot jump to a precise position.",
        type: "default",
        progress: 100,
      })
      .show();
    return;
  }

  const pageIndex = Math.max(0, Math.floor(Number(card.page || 0)));
  const stableKey = getStableJumpKey(card, pageIndex);

  if (
    lastStableJumpKeyByDocument.get(doc) === stableKey &&
    isAnchorCurrentlyVisible(reader, doc, card, pageIndex)
  ) {
    try {
      showPersistentHighlight(reader, doc, card);
    } catch {
      // ignore
    }

    try {
      flashAnchor(reader, doc, card, pageIndex);
    } catch {
      // ignore
    }

    return;
  }

  lastStableJumpKeyByDocument.set(doc, stableKey);

  const version = nextJumpVersion(doc);
  const ctx = getPDFContext(reader, doc);
  if (!ctx) return;

  // Always force PDF.js/Zotero to navigate to target page.
  forceNavigatePDFPage(reader, doc, ctx, pageIndex);

  const centerAndHighlightIfReady = (): boolean => {
    if (!isCurrentJumpVersion(doc, version)) {
      return true;
    }

    const pageEl = findPDFPageElementForIndex(doc, pageIndex);

    if (!pageEl) {
      return false;
    }

    try {
      scrollAnchorIntoView(reader, doc, card, pageIndex);
    } catch {
      // ignore
    }

    try {
      showPersistentHighlight(reader, doc, card);
    } catch {
      // ignore
    }

    try {
      flashAnchor(reader, doc, card, pageIndex);
    } catch {
      // ignore
    }

    return true;
  };

  const delays = [80, 180, 360, 700, 1200, 1800];

  for (const delay of delays) {
    scheduleJumpRetry(doc, version, delay, () => {
      if (!isCurrentJumpVersion(doc, version)) {
        return;
      }

      // Re-issue navigation while the page DOM is still absent.
      if (!findPDFPageElementForIndex(doc, pageIndex)) {
        forceNavigatePDFPage(reader, doc, ctx, pageIndex);
      }

      centerAndHighlightIfReady();
    });
  }
}

function clearOverlay(doc: Document) {
  const state = getOrCreateState(doc);

  for (const cleanup of state.cleanup) {
    try {
      cleanup();
    } catch {
      // ignore
    }
  }

  state.cleanup = [];
  clearConnectors(doc);
  state.cards = [];
  state.active = false;

  if (state.overlay) {
    try {
      state.overlay.remove();
    } catch {
      // ignore
    }
    state.overlay = null;
  }

  if (state.flashLayer) {
    try {
      state.flashLayer.remove();
    } catch {
      // ignore
    }
    state.flashLayer = null;
  }

  if (state.persistentLayer) {
    try {
      state.persistentLayer.remove();
    } catch {
      // ignore
    }
    state.persistentLayer = null;
  }
}


function deleteCardFromAnalysis(
  analysis: MagicDigestAnalysis,
  cardID: string,
): boolean {
  for (const page of analysis.pageCards || []) {
    const left = page.left || [];
    const right = page.right || [];

    const leftIndex = left.findIndex((card) => card.id === cardID);
    if (leftIndex >= 0) {
      left.splice(leftIndex, 1);
      page.left = left;
      return true;
    }

    const rightIndex = right.findIndex((card) => card.id === cardID);
    if (rightIndex >= 0) {
      right.splice(rightIndex, 1);
      page.right = right;
      return true;
    }
  }

  return false;
}


function findCardElementByCardID(
  doc: Document,
  cardID: string,
): HTMLElement | null {
  const cards = Array.from(
    doc.querySelectorAll(".magic-digest-floating-card"),
  ) as HTMLElement[];

  return cards.find((el) => el.dataset.cardId === cardID) || null;
}

function markCardPendingDelete(el: HTMLElement): () => void {
  const oldOutline = el.style.outline;
  const oldBoxShadow = el.style.boxShadow;
  const oldBackground = el.style.background;
  const oldTransform = el.style.transform;
  const oldZIndex = el.style.zIndex;
  const oldOpacity = el.style.opacity;

  el.style.outline = "3px solid #ef4444";
  el.style.boxShadow =
    "0 0 0 5px rgba(239,68,68,.28), 0 12px 30px rgba(127,29,29,.45)";
  el.style.background = "rgba(254,226,226,.96)";
  el.style.transform = "scale(1.035)";
  el.style.zIndex = "1000002";
  el.style.opacity = "1";
const ownerDoc = el.ownerDocument;
  if (!ownerDoc) {
    return () => {};
  }

  const badge = ownerDoc.createElement("div");
  badge.className = "magic-digest-delete-pending-badge";
  badge.textContent = "将删除此卡片";
  badge.setAttribute(
    "style",
    [
      "position:absolute",
      "left:8px",
      "bottom:6px",
      "background:#dc2626",
      "color:#fff",
      "font-size:11px",
      "font-weight:800",
      "border-radius:999px",
      "padding:2px 8px",
      "box-shadow:0 2px 8px rgba(0,0,0,.25)",
      "z-index:3",
      "pointer-events:none",
    ].join(";"),
  );

  el.appendChild(badge);

  return () => {
    el.style.outline = oldOutline;
    el.style.boxShadow = oldBoxShadow;
    el.style.background = oldBackground;
    el.style.transform = oldTransform;
    el.style.zIndex = oldZIndex;
    el.style.opacity = oldOpacity;

    try {
      badge.remove();
    } catch {
      // ignore
    }
  };
}

function waitForPaint(doc: Document): Promise<void> {
  return new Promise((resolve) => {
    const win = doc.defaultView;
    if (!win) {
      setTimeout(resolve, 80);
      return;
    }

    win.requestAnimationFrame(() => {
      win.requestAnimationFrame(() => resolve());
    });
  });
}

async function deleteCardAndRefresh(params: {
  reader: any;
  doc: Document;
  card: MagicDigestCard;
}): Promise<void> {
  const { reader, doc, card } = params;
  const state = getOrCreateState(doc);

  if (!state.analysis || !state.attachmentItemID) {
    return;
  }

  const cardEl = findCardElementByCardID(doc, card.id);
  const restoreHighlight = cardEl ? markCardPendingDelete(cardEl) : () => {};

  // 让红色高亮先真正绘制出来，再弹出 confirm，避免用户不知道删的是哪张
  await waitForPaint(doc);

  const title = card.title || card.id;
  const win = doc.defaultView;

  const confirmed = win
    ? win.confirm(
        "即将删除红色高亮的这张 magic_digest 卡片。\\n\\n确定删除吗？\\n\\n" +
          title,
      )
    : true;

  if (!confirmed) {
    restoreHighlight();
    return;
  }

  const ok = deleteCardFromAnalysis(state.analysis, card.id);

  if (!ok) {
    restoreHighlight();

    new ztoolkit.ProgressWindow("magic_digest", {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({
        text: "删除失败：analysis.json 中没有找到该卡片",
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  await writeAnalysisFile(state.attachmentItemID, state.analysis);

  clearPersistentHighlight(doc);
hoveredConnectorKeyByDocument.set(doc, null);
        updateConnectors(reader, doc);

  new ztoolkit.ProgressWindow("magic_digest", {
    closeOnClick: true,
    closeTime: 3000,
  })
    .createLine({
      text: "卡片已删除 ✅",
      type: "success",
      progress: 100,
    })
    .show();

  buildCardsForOverlay(reader, doc, state.analysis);
  attachPositionListeners(reader, doc);
  positionCards(reader, doc);
}

function findCardInAnalysis(
  analysis: MagicDigestAnalysis,
  cardID: string,
): MagicDigestCard | null {
  for (const page of analysis.pageCards || []) {
    for (const card of [...(page.left || []), ...(page.right || [])]) {
      if (card.id === cardID) return card;
    }
  }
  return null;
}

function openEditDialog(params: {
  reader: any;
  doc: Document;
  card: MagicDigestCard;
}) {
  const { reader, doc, card } = params;
  const state = getOrCreateState(doc);

  if (!state.analysis || !state.attachmentItemID) return;

  const oldModal = doc.getElementById("magic-digest-edit-modal");
  oldModal?.remove();

  const modal = doc.createElement("div");
  modal.id = "magic-digest-edit-modal";
  modal.setAttribute(
    "style",
    [
      "position:fixed",
      "left:0",
      "top:0",
      "right:0",
      "bottom:0",
      "z-index:1000000",
      "background:rgba(0,0,0,.55)",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    ].join(";"),
  );

  const tagsText = Array.isArray(card.tags) ? card.tags.join(", ") : "";

  modal.innerHTML = `
    <div style="width:560px;max-width:92vw;background:#0f172a;color:#e5e7eb;border:1px solid #334155;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.45);padding:16px;">
      <div style="font-size:16px;font-weight:800;margin-bottom:12px;">编辑 magic_digest 卡片</div>

      <label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">标题</label>
      <input id="magic-digest-edit-title" value="${escapeHTML(card.title || "")}"
        style="width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:7px 8px;font-size:13px;margin-bottom:10px;" />

      <label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">内容</label>
      <textarea id="magic-digest-edit-content"
        style="width:100%;height:180px;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:8px;font-size:13px;line-height:1.5;margin-bottom:10px;">${escapeHTML(
          getCardText(card),
        )}</textarea>

      <label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">标签，逗号分隔</label>
      <input id="magic-digest-edit-tags" value="${escapeHTML(tagsText)}"
        style="width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:7px 8px;font-size:13px;margin-bottom:14px;" />

      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button id="magic-digest-edit-cancel"
          style="background:#334155;color:#e5e7eb;border:0;border-radius:6px;padding:5px 12px;cursor:pointer;">取消</button>
        <button id="magic-digest-edit-save"
          style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:5px 12px;cursor:pointer;">保存</button>
      </div>
    </div>
  `;

  const root = doc.documentElement || doc.body;
  if (!root) return;
  root.appendChild(modal);

  const close = () => {
    try {
      modal.remove();
    } catch {
      // ignore
    }
  };

  doc.getElementById("magic-digest-edit-cancel")?.addEventListener("click", close);

  doc.getElementById("magic-digest-edit-save")?.addEventListener("click", async () => {
    const titleInput = doc.getElementById(
      "magic-digest-edit-title",
    ) as HTMLInputElement | null;
    const contentInput = doc.getElementById(
      "magic-digest-edit-content",
    ) as HTMLTextAreaElement | null;
    const tagsInput = doc.getElementById(
      "magic-digest-edit-tags",
    ) as HTMLInputElement | null;

    const newTitle = String(titleInput?.value || "").trim();
    const newContent = String(contentInput?.value || "").trim();
    const newTags = String(tagsInput?.value || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    const target = findCardInAnalysis(state.analysis!, card.id);
    if (!target) {
      new ztoolkit.ProgressWindow("magic_digest", {
        closeOnClick: true,
        closeTime: 5000,
      })
        .createLine({
          text: "保存失败：未在 analysis.json 中找到该卡片",
          type: "fail",
          progress: 100,
        })
        .show();
      return;
    }

    setCardEdited(target, {
      title: newTitle,
      content: newContent,
      tags: newTags,
    });

    try {
      await writeAnalysisFile(state.attachmentItemID!, state.analysis!);

      new ztoolkit.ProgressWindow("magic_digest", {
        closeOnClick: true,
        closeTime: 3500,
      })
        .createLine({
          text: "卡片已保存 ✅",
          type: "success",
          progress: 100,
        })
        .show();

      close();

      buildCardsForOverlay(reader, doc, state.analysis!);
      attachPositionListeners(reader, doc);
      positionCards(reader, doc);
    } catch (e: any) {
      new ztoolkit.ProgressWindow("magic_digest", {
        closeOnClick: true,
        closeTime: 8000,
      })
        .createLine({
          text: `保存失败：${e?.message || String(e)}`,
          type: "fail",
          progress: 100,
        })
        .show();
    }
  });
}


function splitCardTextIntoTreeItems(text: string): string[] {
  const raw = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (!raw) return [];

  let parts = raw
    .split(/\n|；|;|(?<=[。.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    parts = raw
      .split(/，|,|、/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 8);
  }

  return parts
    .map((x) =>
      x
        .replace(/^[-*•]\s*/, "")
        .replace(/^\d+[\.、)]\s*/, "")
        .trim(),
    )
    .filter((x) => x.length >= 6)
    .slice(0, 5);
}

function shouldRenderTreeCard(card: MagicDigestCard): boolean {
  const tags = Array.isArray(card.tags)
    ? card.tags.map((x) => String(x).toLowerCase()).join(" ")
    : "";

  const title = String(card.title || "").toLowerCase();
  const type = String(card.type || "").toLowerCase();
  const text = getCardText(card);

  if (/tree|branch|flow|workflow|framework|mechanism|pathway|structure/.test(tags)) {
    return true;
  }

  if (/流程|机制|路径|框架|结构|分支|树|因素|步骤|阶段|链条|诊断|设计|方法|模型/.test(title)) {
    return true;
  }

  if (["method", "insight", "comparison", "term"].includes(type)) {
    const items = splitCardTextIntoTreeItems(text);
    return items.length >= 3;
  }

  return false;
}

function renderTreeCardHTML(card: MagicDigestCard): string {
  const text = getCardText(card);
  const items = splitCardTextIntoTreeItems(text);
  const rightTitle = escapeHTML(String(card.title || "").slice(0, 42));

  if (items.length < 2) {
    return "";
  }

  const leftItems = items
    .map((item, index) => {
      return [
        '<div class="magic-digest-tree-item" style="',
        'position:relative;',
        'font-size:11px;',
        'line-height:1.35;',
        'color:#334155;',
        'padding:2px 8px 2px 0;',
        'min-height:18px;',
        '">',
        '<span style="color:#64748b;">',
        String(index + 1),
        '. </span>',
        escapeHTML(item.slice(0, 56)),
        '<span style="',
        'position:absolute;',
        'right:-13px;',
        'top:50%;',
        'width:13px;',
        'border-top:1px solid rgba(100,116,139,.55);',
        '"></span>',
        '</div>',
      ].join("");
    })
    .join("");

  return [
    '<div class="magic-digest-tree-card" style="',
    'display:grid;',
    'grid-template-columns:1fr 92px;',
    'gap:12px;',
    'align-items:center;',
    'min-height:76px;',
    'position:relative;',
    '">',
      '<div style="position:relative;padding-right:8px;">',
        leftItems,
        '<span style="',
        'position:absolute;',
        'right:-6px;',
        'top:8px;',
        'bottom:8px;',
        'border-right:1px solid rgba(100,116,139,.55);',
        '"></span>',
      '</div>',
      '<div style="',
      'font-size:12px;',
      'font-weight:900;',
      'line-height:1.25;',
      'color:#0f172a;',
      'text-align:left;',
      'padding-left:2px;',
      '">',
        rightTitle,
      '</div>',
    '</div>',
  ].join("");
}

function enhanceCardBodyLayout(
  el: HTMLElement,
  card: MagicDigestCard,
  doc: Document,
): void {
  // 卡片整体允许更高，但内部滚动，避免卡片无限变长
  el.style.maxHeight = "260px";
  el.style.overflow = "hidden";

  const extra = el.querySelector(".magic-digest-card-extra") as HTMLElement | null;

  if (extra) {
    extra.style.maxHeight = "145px";
    extra.style.overflowY = "auto";
    extra.style.overflowX = "hidden";
    extra.style.paddingRight = "4px";
    extra.style.scrollbarWidth = "thin";
  }

  // 折叠状态下不渲染树状内容
  if (!extra || extra.style.display === "none") {
    return;
  }

  if (shouldHideCardInCurrentOverlay(doc, card) || !shouldRenderTreeCard(card)) {
    return;
  }

  const treeHTML = renderTreeCardHTML(card);
  if (!treeHTML) return;

  extra.innerHTML = [
    '<div style="',
    'max-height:150px;',
    'overflow-y:auto;',
    'overflow-x:hidden;',
    'padding-right:4px;',
    '">',
      treeHTML,
    '</div>',
  ].join("");
}


function normalizeForAutoLocate(text: string): string {
  // Light normalization: lowercase, collapse whitespace, but KEEP most
  // punctuation/operators since PDF text layer preserves them.
  return String(text || "")
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-") // Unicode hyphens → ASCII
    .replace(/[\u2018\u2019]/g, "'")  // smart quotes → straight
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function makeAutoLocateNeedles(card: MagicDigestCard): string[] {
  const anchor = (card as any).anchor || {};
  const text = getCardText(card);

  const candidates = [
    card.anchorText,
    anchor.quote,
    card.title,
    text.split(/\n|。|\.|；|;/).find((x) => String(x || "").trim().length >= 12),
    text.slice(0, 160),
  ];

  const result: string[] = [];

  for (const c of candidates) {
    const normalized = normalizeForAutoLocate(String(c || ""));
    if (normalized.length >= 8) {
      result.push(normalized.slice(0, 180));
    }

    // Word-level sub-phrases: try first 2-8 words and last few words
    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length >= 3) {
      result.push(words.slice(0, Math.min(8, words.length)).join(" "));
      result.push(words.slice(0, Math.min(5, words.length)).join(" "));
      result.push(words.slice(0, Math.min(3, words.length)).join(" "));
      if (words.length >= 6) {
        result.push(words.slice(-5).join(" "));
        result.push(words.slice(-3).join(" "));
      }
    }

    // Character-level substrings
    if (normalized.length > 24) {
      result.push(normalized.slice(0, 24));
    }
    if (normalized.length > 16) {
      result.push(normalized.slice(0, 16));
    }
  }

  return Array.from(new Set(result))
    .filter((x) => x.length >= 8)
    .sort((a, b) => b.length - a.length)
    .slice(0, 10);
}

function getPageIndexFromPageElement(pageEl: Element, fallback: number): number {
  const raw =
    pageEl.getAttribute("data-page-number") ||
    pageEl.getAttribute("data-page-index") ||
    "";

  const n = Number(raw);

  if (Number.isFinite(n)) {
    // data-page-number is usually 1-based; data-page-index is usually 0-based.
    if (pageEl.hasAttribute("data-page-index")) {
      return Math.max(0, Math.floor(n));
    }
    return Math.max(0, Math.floor(n - 1));
  }

  const id = String((pageEl as HTMLElement).id || "");
  const m = id.match(/page(?:Container)?(\d+)/i);
  if (m) {
    return Math.max(0, Number(m[1]) - 1);
  }

  return fallback;
}

function collectPageSnippet(pageEl: Element, maxLen: number): string {
  const spans = getTextLayerSpans(pageEl);
  let text = "";
  for (const el of spans) {
    const t = String(el.textContent || "").trim();
    if (t) {
      text += (text ? " " : "") + t;
      if (text.length >= maxLen) break;
    }
  }
  return text.slice(0, maxLen);
}

function getTextLayerSpans(pageEl: Element): HTMLElement[] {
  const nodes = Array.from(
    pageEl.querySelectorAll(".textLayer span, .textLayer div"),
  ) as HTMLElement[];

  return nodes.filter((el) => String(el.textContent || "").trim().length > 0);
}

function unionRects(rects: DOMRect[]): DOMRect | null {
  if (!rects.length) return null;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const r of rects) {
    if (r.width <= 0 || r.height <= 0) continue;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }

  if (!Number.isFinite(left) || right <= left || bottom <= top) return null;

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON() {
      return {};
    },
  } as DOMRect;
}

function locateNeedleOnPage(
  pageEl: HTMLElement,
  needle: string,
): { rect: number[]; matchedText: string } | null {
  const spans = getTextLayerSpans(pageEl);
  if (!spans.length) return null;

  // Build two versions: space-separated and concatenated.
  let pageTextSpaced = "";
  let pageTextConcat = "";
  const entries: Array<{ el: HTMLElement; start: number; end: number }> = [];
  const entriesConcat: Array<{ el: HTMLElement; start: number; end: number }> = [];

  for (const el of spans) {
    const raw = String(el.textContent || "");
    const norm = normalizeForAutoLocate(raw);
    if (!norm) continue;

    const startS = pageTextSpaced.length;
    pageTextSpaced += (pageTextSpaced ? " " : "") + norm;
    entries.push({ el, start: startS, end: pageTextSpaced.length });

    const startC = pageTextConcat.length;
    pageTextConcat += norm;
    entriesConcat.push({ el, start: startC, end: pageTextConcat.length });
  }

  if (!needle) return null;

  // Try matching against both text versions.
  // pageTextSpaced: good for word-level spans (space between words)
  // pageTextConcat: good for per-character spans (leading to no artificial spaces)
  let start = -1;
  let usedNeedle = needle;
  let bestPageText = pageTextSpaced;

  const tryMatch = (pt: string): number => {
    if (!pt) return -1;

    // Try exact
    let pos = pt.indexOf(needle);
    if (pos >= 0) return pos;

    // Word-level n-gram matching (only for spaced version)
    const needleWords = needle.split(/\s+/).filter(Boolean);
    const ngramLen = Math.min(5, needleWords.length);
    const minMatchCount = Math.max(2, Math.floor(needleWords.length * 0.5));

    if (needleWords.length >= 2) {
      const ngrams: string[] = [];
      for (let i = 0; i <= needleWords.length - ngramLen; i++) {
        ngrams.push(needleWords.slice(i, i + ngramLen).join(" "));
      }
      ngrams.push(needleWords.slice(0, Math.min(3, needleWords.length)).join(" "));
      ngrams.push(needleWords.slice(0, Math.min(4, needleWords.length)).join(" "));

      let bestPos = -1;
      let bestScore = 0;

      for (const ng of ngrams) {
        const ngPos = pt.indexOf(ng);
        if (ngPos < 0) continue;

        const windowStart = Math.max(0, ngPos - 40);
        const windowEnd = Math.min(pt.length, ngPos + ng.length + 40);
        const windowText = pt.slice(windowStart, windowEnd);
        const windowWords = windowText.split(/\s+/);

        let score = 0;
        for (const nw of needleWords) {
          if (windowWords.some((w) => w === nw)) score++;
        }
        if (score > bestScore) { bestScore = score; bestPos = ngPos; }
      }

      if (bestPos >= 0 && bestScore >= minMatchCount) return bestPos;
    }

    // Short prefix fallback
    if (needle.length > 36) {
      pos = pt.indexOf(needle.slice(0, 36).trim());
      if (pos >= 0) return pos;
    }
    if (needle.length > 20) {
      pos = pt.indexOf(needle.slice(0, 20).trim());
      if (pos >= 0) return pos;
    }

    return -1;
  };

  // Try spaced text first (better for word-level)
  let matchedEntries = entries;
  start = tryMatch(pageTextSpaced);

  // If not found, try concatenated (better for per-char spans)
  if (start < 0 && pageTextConcat) {
    start = tryMatch(pageTextConcat);
    matchedEntries = entriesConcat;
  }

  if (start < 0) return null;

  const end = start + needle.length;

  const matchedSpans = matchedEntries
    .filter((e) => e.end >= start && e.start <= end)
    .map((e) => e.el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);

  const union = unionRects(matchedSpans);
  if (!union) return null;

  const pageRect = pageEl.getBoundingClientRect();

  if (pageRect.width <= 0 || pageRect.height <= 0) return null;

  const x1 = clamp((union.left - pageRect.left) / pageRect.width, 0, 1);
  const y1 = clamp((union.top - pageRect.top) / pageRect.height, 0, 1);
  const x2 = clamp((union.right - pageRect.left) / pageRect.width, 0, 1);
  const y2 = clamp((union.bottom - pageRect.top) / pageRect.height, 0, 1);

  if (x2 <= x1 || y2 <= y1) return null;

  return {
    rect: [x1, y1, x2, y2],
    matchedText: usedNeedle,
  };
}

function autoLocateUnresolvedCards(
  reader: any,
  doc: Document,
  analysis: MagicDigestAnalysis,
): number {
  const ctx = getPDFContext(reader, doc);
  if (!ctx) return 0;

  const pageEls = Array.from(
    doc.querySelectorAll(".page"),
  ) as HTMLElement[];

  if (!pageEls.length) return 0;

  // 诊断：输出第一页文本和前 3 个搜索词到 Zotero.debug()
  const diagLines: string[] = [];
  const diagPage0 = pageEls[0];
  if (diagPage0) {
    diagLines.push("=== Page 0 (spaced) ===");
    diagLines.push(collectPageSnippet(diagPage0, 800));
    diagLines.push("=== Page 0 (concat) ===");
    const spans0 = getTextLayerSpans(diagPage0);
    let concat = "";
    for (const s of spans0) concat += normalizeForAutoLocate(String(s.textContent || ""));
    diagLines.push(concat.slice(0, 800));
  }
  diagLines.push("=== Sample needles ===");
  let needleCount = 0;
  for (const pc of analysis.pageCards || []) {
    for (const card of [...(pc.left || []), ...(pc.right || [])]) {
      if (!isUnresolvedCard(card)) continue;
      const nds = makeAutoLocateNeedles(card);
      if (nds.length && needleCount < 3) {
        diagLines.push(`Card "${String(card.title).slice(0, 60)}" page=${card.page}:`);
        for (const n of nds.slice(0, 5)) diagLines.push(`  needle: "${n.slice(0, 120)}"`);
        needleCount++;
      }
    }
    if (needleCount >= 3) break;
  }
  diagLines.push(`=== Total unresolved before: ${(analysis.pageCards || []).reduce((s, pc) => s + [...(pc.left || []), ...(pc.right || [])].filter(isUnresolvedCard).length, 0)} ===`);
  (Zotero as any).debug(diagLines.join("\n"));

  let located = 0;

  for (const pc of analysis.pageCards || []) {
    const cards = [...(pc.left || []), ...(pc.right || [])];

    for (const card of cards) {
      if (!isUnresolvedCard(card)) continue;

      const needles = makeAutoLocateNeedles(card);
      if (!needles.length) continue;

      let found:
        | {
            pageIndex: number;
            rect: number[];
            matchedText: string;
          }
        | null = null;

      // Prefer declared card page first, then scan all rendered pages.
      const preferredPage = Math.max(0, Math.floor(Number(card.page || 0)));

      const orderedPages = [
        ...pageEls.filter(
          (p, i) => getPageIndexFromPageElement(p, i) === preferredPage,
        ),
        ...pageEls.filter(
          (p, i) => getPageIndexFromPageElement(p, i) !== preferredPage,
        ),
      ];

      for (const pageEl of orderedPages) {
        const pageIndex = getPageIndexFromPageElement(
          pageEl,
          pageEls.indexOf(pageEl),
        );

        for (const needle of needles) {
          const hit = locateNeedleOnPage(pageEl, needle);
          if (hit) {
            found = {
              pageIndex,
              rect: hit.rect,
              matchedText: hit.matchedText,
            };
            break;
          }
        }

        if (found) break;
      }

      if (found) {
        card.page = found.pageIndex;
        (card as any).anchor = {
          method: "pdf-textlayer-auto",
          rects: [found.rect],
          quote: found.matchedText,
          noAutoMatch: false,
        };

        if (!Array.isArray(card.tags)) card.tags = [];
        if (!card.tags.includes("auto-located")) {
          card.tags.push("auto-located");
        }

        located++;
      }
    }
  }

  return located;
}


function collectReaderDiagnostics(
  reader: any,
  doc: Document,
  analysis: MagicDigestAnalysis,
): any {
  const attachmentItemID = getReaderAttachmentItemID(reader);

  const cards: any[] = [];

  const normalizeText = (text: unknown): string =>
    String(text || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[\u3000]/g, " ")
      .trim()
      .slice(0, 160);

  const normalizeRect = (rect: number[] | null): string => {
    if (!rect) return "no-rect";
    return rect.map((x) => Number(x).toFixed(4)).join(",");
  };

  const getDuplicateKey = (item: any): string => {
    return [
      String(item.page),
      item.anchor?.kind || "",
      normalizeRect(item.anchor?.rect || null),
      normalizeText(item.anchorText || item.contentPreview || item.title || ""),
    ].join("|");
  };

  for (const page of analysis.pageCards || []) {
    const pageNumber = Math.max(0, Math.floor(Number(page.page || 0)));

    const addCards = (items: MagicDigestCard[] | undefined, side: "left" | "right") => {
      for (const card of items || []) {
        const anchor = (card as any).anchor || {};
        const rect = getAnchorRect(card);

        cards.push({
          id: card.id,
          title: card.title || "",
          type: card.type || "",
          tags: Array.isArray(card.tags) ? card.tags : [],
          page: pageNumber,
          side,
          unresolved: isUnresolvedCard(card),
          hiddenByCurrentOverlay: shouldHideCardInCurrentOverlay(doc, card),
          collapsed: isCardCollapsed(doc, card),
          anchor: {
            method: anchor.method || "",
            kind: anchor.kind || "",
            elementId: anchor.elementId || "",
            noAutoMatch: anchor.noAutoMatch === true,
            rect,
            rawRects: Array.isArray(anchor.rects) ? anchor.rects : [],
          },
          anchorText: String((card as any).anchorText || "").slice(0, 240),
          contentPreview: getCardText(card).slice(0, 240),
        });
      }
    };

    addCards(page.left || [], "left");
    addCards(page.right || [], "right");
  }

  const duplicateMap = new Map<string, any[]>();

  for (const card of cards) {
    const key = getDuplicateKey(card);
    if (!duplicateMap.has(key)) {
      duplicateMap.set(key, []);
    }
    duplicateMap.get(key)!.push(card);
  }

  const duplicateGroups = Array.from(duplicateMap.entries())
    .map(([key, items]) => ({
      key,
      count: items.length,
      ids: items.map((item) => item.id),
      titles: Array.from(new Set(items.map((item) => item.title))).slice(0, 6),
      pages: Array.from(new Set(items.map((item) => item.page))),
      sides: Array.from(new Set(items.map((item) => item.side))),
      rect: items[0]?.anchor?.rect || null,
      anchorTextPreview: String(items[0]?.anchorText || "").slice(0, 160),
    }))
    .filter((group) => group.count >= 2)
    .sort((a, b) => b.count - a.count);

  return {
    generatedAt: new Date().toISOString(),
    attachmentItemID,
    cardCount: cards.length,
    unresolvedCount: cards.filter((card) => card.unresolved).length,
    duplicateGroupCount: duplicateGroups.length,
    duplicateCardCount: duplicateGroups.reduce((sum, group) => sum + group.count, 0),
    hiddenUnresolved: hideUnresolvedByDocument.get(doc) === true,
    globalCollapsed: globalCollapsedByDocument.get(doc) === true,
    anchorViewRatio: typeof ANCHOR_VIEW_RATIO === "number" ? ANCHOR_VIEW_RATIO : null,
    duplicateGroups,
    cards,
  };
}

async function copyTextToClipboard(doc: Document, text: string): Promise<void> {
  const win = doc.defaultView;

  try {
    const clipboard = win?.navigator?.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return;
    }
  } catch {
    // fallback below
  }

  const textarea = doc.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute(
    "style",
    [
      "position:fixed",
      "left:-10000px",
      "top:-10000px",
      "width:1px",
      "height:1px",
      "opacity:0",
    ].join(";"),
  );

  const root = doc.documentElement || doc.body;
  if (!root) {
    throw new Error("No document root for clipboard fallback");
  }

  root.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const ok = doc.execCommand("copy");
    if (!ok) {
      throw new Error("execCommand copy returned false");
    }
  } finally {
    textarea.remove();
  }
}

function showReaderDiagnosticsResult(ok: boolean, message: string): void {
  new ztoolkit.ProgressWindow("magic_digest", {
    closeOnClick: true,
    closeTime: ok ? 2200 : 5000,
  })
    .createLine({
      text: message,
      type: ok ? "success" : "fail",
      progress: 100,
    })
    .show();
}

async function exportReaderDiagnostics(
  reader: any,
  doc: Document,
  analysis: MagicDigestAnalysis,
): Promise<void> {
  try {
    const diagnostics = collectReaderDiagnostics(reader, doc, analysis);
    const text = JSON.stringify(diagnostics, null, 2);

    await copyTextToClipboard(doc, text);

    showReaderDiagnosticsResult(
      true,
      "Reader diagnostics copied to clipboard.",
    );
  } catch (e: any) {
    showReaderDiagnosticsResult(
      false,
      "Failed to copy diagnostics: " + (e?.message || String(e)),
    );
  }
}


function normalizeDuplicateTextForOverlay(text: unknown): string {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\u3000]/g, " ")
    .trim()
    .slice(0, 160);
}

function normalizeDuplicateRectForOverlay(rect: number[] | null): string {
  if (!rect) return "no-rect";
  return rect.map((x) => Number(x).toFixed(4)).join(",");
}

function getOverlayDuplicateCardKey(page: number, card: MagicDigestCard): string {
  const anchor = (card as any).anchor || {};
  const rect = getAnchorRect(card);

  const text =
    String((card as any).anchorText || "") ||
    getCardText(card) ||
    String(card.title || "");

  return [
    String(page),
    String(anchor.kind || ""),
    normalizeDuplicateRectForOverlay(rect),
    normalizeDuplicateTextForOverlay(text),
  ].join("|");
}

// ==============================
// 卡片搜索 / 筛选 / 批量操作
// ==============================

let activeTypeFilter: string | null = null;

function cardMatchesFilter(card: MagicDigestCard, searchText: string): boolean {
  if (activeTypeFilter && card.type !== activeTypeFilter) return false;

  if (!searchText) return true;

  const lower = searchText.toLowerCase();
  const haystack = [
    card.title,
    card.anchorText,
    typeof card.content === "object"
      ? (card.content as any).aiOriginal || (card.content as any).userEdited || ""
      : String(card.content || ""),
    ...(card.tags || []),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(lower);
}

function applyCardFilter(doc: Document, searchText: string): void {
  const state = getOrCreateState(doc);
  if (!state.active) return;

  let visibleCount = 0;

  for (const item of state.cards) {
    const match = cardMatchesFilter(item.card, searchText);
    item.el.style.display = match ? "" : "none";
    if (match) visibleCount++;
  }

  // 更新连线：隐藏不匹配卡片的连线
  updateConnectorsForFilter(state, doc);
}

function updateConnectorsForFilter(
  state: OverlayState,
  doc: Document,
): void {
  const svg = doc.getElementById("magic-digest-connector-layer") as unknown as SVGSVGElement | null;
  if (!svg) return;

  const polylines = svg.querySelectorAll("polyline");
  const markerLayer = doc.getElementById("magic-digest-anchor-marker-layer") as HTMLElement | null;

  for (const item of state.cards) {
    const visible = item.el.style.display !== "none";
    const key = getCardStableKey(item.card);

    polylines.forEach((p: any) => {
      if (p.getAttribute("data-magic-digest-card-key") === key) {
        p.style.display = visible ? "" : "none";
      }
    });

    if (markerLayer) {
      const markers = markerLayer.querySelectorAll(`[data-magic-digest-card-key="${key}"]`);
      markers.forEach((m: any) => {
        (m as HTMLElement).style.display = visible ? "" : "none";
      });
    }
  }
}

function buildCardsForOverlay(
  reader: any,
  doc: Document,
  analysis: MagicDigestAnalysis,
) {
  const state = getOrCreateState(doc);
  const overlay = createLayer(doc, "magic-digest-floating-card-layer", 999998);
  const flashLayer = createLayer(doc, "magic-digest-anchor-flash-layer", 999997);
  const persistentLayer = createLayer(
    doc,
    "magic-digest-persistent-highlight-layer",
    999996,
  );

  state.overlay = overlay;
  state.flashLayer = flashLayer;
  state.persistentLayer = persistentLayer;
  state.cards = [];

  overlay.innerHTML = "";
  flashLayer.innerHTML = "";
  persistentLayer.innerHTML = "";

  const header = doc.createElement("div");
  header.setAttribute(
    "style",
    [
      "position:fixed",
      "top:46px",
      "left:50%",
      "transform:translateX(-50%)",
      "z-index:999999",
      "pointer-events:auto",
      "display:flex",
      "flex-direction:column",
      "gap:4px",
      "font-size:12px",
    ].join(";"),
  );

  const headerStyle = [
    "background:rgba(15,23,42,.92)",
    "color:#e5e7eb",
    "border:1px solid #334155",
    "border-radius:20px",
    "padding:5px 10px",
    "box-shadow:0 4px 14px rgba(0,0,0,.35)",
    "display:flex",
    "align-items:center",
    "gap:6px",
    "flex-wrap:wrap",
  ].join(";");

  const btnStyle = [
    "background:#1f2937",
    "color:#e5e7eb",
    "border:1px solid #475569",
    "border-radius:999px",
    "font-size:11px",
    "padding:2px 8px",
    "cursor:pointer",
  ].join(";");

  header.innerHTML = `
    <div style="${headerStyle}">
      <span style="font-weight:700;">magic_digest</span>

      <input id="magic-digest-card-search"
        type="text"
        placeholder="搜索卡片..."
        style="background:#0f172a;color:#e2e8f0;border:1px solid #475569;border-radius:12px;font-size:11px;padding:2px 8px;width:120px;outline:none;"
      />

      <button id="magic-digest-collapse-all"
        style="${btnStyle}" title="折叠全部卡片">
        折叠
      </button>
      <button id="magic-digest-expand-all"
        style="${btnStyle}" title="展开全部卡片">
        展开
      </button>

      <span style="color:#475569;">|</span>

      <button id="magic-digest-toggle-unresolved-cards"
        style="${btnStyle}">
        未定位
      </button>
      <button id="magic-digest-toggle-connector-style"
        style="${btnStyle}" title="连线：折线⇄直线">
        折线
      </button>
      <button id="magic-digest-export-diagnostics"
        style="${btnStyle}" title="诊断">
        Diag
      </button>
      <button id="magic-digest-close-floating-layer"
        style="${btnStyle}">
        关闭
      </button>
    </div>

    <div id="magic-digest-type-filters"
      style="${headerStyle} gap:3px;">
      <span style="color:#94a3b8;font-size:10px;">类型：</span>
      <button class="magic-digest-type-btn" data-type="background" style="${btnStyle}">背景</button>
      <button class="magic-digest-type-btn" data-type="method" style="${btnStyle}">方法</button>
      <button class="magic-digest-type-btn" data-type="result" style="${btnStyle}">结果</button>
      <button class="magic-digest-type-btn" data-type="insight" style="${btnStyle}">启发</button>
      <button class="magic-digest-type-btn" data-type="figure" style="${btnStyle}">图表</button>
      <button class="magic-digest-type-btn" data-type="table" style="${btnStyle}">表格</button>
      <button class="magic-digest-type-btn" data-type="term" style="${btnStyle}">术语</button>
      <button class="magic-digest-type-btn" data-type="limitation" style="${btnStyle}">局限</button>
      <button class="magic-digest-type-btn" data-type="comparison" style="${btnStyle}">对比</button>
      <button class="magic-digest-type-btn" data-type="quote" style="${btnStyle}">引用</button>
      <button id="magic-digest-reset-type-filter" style="${btnStyle};background:#3b0764;">全部</button>
    </div>
  `;

  overlay.appendChild(header);

  header.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;

    if (target.closest("#magic-digest-close-floating-layer")) {
      clearOverlay(doc);
      return;
    }

    if (target.closest("#magic-digest-toggle-connector-style")) {
      ev.preventDefault();
      ev.stopPropagation();

      const currentStyle = readConnectorStyle(reader, doc);
      const newStyle: "polyline" | "straight" = currentStyle === "polyline" ? "straight" : "polyline";
      writeConnectorStyle(reader, doc, newStyle);

      const btn = target.closest("#magic-digest-toggle-connector-style") as HTMLButtonElement;
      if (btn) {
        btn.textContent = newStyle === "polyline" ? "折线" : "直线";
      }

      updateConnectors(reader, doc);
      return;
    }

    if (target.closest("#magic-digest-toggle-unresolved-cards")) {
      ev.preventDefault();
      ev.stopPropagation();

      const currentUnresolvedCount = (state.analysis?.pageCards || []).reduce((sum, pc) => {
        const cards = [...(pc.left || []), ...(pc.right || [])];
        return sum + cards.filter((card) => isUnresolvedCard(card)).length;
      }, 0);

      if (currentUnresolvedCount <= 0) {
        new ztoolkit.ProgressWindow("magic_digest", {
          closeOnClick: true,
          closeTime: 1800,
        })
          .createLine({
            text: "没有未定位卡片可隐藏",
            type: "default",
            progress: 100,
          })
          .show();
        return;
      }

      const next = !(hideUnresolvedByDocument.get(doc) === true);
      hideUnresolvedByDocument.set(doc, next);
    writeReaderBooleanPreference(reader, doc, "hideUnresolved", next);

      if (state.analysis) {
        buildCardsForOverlay(reader, doc, state.analysis);
        attachPositionListeners(reader, doc);
        positionCards(reader, doc);
      }

      return;
    }

    // 类型筛选按钮
    if (target.closest(".magic-digest-type-btn")) {
      ev.preventDefault();
      ev.stopPropagation();

      const btn = target.closest(".magic-digest-type-btn") as HTMLButtonElement;
      const type = btn?.dataset?.type;

      if (type === activeTypeFilter) {
        // 再次点击取消筛选
        activeTypeFilter = null;
      } else {
        activeTypeFilter = type || null;
      }

      // 更新按钮高亮
      const allTypeBtns = header.querySelectorAll(".magic-digest-type-btn");
      allTypeBtns.forEach((b: any) => {
        b.style.background = (b as HTMLElement).dataset.type === activeTypeFilter
          ? "#7c3aed"
          : "#1f2937";
      });

      const searchInput = header.querySelector("#magic-digest-card-search") as HTMLInputElement;
      applyCardFilter(doc, searchInput?.value || "");
      return;
    }

    // 重置类型筛选
    if (target.closest("#magic-digest-reset-type-filter")) {
      ev.preventDefault();
      ev.stopPropagation();

      activeTypeFilter = null;

      const allTypeBtns = header.querySelectorAll(".magic-digest-type-btn");
      allTypeBtns.forEach((b: any) => {
        (b as HTMLElement).style.background = "#1f2937";
      });

      const searchInput = header.querySelector("#magic-digest-card-search") as HTMLInputElement;
      if (searchInput) searchInput.value = "";
      applyCardFilter(doc, "");
      return;
    }

    // 折叠全部
    if (target.closest("#magic-digest-collapse-all")) {
      ev.preventDefault();
      ev.stopPropagation();

      globalCollapsedByDocument.set(doc, true);
      getCollapsedSet(doc).clear();
      writeCollapsedStatePreference(reader, doc);
      buildCardsForOverlay(reader, doc, state.analysis!);
      attachPositionListeners(reader, doc);
      positionCards(reader, doc);
      return;
    }

    // 展开全部
    if (target.closest("#magic-digest-expand-all")) {
      ev.preventDefault();
      ev.stopPropagation();

      globalCollapsedByDocument.set(doc, false);
      getCollapsedSet(doc).clear();
      writeCollapsedStatePreference(reader, doc);
      buildCardsForOverlay(reader, doc, state.analysis!);
      attachPositionListeners(reader, doc);
      positionCards(reader, doc);
      return;
    }
  });

  // 搜索框输入事件
  const searchInput = header.querySelector("#magic-digest-card-search") as HTMLInputElement;
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      applyCardFilter(doc, searchInput.value);
    });
  }

  const unresolvedCardsCount = (analysis.pageCards || []).reduce((sum, pc) => {
    const cards = [...(pc.left || []), ...(pc.right || [])];
    return sum + cards.filter((card) => isUnresolvedCard(card)).length;
  }, 0);

  const unresolvedStatus = header.querySelector(
    "#magic-digest-unresolved-status",
  ) as HTMLElement | null;

  const hideUnresolvedActive = hideUnresolvedByDocument.get(doc) === true;
  const connectorStyleBtnAtBuild = header.querySelector(
    "#magic-digest-toggle-connector-style",
  ) as HTMLButtonElement | null;

  if (connectorStyleBtnAtBuild) {
    const savedStyle = readConnectorStyle(reader, doc);
    connectorStyleBtnAtBuild.textContent = savedStyle === "polyline" ? "折线" : "直线";
  }

  const unresolvedToggleBtnAtBuild = header.querySelector(
    "#magic-digest-toggle-unresolved-cards",
  ) as HTMLButtonElement | null;

  if (unresolvedToggleBtnAtBuild) {
    unresolvedToggleBtnAtBuild.textContent = hideUnresolvedActive
      ? "显示未定位"
      : "隐藏未定位";
  }

  if (unresolvedStatus) {
    unresolvedStatus.textContent =
      unresolvedCardsCount > 0
        ? `未定位：${unresolvedCardsCount}，可一键隐藏`
        : "全部卡片已定位或已自动匹配";
  }

  const unresolvedToggleButton = header.querySelector(
    "#magic-digest-toggle-unresolved-cards",
  ) as HTMLButtonElement | null;

  if (unresolvedToggleButton) {
    if (unresolvedCardsCount <= 0) {
      unresolvedToggleButton.textContent = "无未定位";
      unresolvedToggleButton.disabled = true;
      unresolvedToggleButton.style.opacity = "0.55";
      unresolvedToggleButton.style.cursor = "not-allowed";
    } else {
      unresolvedToggleButton.disabled = false;
      unresolvedToggleButton.style.opacity = "1";
      unresolvedToggleButton.style.cursor = "pointer";
      unresolvedToggleButton.textContent =
        hideUnresolvedByDocument.get(doc) === true ? "显示未定位" : "隐藏未定位";
    }
  }

  const closeBtn = header.querySelector(
    "#magic-digest-close-floating-layer",
  ) as HTMLButtonElement | null;

  closeBtn?.addEventListener("click", () => {
    writeReaderBooleanPreference(reader, doc, "overlayOpen", false);
    clearOverlay(doc);
  });

  
  const diagnosticsBtn = header.querySelector(
    "#magic-digest-export-diagnostics",
  ) as HTMLButtonElement | null;

  diagnosticsBtn?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    exportReaderDiagnostics(reader, doc, analysis).catch((e) => {
      showReaderDiagnosticsResult(
        false,
        "Failed to copy diagnostics: " + (e?.message || String(e)),
      );
    });
  });

const pageCards = analysis.pageCards || [];
  const overlayDuplicateKeys = new Set<string>();
  let hiddenDuplicateCardsCount = 0;

  for (const pc of pageCards) {
    const page = Math.max(0, Math.floor(Number(pc.page || 0)));

    // 合并左右卡片，自动检测单/双栏并分配侧边
    const mergedCards: { card: MagicDigestCard; origSide: "left" | "right" }[] = [];
    (pc.left || []).forEach((card) => mergedCards.push({ card, origSide: "left" }));
    (pc.right || []).forEach((card) => mergedCards.push({ card, origSide: "right" }));

    const cardsForLayout = mergedCards.map((m) => m.card);
    const columnLayout = detectPageColumnLayoutForCards(cardsForLayout);

    const add = (
      card: MagicDigestCard,
      side: "left" | "right",
      index: number,
    ) => {
      if (shouldHideCardInCurrentOverlay(doc, card)) {
        return;
      }

      const duplicateKey = getOverlayDuplicateCardKey(page, card);
      if (overlayDuplicateKeys.has(duplicateKey)) {
        hiddenDuplicateCardsCount++;
        return;
      }
      overlayDuplicateKeys.add(duplicateKey);

      const el = doc.createElement("div");
      el.className = "magic-digest-floating-card";
      el.dataset.cardId = card.id;
      el.dataset.page = String(page);
      el.dataset.side = side;

      const color = cardTypeColor(card.type);

      el.setAttribute(
        "style",
        [
          "position:fixed",
          `width:${CARD_WIDTH}px`,
          "min-height:62px",
          "max-height:260px",
          "overflow:hidden",
          "background:rgba(241,245,249,.90)",
          "backdrop-filter:blur(4px)",
          "-moz-backdrop-filter:blur(4px)",
          "border:1px solid rgba(148,163,184,.75)",
          `border-left:4px solid ${color}`,
          "border-radius:3px",
          "padding:8px",
          "box-shadow:0 2px 10px rgba(15,23,42,.22)",
          "z-index:999999",
          "pointer-events:auto",
          "cursor:pointer",
          "transition:transform .12s ease, box-shadow .12s ease, opacity .12s ease",
          "opacity:.96",
        ].join(";"),
      );

      el.innerHTML = renderFloatingCardHTML(card, doc);
      enhanceCardBodyLayout(el, card, doc);

      const deleteBtn = doc.createElement("button");
      deleteBtn.className = "magic-digest-delete-card-btn";
      deleteBtn.textContent = "删除";
      deleteBtn.title = "删除卡片";
      deleteBtn.setAttribute(
        "style",
        [
          "position:absolute",
          "right:81px",
          "top:5px",
          "background:rgba(185,28,28,.85)",
          "color:#fff",
          "border:0",
          "border-radius:4px",
          "font-size:10px",
          "padding:1px 5px",
          "cursor:pointer",
          "z-index:2",
        ].join(";"),
      );

      deleteBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        deleteCardAndRefresh({
          reader,
          doc,
          card,
        }).catch((e) => {
          new ztoolkit.ProgressWindow("magic_digest", {
            closeOnClick: true,
            closeTime: 8000,
          })
            .createLine({
              text: "删除卡片失败：" + (e?.message || String(e)),
              type: "fail",
              progress: 100,
            })
            .show();
        });
      });

      el.appendChild(deleteBtn);

      // 独立绑定折叠/展开按钮，避免事件委托失效
      const collapseBtn = el.querySelector(
        ".magic-digest-collapse-card-btn",
      ) as HTMLButtonElement | null;

      collapseBtn?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        toggleCardCollapsed(doc, card);
        writeCollapsedStatePreference(reader, doc);

        // 重建整个卡片层，确保按钮、删除、编辑、连接线和防重叠布局全部重新绑定
        buildCardsForOverlay(reader, doc, state.analysis!);
        attachPositionListeners(reader, doc);
        positionCards(reader, doc);
      });

      // 独立绑定编辑按钮，避免事件委托失效
      const editBtn = el.querySelector(
        ".magic-digest-edit-card-btn",
      ) as HTMLButtonElement | null;

      editBtn?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        openEditDialog({
          reader,
          doc,
          card,
        });
      });


      let hoverTimer: number | null = null;

      el.addEventListener("mouseenter", () => {
        el.style.transform = "translateY(-2px)";
        el.style.boxShadow = "0 6px 18px rgba(15,23,42,.35)";
        el.style.opacity = "1";

        const win = doc.defaultView;
        if (win && !isUnresolvedCard(card)) {
          hoverTimer = win.setTimeout(() => {
            showPersistentHighlight(reader, doc, card);
          }, HOVER_DELAY);
        }
      
        setConnectorHoverState(doc, getCardStableKey(card), true);
      });

      el.addEventListener("mouseleave", () => {
        el.style.transform = "";
        el.style.boxShadow = "0 2px 10px rgba(15,23,42,.22)";
        el.style.opacity = ".96";

        if (hoverTimer !== null) {
          doc.defaultView?.clearTimeout(hoverTimer);
          hoverTimer = null;
        }

        clearPersistentHighlight(doc);
      
        setConnectorHoverState(doc, getCardStableKey(card), false);
      });

      el.addEventListener("click", (ev) => {
        const target = ev.target as HTMLElement | null;

        if (
          target?.closest(
            "button,input,textarea,select,a,.magic-digest-edit-card-btn,.magic-digest-collapse-card-btn,.magic-digest-delete-card-btn",
          )
        ) {
          return;
        }

        ev.preventDefault();
        ev.stopPropagation();

        // 锁定卡片位置，跳转期间不让 positionCards 移动它
        let lockedSet = jumpLockedElByDocument.get(doc);
        if (!lockedSet) {
          lockedSet = new Set();
          jumpLockedElByDocument.set(doc, lockedSet);
        }
        lockedSet.add(el);

        jumpToCard(reader, doc, card);

        // 跳转动画结束后解锁（约 1.5 秒）
        setTimeout(() => {
          const set = jumpLockedElByDocument.get(doc);
          if (set) {
            set.delete(el);
          }
        }, 1500);
      });

      overlay.appendChild(el);

      state.cards.push({
        card,
        page,
        side,
        index,
        el,
        hoverTimer,
      });

      const pushedItem = state.cards[state.cards.length - 1];
      enableMinimalDragForCard(reader, doc, pushedItem, index);
    };

    mergedCards.forEach(({ card, origSide }, index) => {
      const autoSide = assignAutoSide(card, columnLayout, index, origSide);
      add(card, autoSide, index);
    });
  }

  if (hiddenDuplicateCardsCount > 0) {
    const status = header.querySelector(
      "#magic-digest-unresolved-status",
    ) as HTMLElement | null;

    if (status) {
      const currentStatus = String(status.textContent || "");
      const suffix = " · hidden duplicates: " + String(hiddenDuplicateCardsCount);

      if (!currentStatus.includes("hidden duplicates:")) {
        status.textContent = currentStatus + suffix;
      }
    }
  }

}

function attachPositionListeners(reader: any, doc: Document) {
  const state = getOrCreateState(doc);
  const ctx = getPDFContext(reader, doc);

  const schedulePosition = () => {
    if (!state.active) return;
    const win = doc.defaultView;
    if (win?.requestAnimationFrame) {
      win.requestAnimationFrame(() => positionCards(reader, doc));
    } else {
      setTimeout(() => positionCards(reader, doc), 16);
    }
  };

  const add = (
    target: EventTarget | null | undefined,
    type: string,
    listener: EventListener,
  ) => {
    if (!target) return;
    target.addEventListener(type, listener, {
      passive: true,
    } as AddEventListenerOptions);
    state.cleanup.push(() => {
      try {
        target.removeEventListener(type, listener);
      } catch {
        // ignore
      }
    });
  };

  add(doc.defaultView, "resize", schedulePosition);
  add(doc.defaultView, "scroll", schedulePosition);

  if (ctx) {
    add(ctx.pdfWin, "resize", schedulePosition);
    add(ctx.pdfWin, "scroll", schedulePosition);
    add(ctx.viewerContainer, "scroll", schedulePosition);

    try {
      add(ctx.pdfWin.document, "scalechanging", schedulePosition);
      add(ctx.pdfWin.document, "pagerendered", schedulePosition);
      add(ctx.pdfWin.document, "pagesinit", schedulePosition);
      add(ctx.pdfWin.document, "updateviewarea", schedulePosition);
    } catch {
      // ignore
    }
  }

  setTimeout(schedulePosition, 50);
  setTimeout(schedulePosition, 300);
  setTimeout(schedulePosition, 900);
}

async function toggleViberoOverlay(reader: any, doc: Document) {
  const state = getOrCreateState(doc);

  if (state.active) {
    writeReaderBooleanPreference(reader, doc, "overlayOpen", false);
    clearOverlay(doc);
    return;
  }

  const attachmentItemID = getReaderAttachmentItemID(reader);

  if (!attachmentItemID) {
    new ztoolkit.ProgressWindow("magic_digest", {
      closeOnClick: true,
      closeTime: 6000,
    })
      .createLine({
        text: "无法识别当前 PDF 附件 itemID",
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  let analysis = await readAnalysisFile(attachmentItemID);
  analysis = await mergeFigureAnalysisIntoAnalysis(attachmentItemID, analysis);
  analysis = await mergeBlockFirstCardsIntoAnalysis(attachmentItemID, analysis);

  if (!analysis) {
    new ztoolkit.ProgressWindow("magic_digest", {
      closeOnClick: true,
      closeTime: 7000,
    })
      .createLine({
        text: `未找到 analysis.json，请先生成全文结构化分析。itemID=${attachmentItemID}`,
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  const ctx = getPDFContext(reader, doc);
  if (!ctx) {
    new ztoolkit.ProgressWindow("magic_digest", {
      closeOnClick: true,
      closeTime: 7000,
    })
      .createLine({
        text: "未找到 PDFViewerApplication，无法定位 PDF 页面",
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  state.active = true;
  writeReaderBooleanPreference(reader, doc, "overlayOpen", true);
  state.analysis = analysis;
  state.attachmentItemID = attachmentItemID;

  // 自动定位未解析的卡片
  const autoLocated = autoLocateUnresolvedCards(reader, doc, analysis);

  readCollapsedStatePreference(reader, doc);

  const savedHideUnresolvedPreference = readReaderBooleanPreference(reader, doc, "hideUnresolved");
  if (savedHideUnresolvedPreference !== null) {
    hideUnresolvedByDocument.set(doc, savedHideUnresolvedPreference);
  }

  buildCardsForOverlay(reader, doc, analysis);
  attachPositionListeners(reader, doc);
  positionCards(reader, doc);

  new ztoolkit.ProgressWindow("magic_digest", {
    closeOnClick: true,
    closeTime: 3500,
  })
    .createLine({
      text: "magic_digest 卡片层已开启 ✅",
      type: "success",
      progress: 100,
    })
    .show();
}

export function registerReaderIntegration() {
  if (registered) return;

  function addLangToggleButton(doc: Document, container: HTMLElement) {
    if (doc.getElementById("magic-digest-lang-toggle")) return;

    const langPrefKey = "extensions.zotero.my_vibero.analysisLanguage";
    const getLang = () => {
      try {
        const v = String(Zotero.Prefs.get(langPrefKey, true) || "").trim();
        return v === "en" ? "en" : "zh";
      } catch {
        return "zh";
      }
    };

    const langBtn = doc.createElement("button");
    langBtn.id = "magic-digest-lang-toggle";
    const update = () => {
      langBtn.textContent = getLang() === "en" ? "EN" : "中";
      langBtn.title = getLang() === "en" ? "Switch to Chinese analysis" : "切换为英文分析";
    };
    update();

    langBtn.setAttribute(
      "style",
      [
        "font-size:12px",
        "padding:3px 8px",
        "margin-left:4px",
        "border-radius:6px",
        "border:1px solid #475569",
        "background:#1e293b",
        "color:#e2e8f0",
        "cursor:pointer",
      ].join(";"),
    );

    langBtn.addEventListener("click", () => {
      try {
        const next = getLang() === "en" ? "zh" : "en";
        Zotero.Prefs.set(langPrefKey, next, true);
        update();
      } catch {
        // ignore
      }
    });

    container.insertBefore(langBtn, container.firstChild);
  }

  try {
    const Reader = (Zotero as any).Reader;

    if (!Reader || typeof Reader.registerEventListener !== "function") {
      ztoolkit.log("magic_digest: Reader.registerEventListener not available");
      return;
    }

    toolbarHandler = (event: any) => {
      const { reader, doc, append } = event || {};

      if (!doc || !append) {
        ztoolkit.log("magic_digest: renderToolbar event missing doc or append");
        return;
      }

      const existingContainer = doc.getElementById("magic-digest-toolbar-button");
      if (existingContainer && doc.getElementById("magic-digest-lang-toggle")) {
        return; // 已有语言按钮，无需重渲染
      }

      if (existingContainer) {
        // 工具栏已存在，只需追加语言按钮
        addLangToggleButton(doc, existingContainer);
        return;
      }

      const container = doc.createElement("div");
      container.id = "magic-digest-toolbar-button";
      container.setAttribute(
        "style",
        "display:inline-flex;align-items:center;margin-left:6px;",
      );

      const btn = doc.createElement("button");
      btn.textContent = "magic_digest";
      btn.title = "显示/隐藏 magic_digest PDF 卡片层";
      btn.setAttribute(
        "style",
        [
          "font-size:12px",
          "padding:3px 8px",
          "border-radius:6px",
          "border:1px solid #475569",
          "background:#0f172a",
          "color:#e2e8f0",
          "cursor:pointer",
        ].join(";"),
      );

      btn.addEventListener("click", () => {
        toggleViberoOverlay(reader, doc).catch((e) => {
          new ztoolkit.ProgressWindow("magic_digest", {
            closeOnClick: true,
            closeTime: 8000,
          })
            .createLine({
              text: `magic_digest 卡片层打开失败：${e?.message || String(e)}`,
              type: "fail",
              progress: 100,
            })
            .show();
        });
      });

      addLangToggleButton(doc, container);

      container.appendChild(btn);
      append(container);

      if (!autoRestoreAttemptedByDocument.get(doc)) {
        autoRestoreAttemptedByDocument.set(doc, true);

        const shouldRestoreOverlay =
          readReaderBooleanPreference(reader, doc, "overlayOpen") === true;

        if (shouldRestoreOverlay) {
          const win = doc.defaultView;
          const restore = () => {
            const state = getOrCreateState(doc);
            if (!state.active) {
              toggleViberoOverlay(reader, doc).catch((e) => {
                ztoolkit.log("magic_digest auto restore overlay failed", e);
              });
            }
          };

          if (win) {
            win.setTimeout(restore, 600);
          } else {
            setTimeout(restore, 600);
          }
        }
      }

      ztoolkit.log("magic_digest: toolbar button appended");
    };

    Reader.registerEventListener(
      "renderToolbar",
      toolbarHandler,
      getPluginID(),
    );

    registered = true;

    ztoolkit.log("magic_digest: reader integration registered renderToolbar");
  } catch (e) {
    ztoolkit.log("magic_digest: registerReaderIntegration error", e);
  }
}

export function unregisterReaderIntegration() {
  if (!registered) return;

  try {
    const Reader = (Zotero as any).Reader;

    if (Reader?.unregisterEventListener && toolbarHandler) {
      Reader.unregisterEventListener(
        "renderToolbar",
        toolbarHandler,
        getPluginID(),
      );
    }
  } catch (e) {
    ztoolkit.log("magic_digest: unregisterReaderIntegration error", e);
  }

  toolbarHandler = null;
  registered = false;
}