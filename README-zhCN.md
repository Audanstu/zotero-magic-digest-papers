# magic-digest

AI 驱动的 Zotero 学术论文阅读助手。

在 PDF 阅读器中直接生成结构化浮动卡片，支持图表视觉分析、智能锚点定位。

## 功能

- **AI 结构化分析** — 逐页分析论文，生成洞察卡片（背景、方法、结果、图表、术语、局限、对比、引用）
- **图表视觉分析** — 用多模态 AI 分析论文中的图表（支持火山引擎 & 千问视觉模型）
- **智能锚点定位** — 卡片精确贴在 PDF 原文旁边，基于版面分析 + 模糊文本匹配
- **自动单双栏检测** — 自动识别 PDF 的栏式布局
- **卡片搜索筛选** — 实时关键词搜索 + 按类型过滤
- **批量操作** — 一键折叠/展开全部，隐藏未定位卡片
- **连线定位** — 卡片与锚点之间的可视化连线
- **拖动调整** — 手动拖拽卡片位置
- **多模型支持** — DeepSeek、火山引擎、千问、OpenAI 兼容 API

## 安装要求

- Zotero 7+
<<<<<<< HEAD
- **[llm-for-zotero](https://github.com/secretwords/llm-for-zotero)** 插件 — 用于 MinerU PDF 版面解析（必须先安装）
=======
- 需搭配llm-for-zotero插件来使用
>>>>>>> 5753c6d0f1f8da6d4250b1da9c22f9fef29c5479
- 至少一个 AI API Key：
  - DeepSeek（文本分析）
  - 火山引擎 Ark（文本 + 视觉分析）
  - 千问 DashScope（视觉分析）

## 安装

1. 从 [Releases](https://github.com/Audanstu/zotero-magic-digest/releases) 下载 `magic-digest.xpi`
2. Zotero → 工具 → 附加组件 → 齿轮 → 从文件安装附加组件
3. 选择 XPI 文件

## 配置

1. 编辑 → 设置 → magic-digest
2. 添加模型配置：
   - **文本分析**：DeepSeek（提供商：openai-compatible，地址：`https://api.deepseek.com`）
   - **视觉分析**：火山引擎 Ark 或千问 VL
3. 分别设为默认文本模型和默认视觉模型
4. 点 Test 按钮测试连通性

## 使用

### 快速开始

**前提：** 先用 **llm-for-zotero** 对 PDF 执行 MinerU 解析（右键 → llm-for-zotero → MinerU 解析）。

1. 在 Zotero 中选中一个 PDF 附件或其父条目
2. 右键 → `magic-digest ✨：生成全文结构化分析`
3. 等待分析完成（约 1-2 分钟）
4. 打开 PDF，点右上角工具栏的 `my_vibero` 按钮
5. 卡片浮现在 PDF 上方，定位在原文旁边

### 卡片操作

| 操作 | 方法 |
|------|------|
| 点击卡片 | 跳转到锚点位置 |
| 拖动 ↕ 手柄 | 调整卡片位置 |
| 双击卡片 | 恢复到自动位置 |
| 折叠/展开 | 点卡片上的 ▼/▶ 按钮 |
| 搜索 | 在顶部搜索框输入关键词 |
| 类型过滤 | 点类型按钮（背景/方法/结果...） |
| 折叠全部 | 点"折叠"按钮 |
| 删除卡片 | 点卡片上的 × |

## 数据存储

所有分析数据存储在 Zotero 数据目录下的 `magic-digest-data/{附件ID}/`：

- `analysis.json` — 结构化卡片数据
- `vision.json` — 视觉图表分析结果
- `reading-card-draft.md` — 阅读卡片草稿

## 制作说明

本插件的部分代码和设计由 **DeepSeek** AI 模型辅助完成。

## 开源协议

AGPL-3.0-or-later

---

**欢迎协作！** 欢迎提交 Issue、PR 或分享你的想法，一起把 magic-digest 做得更好。
