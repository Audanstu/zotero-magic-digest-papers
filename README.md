# magic-digest

> [中文说明](README-zhCN.md)

AI-powered academic paper reading assistant for Zotero.

Deep PDF integration with structured floating cards, vision figure analysis, and smart anchor positioning — all inside your PDF reader.

## Features

- **AI Structured Analysis** — Reads your paper page-by-page and generates insight cards (background, method, result, figure, table, term, limitation, comparison, quote)
- **Vision Figure Analysis** — Analyzes figures/charts/tables with multimodal AI (supports Volcengine & Qwen vision models)
- **Smart Anchor Positioning** — Cards are placed directly next to their source text in the PDF using layout analysis
- **Auto Column Detection** — Automatically detects single/double-column PDF layouts
- **Card Filter & Search** — Real-time keyword search and type-based filtering
- **Batch Operations** — Collapse/expand all, hide unresolved cards
- **Connector Lines** — Visual links between cards and their anchor positions
- **Drag to Reposition** — Manually adjust card positions
- **Multi-Model Support** — DeepSeek, Volcengine, Qwen, and OpenAI-compatible APIs

## Requirements

- Zotero 7+
- **[llm-for-zotero](https://github.com/secretwords/llm-for-zotero)** — required for MinerU PDF layout parsing
- At least one AI API key:
  - DeepSeek API key (for text analysis)
  - Volcengine Ark API key (for vision analysis)
  - Qwen DashScope API key (for vision analysis)

## Installation

1. Download `magic-digest.xpi` from [Releases](https://github.com/Audanstu/zotero-magic-digest/releases)
2. Open Zotero → Tools → Add-ons → gear icon → Install Add-on From File
3. Select the XPI file

## Setup

1. Go to Edit → Settings → magic-digest
2. Add a model configuration:
   - **For text analysis**: DeepSeek (provider: openai-compatible, base: `https://api.deepseek.com`)
   - **For vision analysis**: Volcengine Ark (provider: volcengine-responses) or Qwen VL (provider: openai-compatible)
3. Set your default text model and default vision model
4. Test the connection

## Usage

### Quick Start

**Prerequisite:** First use **llm-for-zotero** to run MinerU analysis on your PDF (right-click → llm-for-zotero → MinerU 解析).

Right-click menu:

| Menu | Purpose |
|------|---------|
| ✨ 生成全文结构化分析 | Main analysis: generates all insight cards |
| ✨ 解析论文图表 | Vision analysis for all figures/tables |
| ✨ 生成双语阅读卡 | Bilingual reading card draft |
| ✨ 基于 Layout 重新生成定位卡片 | Regenerate card anchor positions |

1. Select a PDF attachment or its parent item in Zotero
2. Right-click → `magic-digest ✨：生成全文结构化分析`
3. Wait for the analysis to complete
4. Open the PDF and click the `my_vibero` button in the top-right toolbar
5. Cards appear overlaid on the PDF, positioned next to their source text

### Card Operations

| Action | How |
|--------|-----|
| Click card | Jump to anchor position |
| Drag handle (↕) | Reposition card |
| Double-click card | Reset to auto position |
| Collapse/Expand | Click ▼/▶ button on card |
| Search | Type in the search bar at top |
| Type filter | Click type buttons (背景/方法/结果...) |
| Collapse all | Click "折叠" button |
| Delete card | Click × on card |

## Data Storage

All analysis data is stored in Zotero's data directory under `magic-digest-data/{attachmentID}/`:

- `analysis.json` — Structured card data
- `vision.json` — Vision figure analysis results
- `reading-card-draft.md` — Reading card draft
- `anchor-index-layout.json` — Anchor position index

## Build from Source

```bash
npm install
npm run build
# XPI output: .scaffold/build/magic-digest.xpi
```

## Credits

This plugin was developed with assistance from the **DeepSeek** AI model for code generation and design.

## License

AGPL-3.0-or-later

---

**Contributions welcome!** Feel free to open issues, submit PRs, or share your ideas — let's make magic-digest better together.

---

**Notice:** Please respect the author's work. Commercial use is not permitted without prior authorization. For commercial licensing, please contact via QQ: **2472932478** (state your purpose clearly).
