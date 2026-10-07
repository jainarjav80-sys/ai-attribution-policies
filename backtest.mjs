/*
 * Replays the policy over local Claude Code / agent history and reports
 * how many git commits would have been flagged for AI co-authorship.
 *
 *   node backtest.mjs
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

// ── Shim the failproofai module ──────────────────────────────────
const registered = [];
globalThis.__fpReg = registered;
const shim = `
  export const customPolicies = { add: (p) => globalThis.__fpReg.push(p) };
  export const allow = (reason) => ({ decision: "allow", reason });
  export const deny = (reason) => ({ decision: "deny", reason });
  export const instruct = (reason) => ({ decision: "instruct", reason });
`;
const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-coauthor-"));
fs.mkdirSync(path.join(shimDir, "node_modules", "failproofai"), { recursive: true });
fs.writeFileSync(
  path.join(shimDir, "node_modules", "failproofai", "package.json"),
  JSON.stringify({ name: "failproofai", version: "0.0.0", type: "module", main: "index.mjs" })
);
fs.writeFileSync(path.join(shimDir, "node_modules", "failproofai", "index.mjs"), shim);
fs.copyFileSync(
  new URL("./ai-attribution-policies.mjs", import.meta.url),
  path.join(shimDir, "p.mjs")
);
await import(path.join(shimDir, "p.mjs"));
fs.rmSync(shimDir, { recursive: true, force: true });

const policy = registered[0];

// ── Scan git history for co-author trailers ─────────────────────
// Walk all git repos accessible from $HOME and check commit messages.

const home = os.homedir();
let totalCommits = 0;
let flaggedCommits = 0;
let allowedCommits = 0;

console.log("guard-ai-coauthor backtest");
console.log("=".repeat(60));
console.log();

// Find git repos and check their commit messages
const findRepos = () => {
  try {
    const result = execSync(
      `find "${home}" -maxdepth 4 -name ".git" -type d 2>/dev/null | head -50`,
      { encoding: "utf8", timeout: 30000 }
    );
    return result.trim().split("\\n").filter(Boolean).map(g => path.dirname(g));
  } catch {
    return [];
  }
};

const repos = findRepos();
console.log(`Found ${repos.length} git repositories to scan.\\n`);

for (const repo of repos) {
  try {
    const log = execSync(
      `git -C "${repo}" log --format="%H|||%s%n%b" -n 200 2>/dev/null`,
      { encoding: "utf8", timeout: 10000 }
    );
    const commits = log.split(/(?=^[0-9a-f]{40}\|\|\|)/m).filter(Boolean);

    for (const entry of commits) {
      const sep = entry.indexOf("|||");
      if (sep < 0) continue;
      const message = entry.slice(sep + 3).trim();
      if (!message) continue;

      totalCommits++;

      // Simulate the policy context
      const ctx = {
        toolName: "Bash",
        toolInput: { command: `git commit -m "${message.replace(/"/g, '\\\\"')}"` },
      };

      const result = await policy.fn(ctx);
      if (result.decision === "instruct") {
        flaggedCommits++;
        const repoName = path.basename(repo);
        console.log(`  ⚠ FLAGGED [${repoName}]: ${message.slice(0, 80)}...`);
      } else {
        allowedCommits++;
      }
    }
  } catch {
    // Skip repos we can't read
  }
}

console.log();
console.log("=".repeat(60));
console.log(`Total commits scanned:  ${totalCommits}`);
console.log(`Flagged (AI co-author): ${flaggedCommits}`);
console.log(`Allowed (clean):        ${allowedCommits}`);
console.log(
  `Detection rate:         ${totalCommits ? ((flaggedCommits / totalCommits) * 100).toFixed(2) : 0}%`
);
