# guard-ai-coauthor

A policy that prevents your AI coding agent from silently adding itself as a co-author to git commits.

```bash
failproofai policies add jainarjav80-sys/guard-ai-coauthor

```

## The Problem

AI coding agents like Claude, Copilot, and Cursor sometimes silently append `Co-authored-by` trailers to git commit messages, claiming credit for work without the user requesting it:

```
fix(api): resolve rate limiting bug

Co-authored-by: Claude <noreply@anthropic.com>
```

This happens on every commit the agent makes, polluting your git history with AI attribution that:
- Makes it look like the AI is a legitimate contributor
- Clutters PR histories with unnecessary metadata
- May conflict with corporate contribution policies
- Was never requested by the user

## How It Works

The policy hooks into `PreToolUse` and inspects `git commit -m "..."` commands before they execute. When it detects an AI co-author trailer, it returns `instruct()` telling the agent to remove the attribution.

It's `instruct`, not `deny`. The agent can correct itself, and there are legitimate cases where a user wants AI attribution on their commits. Blocking those would strand the turn.

## Supported Detection

| Agent | Name Pattern | Email Pattern |
|---|---|---|
| Claude (Anthropic) | `claude` | `*@anthropic.com` |
| GitHub Copilot | `copilot` | `copilot@github.com` |
| OpenAI / ChatGPT | `chatgpt`, `openai`, `gpt-*` | `*@openai.com` |
| Cursor | `cursor` | `*@cursor.sh`, `*@cursor.com` |
| Devin | `devin` | `*@cognition.ai`, `*@cognitionlabs.com` |

Detection is case-insensitive and checks both the name and email fields.

## What It Catches

Intercepted:
```bash
git commit -m "fix: bug\n\nCo-authored-by: Claude <noreply@anthropic.com>"
git commit -m "feat: add feature" -m "Co-authored-by: Copilot <copilot@github.com>"
git commit --message="fix\n\nCo-authored-by: ChatGPT <chatgpt@openai.com>"
```

Allowed through (no false positives):
```bash
git commit -m "fix: resolve null pointer"
git commit -m "feat: collab\n\nCo-authored-by: Jane <jane@example.com>"
git log --grep='Co-authored-by: Claude'
echo 'Co-authored-by: Claude <noreply@anthropic.com>'
npm test
```

## Limitations

- **`-F <file>` commits**: The policy cannot read arbitrary files passed via `-F` / `--file`. Only inline `-m` / `--message` arguments are inspected.
- **Interactive commits**: `git commit` without `-m` opens `$EDITOR`; there's no message to inspect at policy time.
- **External attribution**: Co-author trailers added by GitHub's merge UI or CI systems are not agent tool calls, so they're outside this policy's scope.
- **Intent detection**: v1 does not attempt to detect if the user requested AI attribution in conversation. The `instruct()` message tells the agent to remove it "unless the user explicitly asked."

## Testing

Run the test cases:
```bash
node test-cases.mjs
```

## Backtest

Replay the policy against your local git history:
```bash
node backtest.mjs
```

This scans up to 50 repositories under `$HOME` and reports how many commits would have been flagged.

