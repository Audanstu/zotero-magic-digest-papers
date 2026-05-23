import {
  chatWithModelConfig,
  getDefaultModelConfig,
} from "./modelApiSettings";

export async function testMagicDigestDefaultModelFromMenu() {
  const config = getDefaultModelConfig();

  if (!config) {
    new ztoolkit.ProgressWindow("magic_digest", {
      closeOnClick: true,
      closeTime: 7000,
    })
      .createLine({
        text: "未配置默认模型。请先到 编辑 → 设置 → magic_digest 配置模型 API。",
        type: "fail",
        progress: 100,
      })
      .show();

    return;
  }

  const pw = new ztoolkit.ProgressWindow("magic_digest", {
    closeOnClick: true,
    closeTime: -1,
  });

  pw.createLine({
    text: `正在调用默认模型：${config.name} / ${config.model}`,
    type: "default",
    progress: 20,
  }).show();

  try {
    const result = await chatWithModelConfig(config, [
      {
        role: "system",
        content:
          "You are a connectivity test assistant for the Zotero plugin magic_digest.",
      },
      {
        role: "user",
        content:
          "请只回复一句中文：magic_digest 已成功使用设置页中的默认模型。",
      },
    ], {
      temperature: 0,
      maxTokens: 120,
      timeoutMs: 120000,
    });

    pw.createLine({
      text: "默认模型调用成功 ✅",
      type: "success",
      progress: 70,
    })
      .createLine({
        text: `模型：${result.configName} / ${result.model}`,
        type: "default",
        progress: 85,
      })
      .createLine({
        text: result.content,
        type: "default",
        progress: 100,
      })
      .show();

    const st = (globalThis as any).setTimeout;
    if (typeof st === "function") {
      st(() => {
        try {
          pw.close();
        } catch {
          // ignore
        }
      }, 9000);
    }
  } catch (e: any) {
    pw.createLine({
      text: `默认模型调用失败：${e?.message || String(e)}`,
      type: "fail",
      progress: 100,
    }).show();
  }
}