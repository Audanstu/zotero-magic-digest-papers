import { readAnalysisFile, getMagicDigestPaperDir } from "./magicDigestAnalysisCache";
import { ensureDir, writeTextFile } from "./fileUtils";

function escapeHTML(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function renderCard(
  card: import("./analysisSchema").MagicDigestCard,
): string {
  const color = cardTypeColor(card.type);
  const tags = Array.isArray(card.tags) ? card.tags : [];
  const tagHTML = tags
    .map(
      (t: string) =>
        `<span style="background:#233554;color:#64ffda;font-size:10px;padding:2px 6px;border-radius:4px;margin-right:4px;">${escapeHTML(t)}</span>`,
    )
    .join(" ");

  const editedFlag = card.content.edited
    ? '<span style="background:#e94560;color:#fff;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:6px;">已编辑</span>'
    : "";

  const displayText = card.content.edited
    ? card.content.userEdited
    : card.content.aiOriginal;

  return `
    <div style="background:#0a192f;border-radius:6px;padding:12px;margin-bottom:10px;box-shadow:0 2px 8px rgba(0,0,0,0.3);border-left:4px solid ${color};">
      <div style="margin-bottom:6px;">
        <span style="background:${color};color:#fff;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:bold;">${escapeHTML(card.type)}</span>
        <span style="font-weight:600;font-size:14px;color:#e6f1ff;margin-left:8px;">${escapeHTML(card.title || "")}</span>
        ${editedFlag}
      </div>
      <div style="font-style:italic;color:#8892b0;font-size:12px;margin-bottom:4px;">${escapeHTML(card.anchorText || "")}</div>
      <div style="font-size:13px;line-height:1.5;color:#a8b2d1;white-space:pre-wrap;">${escapeHTML(displayText || "")}</div>
      <div style="margin-top:8px;">${tagHTML}</div>
    </div>
  `;
}

function buildHTML(
  analysis: import("./analysisSchema").MagicDigestAnalysis,
  attachmentItemID: number,
): string {
  const gp = analysis.globalPanel;
  const pageCards = analysis.pageCards || [];

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>magic_digest 阅读工作台</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      min-height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
    }

    body {
      overflow: hidden;
    }

    #left-panel {
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      width: 320px;
      background: #16213e;
      border-right: 1px solid #2a2a4a;
      overflow-y: auto;
      padding: 20px;
      box-sizing: border-box;
    }

    #right-panel {
      position: fixed;
      left: 320px;
      top: 0;
      bottom: 0;
      right: 0;
      background: #1a1a2e;
      overflow-y: auto;
      padding: 20px;
      box-sizing: border-box;
    }

    .section-title {
      color: #a8b2d1;
      font-size: 14px;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .section-text {
      font-size: 13px;
      line-height: 1.6;
      color: #ccd6f6;
      margin-bottom: 18px;
      white-space: pre-wrap;
    }

    .section-list {
      list-style: disc;
      padding-left: 18px;
      font-size: 13px;
      line-height: 1.6;
      color: #ccd6f6;
      margin-bottom: 18px;
    }

    .page-group {
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 1px solid #2a2a4a;
    }

    .page-title {
      color: #8892b0;
      font-size: 16px;
      margin-bottom: 12px;
    }

    .card-columns {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .column-label {
      font-size: 12px;
      color: #5a6785;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .empty-text {
      color: #5a6785;
      font-style: italic;
      font-size: 13px;
    }

    h2 {
      color: #e94560;
      margin-bottom: 20px;
      font-size: 18px;
    }
  </style>
</head>
<body>
  <div id="left-panel">
    <h2>📄 magic_digest 阅读工作台</h2>

    <div class="section-title">附件 itemID</div>
    <div class="section-text">${attachmentItemID}</div>

    <div class="section-title">一句话总结</div>
    <div class="section-text">${escapeHTML(gp.titleCard.aiOriginal || "未生成")}</div>

    <div class="section-title">研究背景与问题</div>
    <div class="section-text">${escapeHTML(gp.backgroundAndProblem.aiOriginal || "")}</div>

    <div class="section-title">核心创新点</div>
    <ul class="section-list">${gp.coreInnovations
      .map((i) => `<li>${escapeHTML(i.aiOriginal || "")}</li>`)
      .join("")}</ul>

    <div class="section-title">方法概述</div>
    <ul class="section-list">${gp.methodOverview
      .map((m) => `<li>${escapeHTML(m.aiOriginal || "")}</li>`)
      .join("")}</ul>

    <div class="section-title">主要发现</div>
    <ul class="section-list">${gp.mainFindings
      .map((f) => `<li>${escapeHTML(f.aiOriginal || "")}</li>`)
      .join("")}</ul>

    <div class="section-title">局限性</div>
    <ul class="section-list">${gp.limitations
      .map((l) => `<li>${escapeHTML(l.aiOriginal || "")}</li>`)
      .join("")}</ul>
  </div>

  <div id="right-panel">
    <h2>📑 分页卡片</h2>
    ${pageCards
      .map(
        (pc) => `
      <div class="page-group">
        <h3 class="page-title">第 ${pc.page + 1} 页</h3>
        <div class="card-columns">
          <div>
            <div class="column-label">左侧卡片</div>
            ${
              pc.left.map((card) => renderCard(card)).join("") ||
              '<div class="empty-text">无</div>'
            }
          </div>
          <div>
            <div class="column-label">右侧卡片</div>
            ${
              pc.right.map((card) => renderCard(card)).join("") ||
              '<div class="empty-text">无</div>'
            }
          </div>
        </div>
      </div>
    `,
      )
      .join("")}
  </div>
</body>
</html>
  `.trim();
}

export async function openReadingWorkbench(
  attachmentItemID: number,
): Promise<void> {
  const analysis = await readAnalysisFile(attachmentItemID);

  if (!analysis) {
    new ztoolkit.ProgressWindow("magic_digest", {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({
        text: "未找到 analysis.json，请先生成全文结构化分析",
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  try {
    const paperDir = getMagicDigestPaperDir(attachmentItemID);
    await ensureDir(paperDir);

    const html = buildHTML(analysis, attachmentItemID);
    const htmlPath = `${paperDir}\\workbench.html`;

    await writeTextFile(htmlPath, html);

    await (Zotero as any).launchFile(htmlPath);
  } catch (e: any) {
    new ztoolkit.ProgressWindow("magic_digest", {
      closeOnClick: true,
      closeTime: 8000,
    })
      .createLine({
        text: `打开阅读工作台失败：${e?.message || String(e)}`,
        type: "fail",
        progress: 100,
      })
      .show();
  }
}