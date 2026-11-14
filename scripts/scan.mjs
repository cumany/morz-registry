// 扫描 GitHub topic（morz-plugin / morz-theme），确定性校验后生成社区索引 index.json。
//
// DSH 自发布流程（docs/PRODUCT-STRATEGY-2026.md §5.2）：
//   作者给仓库加 topic + 根目录 manifest.json → 本脚本每天扫一遍 → 生成默认索引。
// 校验失败的仓库不进索引（理由写入 scan-report.json）；通过校验的条目带 sha256，
// 客户端安装时会校验（审过的内容 = 发布的内容）。
//
// 用法: GH_TOKEN=<token> node scripts/scan.mjs [输出目录，默认 dist]
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const API = "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN || "";
const OUT_DIR = process.argv[2] || "dist";
const MAX_MAIN_BYTES = 5 * 1024 * 1024;
const MAX_CHANGELOG = 300;

const HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "morz-registry-scan",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

// 已知权限词表；未知权限不拒绝（SDK 会扩展），但在报告里标记为 WARN
const KNOWN_PERMISSIONS = new Set(["vault:read", "vault:write", "workspace", "views", "settings"]);
// 确定性危险模式：命中即排除出索引（不做人身判断，只做机械拦截）
const DANGER_PATTERNS = [/\beval\s*\(/, /\bnew\s+Function\s*\(/];

const scanLog = [];
const log = (level, repo, message) => {
  scanLog.push({ level, repo, message, at: new Date().toISOString() });
  console.error(`[${level}] ${repo}: ${message}`);
};

async function gh(path) {
  const response = await fetch(API + path, { headers: HEADERS });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function readRepoFile(repo, ref, path) {
  const response = await fetch(`${API}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, { headers: HEADERS });
  if (!response.ok) return null;
  const json = await response.json();
  if (json.encoding !== "base64" || json.size > MAX_MAIN_BYTES) return null;
  return Buffer.from(json.content, "base64").toString("utf8");
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 校验 manifest；返回 { ok, errors, warnings, manifest }。主题无 sdk 字段，插件必须 sdk:1。 */
function validateManifest(raw, repo, kind) {
  const errors = [];
  const warnings = [];
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    return { ok: false, errors: [`manifest.json 不是合法 JSON: ${error.message}`], warnings, manifest: null };
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(String(manifest.id ?? ""))) errors.push("id 缺失或不符合规范");
  if (!manifest.name) errors.push("name 缺失");
  if (!/^v?\d+\.\d+\.\d+/.test(String(manifest.version ?? ""))) errors.push("version 缺失或非 semver");
  if (kind === "plugins" && manifest.sdk !== 1) errors.push("sdk 必须为 1");
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  for (const permission of permissions) {
    if (typeof permission !== "string") errors.push("permissions 必须是字符串数组");
    else if (!KNOWN_PERMISSIONS.has(permission)) warnings.push(`未知权限: ${permission}`);
  }
  return { ok: errors.length === 0, errors, warnings, manifest };
}

/** 校验入口文件：插件查 activate 导出 + 危险模式；主题查非空 CSS。 */
function validateMainJs(mainJs, kind) {
  const errors = [];
  const warnings = [];
  if (!mainJs || !mainJs.trim()) return { ok: false, errors: ["入口文件为空"], warnings, sha256: "" };
  if (kind === "plugins") {
    if (!/activate/.test(mainJs)) errors.push("main.js 未导出 activate 入口");
    for (const pattern of DANGER_PATTERNS) {
      if (pattern.test(mainJs)) errors.push(`命中确定性危险模式: ${pattern}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings, sha256: sha256(mainJs) };
}

async function scanKind(kind, topic) {
  const search = await gh(`/search/repositories?q=topic:${topic}&per_page=100&sort=updated`);
  const repos = search.items ?? [];
  log("INFO", topic, `发现 ${repos.length} 个仓库`);
  const entries = [];

  for (const repo of repos) {
    const fullName = repo.full_name;
    try {
      // 钉住策略：优先最新 Release 的 tag；无 Release 则钉默认分支 commit
      let ref = null;
      let isRelease = false;
      try {
        const release = await gh(`/repos/${fullName}/releases/latest`);
        ref = release.tag_name;
        isRelease = true;
      } catch { /* 无 Release：用 HEAD commit 钉住 */ }
      if (!ref) {
        const branch = await gh(`/repos/${fullName}/branches/${encodeURIComponent(repo.default_branch)}`);
        ref = branch.commit.sha;
      }

      const manifestRaw = await readRepoFile(fullName, ref, "manifest.json");
      if (!manifestRaw) { log("SKIP", fullName, "根目录没有 manifest.json"); continue; }
      const manifestCheck = validateManifest(manifestRaw, fullName, kind);
      if (!manifestCheck.ok) { log("EXCLUDE", fullName, manifestCheck.errors.join("; ")); continue; }
      const manifest = manifestCheck.manifest;

      const mainPath = kind === "plugins" ? (manifest.main ?? "main.js") : (manifest.theme ?? "theme.css");
      const mainJs = await readRepoFile(fullName, ref, mainPath);
      const mainCheck = validateMainJs(mainJs, kind);
      if (!mainCheck.ok) { log("EXCLUDE", fullName, mainCheck.errors.join("; ")); continue; }

      const warnings = [...manifestCheck.warnings];
      const unknownPerms = (manifest.permissions ?? []).filter(p => !KNOWN_PERMISSIONS.has(p));

      const entry = {
        id: String(manifest.id),
        name: String(manifest.name ?? manifest.id),
        description: String(manifest.description ?? "").slice(0, MAX_CHANGELOG),
        author: String(manifest.author ?? repo.owner.login),
        repo: fullName,
        version: String(manifest.version),
        minAppVersion: manifest.minAppVersion ? String(manifest.minAppVersion) : undefined,
        permissions: manifest.permissions ?? [],
        sha256: { [mainPath]: mainCheck.sha256 },
        stars: repo.stargazers_count,
        pushedAt: repo.pushed_at,
        trust: "community",
      };
      if (isRelease) entry.tag = ref; else entry.commit = ref;
      if (manifest.main) entry.main = String(manifest.main);
      if (kind === "themes") {
        if (manifest.modes) entry.modes = manifest.modes;
        if (manifest.preview) entry.preview = String(manifest.preview);
        if (manifest.nameEn) entry.nameEn = String(manifest.nameEn);
        entry.styles = manifest.styles ? String(manifest.styles) : undefined;
      }
      if (manifest.changelog) entry.changelog = String(manifest.changelog).slice(0, MAX_CHANGELOG);
      entries.push(entry);
      log("INCLUDE", fullName, `v${manifest.version} @ ${ref}${unknownPerms.length ? ` (未知权限: ${unknownPerms.join(",")})` : ""}`);
    } catch (error) {
      log("EXCLUDE", fullName, error instanceof Error ? error.message : String(error));
    }
  }
  return entries;
}

const OUT = {
  plugins: await scanKind("plugins", "morz-plugin"),
  themes: await scanKind("themes", "morz-theme"),
};

const index = {
  schemaVersion: 1,
  name: "Morz 社区索引（自动生成）",
  updatedAt: Date.now(),
  plugins: OUT.plugins,
  themes: OUT.themes,
};

await mkdir(OUT_DIR, { recursive: true });
await writeFile(join(OUT_DIR, "index.json"), JSON.stringify(index, null, 2) + "\n");
await writeFile(join(OUT_DIR, "scan-report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), log: scanLog, counts: { plugins: OUT.plugins.length, themes: OUT.themes.length } }, null, 2) + "\n");
console.error(`完成: ${OUT.plugins.length} plugins, ${OUT.themes.length} themes → ${OUT_DIR}/index.json`);
