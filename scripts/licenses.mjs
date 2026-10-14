// Regenerates THIRD_PARTY_LICENSES.json, the notices shown in the About dialog,
// from the Rust crates (cargo-about, see src-tauri/about.toml) and the npm
// packages that ship in the app. Run after dependency updates and commit.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const groups = new Map();
function add(id, text, name, version) {
  text = text.trim();
  const key = `${id}\n${text}`;
  if (!groups.has(key)) groups.set(key, { id, text, packages: [] });
  groups.get(key).packages.push({ name, version });
}

// cargo-about refuses to write to a pipe on Windows, so go through a file.
const aboutJson = join(mkdtempSync(join(tmpdir(), "licenses-")), "about.json");
execFileSync("cargo", ["about", "generate", "--format", "json", "-o", aboutJson], {
  cwd: "src-tauri",
  stdio: "inherit",
});
const about = JSON.parse(readFileSync(aboutJson, "utf8"));
for (const license of about.licenses) {
  for (const { crate } of license.used_by) add(license.id, license.text, crate.name, crate.version);
}

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
for (const [path, meta] of Object.entries(lock.packages)) {
  if (!path || meta.dev) continue;
  // Prefer the MIT text of dual-licensed packages; .spdx files are metadata.
  const files = readdirSync(path)
    .filter((f) => /^(licen[sc]e|copying)(-mit)?(\.(md|txt))?$/i.test(f))
    .sort((a, b) => /mit/i.test(b) - /mit/i.test(a));
  const text = files.length ? readFileSync(join(path, files[0]), "utf8") : "";
  add(meta.license ?? "UNKNOWN", text, path.replace(/^.*node_modules\//, ""), meta.version);
}

const licenses = [...groups.values()];
for (const g of licenses) g.packages.sort((a, b) => a.name.localeCompare(b.name));
licenses.sort((a, b) => a.packages[0].name.localeCompare(b.packages[0].name));
writeFileSync("THIRD_PARTY_LICENSES.json", JSON.stringify(licenses, null, 2) + "\n");
console.log(`${licenses.length} notices for ${licenses.reduce((n, g) => n + g.packages.length, 0)} packages`);
