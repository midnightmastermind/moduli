// services/execSandbox.js
// ============================================================
// Constrained filesystem + command execution for the assistant's
// optional "system" tool pack (the general code-agent capability from
// docs/aispecs.md). OFF unless ASSISTANT_EXEC=1.
//
// This belongs to the CORE assistant system, NOT to Moduli specifically
// — the Moduli chatbox port does not expose these unless the operator
// explicitly enables them. It lives in this repo for now; it is written
// to be lifted out into the standalone assistant later (no Moduli imports).
//
// Safety model (docs/aispecs.md §7, §11): the LLM never touches the shell
// or filesystem directly — it emits structured intent, and THIS module
// enforces reality:
//   • Path jail   — every file op + the command cwd are confined to one
//                   sandbox dir; paths that resolve outside it are rejected.
//   • Binary allow-list — only the leading binaries you opt into can run.
//   • Metacharacter block — no ; | & ` $ > < ( ) so a whitelisted binary
//                   can't be used as a launch pad for something else.
//   • Timeout + output cap.
// Docker isolation is the next hardening step (see the consolidated plan).
// ============================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileP = promisify(execFile);

// Master switch. Default OFF — the system pack is not even registered
// until this is "1". (See assistantTools.js systemToolPack.)
export const EXEC_ENABLED = process.env.ASSISTANT_EXEC === "1";

// Jail root — all file ops + the command cwd live here. Defaults to a
// dedicated dir so the assistant can NEVER reach project source unless the
// operator deliberately repoints ASSISTANT_SANDBOX_DIR.
export const SANDBOX_ROOT = path.resolve(
  process.env.ASSISTANT_SANDBOX_DIR || path.join(process.cwd(), ".assistant-sandbox")
);

// Leading binaries the assistant may invoke. Read-ish + node/npm by default;
// extend deliberately via ASSISTANT_EXEC_ALLOW="node,npm,git,...".
const ALLOWED_BINARIES = (process.env.ASSISTANT_EXEC_ALLOW || "node,npm,npx,ls,cat,echo,mkdir,touch")
  .split(",").map(s => s.trim()).filter(Boolean);

// Shell metacharacters that enable chaining / redirection / substitution.
const META_RE = /[;&|`$><\n\r(){}]/;

async function ensureRoot() { await fs.mkdir(SANDBOX_ROOT, { recursive: true }); }

// Resolve a caller path INSIDE the jail; throw on escape (../, absolute, etc.).
function jail(p) {
  const resolved = path.resolve(SANDBOX_ROOT, p || ".");
  if (resolved !== SANDBOX_ROOT && !resolved.startsWith(SANDBOX_ROOT + path.sep)) {
    throw new Error("path escapes sandbox");
  }
  return resolved;
}

export async function sandboxReadFile(p) {
  await ensureRoot();
  const content = await fs.readFile(jail(p), "utf8");
  return { path: p, content };
}

export async function sandboxWriteFile(p, content) {
  await ensureRoot();
  const abs = jail(p);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content ?? "", "utf8");
  return { path: p, bytes: Buffer.byteLength(content ?? "") };
}

export async function sandboxListDir(p) {
  await ensureRoot();
  const entries = await fs.readdir(jail(p || "."), { withFileTypes: true });
  return { path: p || ".", entries: entries.map(e => ({ name: e.name, dir: e.isDirectory() })) };
}

export async function sandboxRunCommand(command, { timeoutMs = 30000 } = {}) {
  await ensureRoot();
  const cmd = String(command || "").trim();
  if (!cmd) throw new Error("empty command");
  if (META_RE.test(cmd)) throw new Error("command contains disallowed shell metacharacters");
  const parts = cmd.split(/\s+/);
  const bin = parts[0];
  if (!ALLOWED_BINARIES.includes(bin)) {
    throw new Error(`binary "${bin}" not in allow-list (${ALLOWED_BINARIES.join(", ")}); set ASSISTANT_EXEC_ALLOW to extend`);
  }
  // Belt-and-suspenders: never allow a recursive delete even if rm is allowed.
  if (bin === "rm" && parts.some(a => /^-.*r/.test(a))) throw new Error("recursive rm blocked");
  try {
    const { stdout, stderr } = await execFileP(bin, parts.slice(1), {
      cwd: SANDBOX_ROOT, timeout: timeoutMs, maxBuffer: 1024 * 1024,
    });
    return { command: cmd, ok: true, stdout, stderr };
  } catch (e) {
    return { command: cmd, ok: false, error: String(e?.message || e), stdout: e?.stdout, stderr: e?.stderr };
  }
}

export function sandboxInfo() {
  return { enabled: EXEC_ENABLED, root: SANDBOX_ROOT, allowedBinaries: ALLOWED_BINARIES };
}
