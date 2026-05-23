const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const root = "D:\\my_vibero";
const sourceXpi = path.join(root, ".scaffold", "build", "magic-digest.xpi");
const targetXpi = path.join(root, "magic-digest.xpi");
const readerFile = path.join(root, "src", "modules", "readerIntegration.ts");
const readerBackup = path.join(
  root,
  "src",
  "modules",
  "readerIntegration.last-before-deploy.bak",
);

function run(cmd) {
  console.log("");
  console.log(">", cmd);
  cp.execSync(cmd, {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
}

if (fs.existsSync(readerFile)) {
  fs.copyFileSync(readerFile, readerBackup);
  console.log("Backup:", readerBackup);
}

run("npm run build");

fs.copyFileSync(sourceXpi, targetXpi);

console.log("");
console.log("Deploy done.");
console.log("XPI:", targetXpi);
console.log("");
console.log("Next:");
console.log("1. Restart Zotero");
console.log("2. Reload/reinstall the XPI");
console.log("3. Close old PDF tabs");
console.log("4. Reopen PDF");