// 一次性脚本：在 Zotero 里运行，修正数据目录路径
// 打开 Zotero → 工具 → 开发者 → Run JavaScript，粘贴以下代码：

(async () => {
  const OLD = "extensions.zotero.my_vibero.myVibero.dataRootDir";
  const NEW = "extensions.zotero.my_vibero.magicDigest.dataRootDir";

  const oldVal = Zotero.Prefs.get(OLD, true);
  const newVal = Zotero.Prefs.get(NEW, true);

  alert(
    "旧键 (" + OLD + "): " + (oldVal || "(空)") + "\n" +
    "新键 (" + NEW + "): " + (newVal || "(空)")
  );

  if (oldVal && !newVal) {
    Zotero.Prefs.set(NEW, oldVal, true);
    alert("✅ 已将旧路径迁移到新键: " + oldVal);
  } else if (newVal) {
    alert("当前数据路径: " + newVal + "\n\n如需修改，请手动执行:\nZotero.Prefs.set('" + NEW + "', '你的路径', true)");
  } else {
    alert("⚠️ 两个键都为空，请手动设置:\nZotero.Prefs.set('" + NEW + "', 'D:\\zotero_wenjian_data\\magic-digest', true)");
  }
})();
