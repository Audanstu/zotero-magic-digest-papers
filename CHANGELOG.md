# Changelog

## v1.0.0 (2026-05-24)

### Core Features
- **AI Structured Analysis** — Full paper analysis with DeepSeek, generating insight cards (background, method, result, figure, table, term, limitation, comparison, quote)
- **Vision Figure Analysis** — Multimodal figure/chart analysis with Volcengine Ark and Qwen VL
- **Smart Anchor Positioning** — Cards placed next to source text using layout analysis + fuzzy text matching
- **Auto Column Detection** — Automatic single/double-column PDF layout detection

### Card Interaction
- Search/filter by keyword and type
- Batch collapse/expand all
- Drag to reposition with ↔ handle
- Double-click to reset position
- Connector lines (straight/polyline toggle)
- Click to jump to anchor, card stays locked during jump
- Delete individual cards

### Multi-Model Support
- DeepSeek (text analysis)
- Volcengine Ark (text + vision)
- Qwen VL / OpenAI-compatible (vision)
- Unified chat router with automatic provider dispatch

### Performance
- Parallel chunk processing (3x faster analysis)
- Optimized vision prompt with image compression + retry

### Polish
- Custom plugin icon
- Full preference pane with model configuration
- Progress indicators for all operations
- Error recovery with automatic retry
- Clean codebase (removed 282 backup files, zero hardcoded paths)

### Distribution
- Auto-update support via update.json
- AGPL-3.0 licensed
