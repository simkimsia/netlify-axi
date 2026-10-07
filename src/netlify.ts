import { execFile } from "node:child_process";
import {
  AxiError,
  mapNetlifyError,
  netlifyNotInstalledError,
  UNKNOWN_SUGGESTION,
} from "./errors.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB

/** Quote one argv entry so the debug line can be pasted into a POSIX shell. */
export function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/** The line `AXI_DEBUG=1` prints for one netlify call. */
export function debugLine(args: string[]): string {
  return `[axi-debug] ${["netlify", ...args].map(shellQuote).join(" ")}`;
}

/**
 * With `AXI_DEBUG=1`, print the exact argv forwarded to netlify on stderr, so
 * a gap can be reproduced with the plain CLI as the axi ran it. stdout stays
 * clean TOON. No netlify-axi command passes a secret in argv today; a command
 * that does must mask it here before printing.
 */
export function debugArgv(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  write: (line: string) => void = (line) => process.stderr.write(line),
): void {
  if (env.AXI_DEBUG === "1") write(`${debugLine(args)}\n`);
}

function run(args: string[]): Promise<ExecResult> {
  debugArgv(args);
  return new Promise((resolve) => {
    execFile(
      "netlify",
      args,
      { maxBuffer: MAX_BUFFER_BYTES },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          resolve({ stdout: "", stderr: "ENOENT", exitCode: 127 });
          return;
        }
        const exitCode = error
          ? ((error as Error & { code?: string | number }).code ?? 1)
          : 0;
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: typeof exitCode === "number" ? exitCode : 1,
        });
      },
    );
  });
}

/** Execute netlify and return parsed JSON. */
export async function netlifyJson<T = unknown>(args: string[]): Promise<T> {
  const result = await run(args);
  if (result.stderr === "ENOENT") throw netlifyNotInstalledError();
  if (result.exitCode !== 0) {
    throw mapNetlifyError(result.stderr || result.stdout, result.exitCode);
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new AxiError(
      `Unexpected netlify output: ${result.stdout.slice(0, 200)}`,
      "UNKNOWN",
      [UNKNOWN_SUGGESTION],
    );
  }
}

/** Execute netlify and return raw stdout. */
export async function netlifyExec(args: string[]): Promise<string> {
  const result = await run(args);
  if (result.stderr === "ENOENT") throw netlifyNotInstalledError();
  if (result.exitCode !== 0) {
    throw mapNetlifyError(result.stderr || result.stdout, result.exitCode);
  }
  return result.stdout;
}
