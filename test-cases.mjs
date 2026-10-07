import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
const cases = JSON.parse(fs.readFileSync("cases.json", "utf-8"));

let passed = 0;
let failed = 0;

console.log(`Running ${cases.length} tests...\\n`);

for (const c of cases) {
  const ctx = {
    toolName: c.tool,
    toolInput: c.input
  };
  
  const result = await policy.fn(ctx);
  const decision = result.decision;
  
  if (decision === c.expect) {
    console.log(`✅ PASS: ${c.name}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${c.name}`);
    console.log(`   Expected: ${c.expect}`);
    console.log(`   Got:      ${decision}`);
    if (result.reason) {
      console.log(`   Reason:   ${result.reason}`);
    }
    failed++;
  }
}

console.log(`\\n---\\nPassed: ${passed}/${cases.length}`);
if (failed > 0) {
  console.log(`Failed: ${failed}/${cases.length}`);
  process.exit(1);
} else {
  console.log("All tests passed!");
}
