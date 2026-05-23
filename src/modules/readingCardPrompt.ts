export function buildReadingCardPrompt(params: {
  title: string;
  authors: string;
  year: string;
  abstractText: string;
  markdown: string;
}) {
  const { title, authors, year, abstractText, markdown } = params;

  return `
请基于下面论文信息与全文解析结果，生成一份“中英双语阅读卡”。

要求：
1. 输出必须使用 Markdown。
2. 内容要准确、学术化、简洁但信息充分。
3. 每个部分先中文，后英文。
4. 如果原文没有足够信息，不要编造，可写“未明确说明 / Not explicitly stated”。
5. 不要输出与阅读卡无关的解释。
6. 不要使用代码块包裹整个答案。

输出结构严格使用以下标题：

# 双语阅读卡 / Bilingual Reading Card

## 1. 论文信息 / Paper Information
- 标题 / Title:
- 作者 / Authors:
- 年份 / Year:

## 2. 一句话总结 / One-sentence Summary
中文：
English:

## 3. 研究问题 / Research Question
中文：
English:

## 4. 核心贡献 / Core Contributions
中文：
English:

## 5. 方法概述 / Method Overview
中文：
English:

## 6. 实验与结果 / Experiments and Results
中文：
English:

## 7. 优点 / Strengths
中文：
English:

## 8. 局限性 / Limitations
中文：
English:

## 9. 对我的启发 / Inspiration for My Research
中文：
English:

## 10. 可引用表述 / Quotable Statements
中文：
English:

## 11. 关键词 / Keywords
中文：
English:

下面是论文信息：

标题：
${title || "Unknown"}

作者：
${authors || "Unknown"}

年份：
${year || "Unknown"}

摘要：
${abstractText || "No abstract"}

下面是论文全文解析后的 Markdown 内容：
${markdown}
`.trim();
}