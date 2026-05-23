type ChunkPage = {
  page: number; // internal 0-based
  displayPage: number; // UI 1-based
  text: string;
};

type ChunkFigure = {
  label: string;
  path: string;
  caption: string;
  page: number;
  section: string;
};

type ChunkTable = {
  label: string;
  path: string;
  caption: string;
  page: number;
  section: string;
};

export function buildChunkPaperAnalysisPrompt(params: {
  title: string;
  chunkIndex: number;
  chunkTotal: number;
  pages: ChunkPage[];
  figures: ChunkFigure[];
  tables: ChunkTable[];
  manifestSummary: string;
}): string {
  const pageList = params.pages
    .map(
      (p) =>
        `## Page ${p.displayPage} (internal page ${p.page})\n${p.text}`,
    )
    .join("\n\n");

  const figures = params.figures
    .map(
      (f) =>
        `- ${f.label || "figure"} | page ${f.page + 1} | ${f.section || ""} | ${f.caption || ""}`,
    )
    .join("\n");

  const tables = params.tables
    .map(
      (t) =>
        `- ${t.label || "table"} | page ${t.page + 1} | ${t.section || ""} | ${t.caption || ""}`,
    )
    .join("\n");

  return `
你是科研论文结构化阅读助手。请根据下面这篇论文的一个分页分块，生成 magic_digest 使用的结构化分析 JSON。

这是第 ${params.chunkIndex + 1} / ${params.chunkTotal} 个分块。

## 核心规则（必须严格遵守）

1. 只输出 JSON，不要输出 Markdown，不要代码块，不要 \\\`\\\`\\\`json 包裹。
2. 页码必须使用内部 0-based 页码。例如 PDF 第 1 页输出 page: 0。
3. anchorText 必须是从该页原文中逐字摘录的短句（5-20 字），不能自己概括。这是用于定位的，必须是 PDF 里真实存在的文字。
4. 不要编造原文没有的信息。content 可以概括，但必须基于该页具体内容。
5. 每张卡片内容简洁、准确，适合显示在 PDF 左右边栏中（约 1-3 句话）。
6. 左侧卡片偏"理解提示"：背景、问题、概念、术语、逻辑。
7. 右侧卡片偏"结构拆解"：方法、结果、图表、表格、对比、启发、局限。

## 卡片类型说明与高质量示例

每种类型都要 anchorText 出自该页原文：

| 类型 | 用途 | anchorText 示例 | content 示例 |
|------|------|----------------|-------------|
| background | 研究背景、问题动机 | 原文中描述背景的句子 | 该背景在本页的具体体现 |
| method | 方法、技术、流程 | 原文中描述方法的名词短语 | 该方法在本页的用途和细节 |
| result | 实验结果、发现 | 原文中描述结果的句子 | 该结果的具体数据和意义 |
| insight | 启发、洞见、创新点 | 原文中关键的判断句 | 为什么这个洞见重要 |
| figure | 图片分析 | 图片标题文字 | 图片展示了什么、关键信息 |
| table | 表格分析 | 表格标题文字 | 表格数据说明了什么 |
| limitation | 局限性、不足 | 原文中描述局限的句子 | 该局限对研究的影响 |
| quote | 值得引用的原句 | 完整摘录的原句 | 这句话的价值和用途 |
| term | 专业术语解释 | 术语首次出现的原文 | 术语的定义和上下文 |
| comparison | 对比、比较 | 原文中对比的句子 | 对比双方的差异和意义 |

## importance 评分标准

- 90-100：论文核心创新点、突破性发现、关键方法
- 70-89：重要的支撑论据、主要实验、关键概念
- 50-69：辅助信息、次要发现、补充说明
- 30-49：背景铺垫、常识性内容

## 每页卡片数量建议

- 每页至少 2 张卡片，最多 8 张
- 左右侧尽量平衡（各 1-4 张）
- 如果某页内容很少（如参考文献页），可以跳过

## 输出 JSON 结构

{
  "globalPanel": {
    "titleCard": "论文一句话定位",
    "backgroundAndProblem": "研究背景与核心问题（基于当前分块所见内容）",
    "coreInnovations": ["创新点1", "创新点2"],
    "methodOverview": ["方法概述1", "方法概述2"],
    "mainFindings": ["主要发现1", "主要发现2"],
    "limitations": ["局限性1", "局限性2"]
  },
  "pageCards": [
    {
      "page": 0,
      "left": [
        {
          "type": "background",
          "title": "卡片标题（简洁，5-15字）",
          "anchorText": "从该页原文中逐字摘录的短句，必须是PDF里真实存在的文字",
          "content": "基于原文的概括，1-3句话，包含该页的具体信息",
          "importance": 80,
          "tags": ["标签1", "标签2"]
        }
      ],
      "right": [
        {
          "type": "method",
          "title": "卡片标题",
          "anchorText": "从该页原文中逐字摘录的短句",
          "content": "基于原文的概括",
          "importance": 90,
          "tags": ["标签1"]
        }
      ]
    }
  ],
  "boardNodesDraft": [
    {
      "type": "method",
      "title": "节点标题",
      "content": "节点内容（可以是跨页的综合理解）",
      "page": 0
    }
  ]
}

下面是论文元信息与当前分块内容：

# Paper
Title: ${params.title || "Unknown"}

# Manifest summary
${params.manifestSummary || "No manifest summary."}

# Figures in current chunk
${figures || "None"}

# Tables in current chunk
${tables || "None"}

# Page texts in current chunk
${pageList}
`.trim();
}