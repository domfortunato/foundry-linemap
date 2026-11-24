#!/usr/bin/env node
/**
 * Cut a Line Map release: one command, no GitHub UI.
 *
 *     npm run release 0.14.0
 *     npm run release 0.14.0 -- --dry-run     # every check and the notes, nothing written
 *
 * What it does:
 *   1. validates the version (X.Y.Z, no leading "v"; the tag is vX.Y.Z, as upstream's are)
 *   2. refuses unless you are on `main`: work happens on `dev` and reaches `main` by merge
 *   3. refuses if tracked files have uncommitted changes, or the tag exists here or on origin
 *   4. reads the release notes from CHANGELOG.md, the `## X.Y.Z` section, and refuses
 *      without them, so a release never goes out with an empty body
 *   5. prints the commits since the last tag and the notes
 *   6. bumps `version` in module.json
 *   7. commits "Release X.Y.Z", makes an annotated tag whose body is the notes, and
 *      pushes the branch and the tag to `origin` in one atomic push
 *
 * Running it again after a deleted tag (a failed build, a refused push) is a REDO: when
 * module.json already reads X.Y.Z, the bump and commit are skipped and the tag goes on HEAD.
 *
 * Why `origin` and never GitHub: `origin` push-mirrors to GitHub, and the mirror deletes any
 * ref that exists only on GitHub. A tag made on GitHub is pruned on the next sync and its
 * release falls back to a draft. A tag pushed to `origin` reaches GitHub through the mirror,
 * which then protects it, and the "Release Creation" workflow (.github/workflows/main.yml)
 * builds module.zip and publishes the release, its body read back out of the tag.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capture = (cmd) => execSync(cmd, { cwd: ROOT }).toString().trim();
const run = (cmd) => { console.log(`  $ ${cmd}`); execSync(cmd, { cwd: ROOT, stdio: "inherit" }); };
const die = (msg) => { console.error(`\n✖ ${msg}\n`); process.exit(1); };

/** The lines between `## <version>` and the next `## ` heading, trimmed; null when there is no such heading. */
export function sectionFor(text, version) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((l) => {
    const m = /^## (\d+\.\d+\.\d+)(?:\s.*)?$/.exec(l);
    return m && m[1] === version;
  });
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^## /.test(lines[i])) { end = i; break; }
  return lines.slice(start + 1, end).join("\n").trim();
}

const args = process.argv.slice(2);
// `npm run release X --dry-run` (without `--`) hands the flag to npm, which keeps it and sets
// npm_config_dry_run instead; both spellings must stay dry.
const dryRun = args.includes("--dry-run") || process.env.npm_config_dry_run === "true";
const version = args.find((a) => !a.startsWith("--"));
if (!version) die("Usage: npm run release <version> [-- --dry-run]   e.g. npm run release 0.14.0");
if (!/^\d+\.\d+\.\d+$/.test(version)) die(`Version must be X.Y.Z (digits only, no leading "v"). Got: ${version}`);
const tag = `v${version}`;

// 1. Releases are cut from main.
const branch = capture("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") {
  const msg = `Releases are cut from main. You are on "${branch}".\n    git checkout main && git merge ${branch}`;
  if (dryRun) console.log(`(dry run) would refuse: ${msg}\n`);
  else die(msg);
}

// 2. No uncommitted changes to tracked files.
const dirty = capture("git status --porcelain --untracked-files=no");
if (dirty) die(`Tracked files have uncommitted changes. Commit or stash them first:\n${dirty}`);

// 3. The tag must exist neither here nor on origin.
if (capture(`git tag --list ${tag}`)) {
  die(`Tag ${tag} already exists. Pick a new version, or remove it first:\n    git tag -d ${tag} && git push origin :refs/tags/${tag}`);
}
if (capture(`git ls-remote --tags origin refs/tags/${tag}`)) {
  die(`Tag ${tag} already exists on origin. Pick a new version, or remove it first:\n    git push origin :refs/tags/${tag}`);
}

// 4. The notes: CHANGELOG.md's section for this version, tracked and not empty.
const changelogPath = path.join(ROOT, "CHANGELOG.md");
if (!fs.existsSync(changelogPath)) die(`CHANGELOG.md is missing. Write a "## ${version}" section in it first.`);
if (!capture("git ls-files CHANGELOG.md")) die("CHANGELOG.md is not tracked. Commit it first.");
const section = sectionFor(fs.readFileSync(changelogPath, "utf8"), version);
if (section === null) die(`CHANGELOG.md has no "## ${version}" section. Write the release notes there first.`);
if (!section) die(`CHANGELOG.md's "## ${version}" section is empty. Write the release notes there first.`);
const body = `# Line Map ${version}\n\n${section}\n`;

// 5. What is about to ship.
const lastTag = capture("git tag --sort=-v:refname").split("\n")[0];
if (lastTag) {
  const log = capture(`git log --oneline ${lastTag}..HEAD`);
  console.log(`\nShipping since ${lastTag}:`);
  console.log(log ? log.split("\n").map((l) => `  ${l}`).join("\n") : "  (nothing: no commits since that tag)");
  console.log("");
}
console.log(`Release notes (CHANGELOG.md, "## ${version}"), the body of the tag and of the GitHub release:\n`);
console.log(body.split("\n").map((l) => `  ${l}`).join("\n"));

const manifestPath = path.join(ROOT, "module.json");
const before = fs.readFileSync(manifestPath, "utf8");
const redo = JSON.parse(before).version === version;
if (redo) {
  console.log(`\nmodule.json already reads ${version}: a REDO. No bump, no commit; the tag goes on HEAD:`);
  console.log(`  ${capture("git log -1 --oneline")}`);
}

if (dryRun) {
  console.log("\n(dry run) Nothing written, nothing pushed.\n");
  process.exit(0);
}

// 6. Bump module.json's version with a one-line edit, so the diff stays minimal.
if (!redo) {
  const after = before.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
  if (after === before) die('Could not find a "version" field to update in module.json');
  fs.writeFileSync(manifestPath, after);
  if (JSON.parse(after).version !== version) die("module.json's version did not update cleanly. Aborting.");
  console.log(`\n✓ module.json version → ${version}`);
  run("git add module.json");
  run(`git commit -m "Release ${version}"`);
}

// 7. The tag message comes from a file: it is many lines, which PowerShell mangles as an
//    argument. --cleanup=verbatim keeps the notes exactly: git's default drops every line
//    starting with `#` (the headline included) as a comment.
const msgDir = fs.mkdtempSync(path.join(os.tmpdir(), "linemap-release-"));
const msgPath = path.join(msgDir, "tag-message.txt");
fs.writeFileSync(msgPath, `Line Map ${version}\n\n${body}`);
try {
  run(`git tag -a ${tag} --cleanup=verbatim -F "${msgPath.replace(/\\/g, "/")}"`);
} finally {
  fs.rmSync(msgDir, { recursive: true, force: true });
}
// One atomic push: the branch and the tag land together or not at all.
run(`git push --atomic origin HEAD refs/tags/${tag}`);

console.log(`
✓ Release ${version} pushed to origin (tag ${tag}), notes and all.

Next:
  1. The mirror carries the tag to GitHub within seconds, and the "Release Creation"
     workflow builds and publishes the release (watch GitHub's Actions tab).
  2. Check the install manifest answers 200 with version ${version}:
     https://github.com/domfortunato/foundry-linemap/releases/latest/download/module.json
  3. Bring dev level, or the next merge conflicts on this version bump:
         git checkout dev && git merge main && git push origin dev
`);
