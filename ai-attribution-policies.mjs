import { customPolicies, allow, instruct } from "failproofai";

/*
 * guard-ai-coauthor / AI Attribution
 *
 * AI coding agents (Claude, Copilot, etc.) sometimes silently add
 * "Co-authored-by" trailers to git commits, claiming credit for work
 * the user did or making it appear the AI is a legitimate contributor.
 *
 * This policy intercepts `git commit -m "..."` commands, inspects the
 * commit message for known AI co-author trailers, and instructs the
 * agent to remove them unless the user explicitly requested it.
 *
 * Like edit-guard, this is `instruct`, not `deny`. The agent can
 * correct itself, and there are legitimate cases where a user wants
 * AI attribution. Blocking outright would strand the turn.
 */

// ── Known AI agent co-author patterns ────────────────────────────
// Each entry: { name, emailPattern, namePattern }
// - emailPattern: regex tested against the email in Co-authored-by
// - namePattern: regex tested against the name in Co-authored-by
// Add new agents here to extend detection.
const AI_COAUTHOR_PATTERNS = [
  {
    name: "Claude (Anthropic)",
    emailPattern: /anthropic\.com$/i,
    namePattern: /^claude$/i,
  },
  {
    name: "GitHub Copilot",
    emailPattern: /copilot@github\.com$/i,
    namePattern: /^copilot$/i,
  },
  {
    name: "OpenAI / ChatGPT",
    emailPattern: /openai\.com$/i,
    namePattern: /^(?:chatgpt|openai|gpt-?\d*)$/i,
  },
  {
    name: "Cursor",
    emailPattern: /cursor\.(?:sh|com)$/i,
    namePattern: /^cursor$/i,
  },
  {
    name: "Devin",
    emailPattern: /cognition(?:\.ai|labs\.com)$/i,
    namePattern: /^devin$/i,
  },
];

// ── Helpers ──────────────────────────────────────────────────────

/** Extract the Bash command string from a PreToolUse context. */
const bashCommand = (ctx) => {
  try {
    if (!ctx || ctx.toolName !== "Bash") return "";
    const cmd = ctx.toolInput?.command;
    return typeof cmd === "string" ? cmd : "";
  } catch {
    return "";
  }
};

/**
 * Return true when the command string contains an actual `git commit`
 * invocation — not git-log, git-show, grep, echo, etc. that may
 * coincidentally contain the same text.
 */
const isGitCommit = (cmd) => {
  // Match `git commit` or `git -C <path> commit` as a command, not
  // inside a string being echoed or grepped.
  return /(?:^|[;&|]\s*|&&\s*|\|\|\s*)git\s+(?:-C\s+\S+\s+)?commit\b/.test(cmd);
};

/**
 * Extract all commit-message strings from -m / --message arguments.
 * Supports:
 *   -m "msg"
 *   -m'msg'
 *   --message "msg"
 *   --message="msg"
 *   Multiple -m flags (git concatenates them with blank lines)
 *
 * Returns an array of message strings (may be empty).
 */
const extractMessages = (cmd) => {
  const messages = [];

  // Pattern 1: -m "msg" or -m 'msg' (with space between flag and value)
  const mQuoted = /-m\s+(["'])((?:(?!\1)[^\\]|\\.)*)\1/g;
  let match;
  while ((match = mQuoted.exec(cmd)) !== null) {
    messages.push(match[2]);
  }

  // Pattern 2: -m"msg" or -m'msg' (no space, value glued to flag)
  const mGlued = /-m(["'])((?:(?!\1)[^\\]|\\.)*)\1/g;
  while ((match = mGlued.exec(cmd)) !== null) {
    messages.push(match[2]);
  }

  // Pattern 3: --message="msg" or --message='msg'
  const msgEq = /--message=(["'])((?:(?!\1)[^\\]|\\.)*)\1/g;
  while ((match = msgEq.exec(cmd)) !== null) {
    messages.push(match[2]);
  }

  // Pattern 4: --message "msg" or --message 'msg' (with space)
  const msgSpaced = /--message\s+(["'])((?:(?!\1)[^\\]|\\.)*)\1/g;
  while ((match = msgSpaced.exec(cmd)) !== null) {
    messages.push(match[2]);
  }

  // Deduplicate (patterns may overlap for edge cases)
  return [...new Set(messages)];
};

/**
 * Parse a "Co-authored-by: Name <email>" trailer line.
 * Returns { name, email } or null if the line doesn't match.
 */
const parseCoAuthoredBy = (line) => {
  const m = line.match(
    /co-authored-by\s*:\s*(.+?)\s*<([^>]+)>/i
  );
  return m ? { name: m[1].trim(), email: m[2].trim() } : null;
};

/**
 * Check if a co-author matches any known AI agent pattern.
 * Returns the matched agent name or null.
 */
const matchesAIAgent = ({ name, email }) => {
  for (const agent of AI_COAUTHOR_PATTERNS) {
    if (agent.emailPattern.test(email) || agent.namePattern.test(name)) {
      return agent.name;
    }
  }
  return null;
};

/**
 * Scan a commit message for AI co-author trailers.
 * Returns an array of { agent, trailer } objects.
 */
const findAICoauthors = (message) => {
  const results = [];
  const lines = message.split(/\\n|\n/);
  for (const line of lines) {
    const parsed = parseCoAuthoredBy(line);
    if (!parsed) continue;
    const agent = matchesAIAgent(parsed);
    if (agent) {
      results.push({ agent, trailer: line.trim() });
    }
  }
  return results;
};

// ── Policy registration ─────────────────────────────────────────

customPolicies.add({
  name: "guard-ai-coauthor",
  description:
    "Prevents AI agents from silently adding Co-authored-by trailers to git commits.",
  match: {
    events: ["PreToolUse"],
  },
  fn: async (ctx) => {
    const cmd = bashCommand(ctx);
    if (!cmd) return allow();

    // Only intercept actual git commit commands
    if (!isGitCommit(cmd)) return allow();

    // Extract commit messages from -m/--message flags
    const messages = extractMessages(cmd);
    if (messages.length === 0) return allow();

    // Check each message for AI co-author trailers
    const allHits = [];
    for (const msg of messages) {
      allHits.push(...findAICoauthors(msg));
    }

    if (allHits.length === 0) return allow();

    // Build the instruction message
    const agents = [...new Set(allHits.map((h) => h.agent))].join(", ");
    return instruct(
      `The commit message contains an AI co-author trailer (${agents}). ` +
        `Remove the "Co-authored-by" line(s) for AI agents from the commit message ` +
        `unless the user has explicitly asked you to include AI attribution. ` +
        `The trailer(s) found: ${allHits.map((h) => `"${h.trailer}"`).join(", ")}`
    );
  },
});
