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
  /** Set when netlify did not exit on its own: its output overflowed the buffer, or a signal killed it. */
  interrupted?: "max-buffer" | "signal";
}

/** Per-stream output cap for one netlify call; execFile kills netlify past it. */
export const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Cap for `netlify deploy`: it can print a whole build log before its JSON,
 * and killing it mid-deploy leaves the deploy's state unknown.
 */
export const DEPLOY_MAX_BUFFER_BYTES = 64 * 1024 * 1024; // 64 MB

export interface ExecOptions {
  /** Override MAX_BUFFER_BYTES for a call that can print a lot. */
  maxBuffer?: number;
}

type ExecError = Error & {
  code?: string | number;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
};

/** Turn execFile's callback arguments into one ExecResult. */
export function execOutcome(
  error: ExecError | null,
  stdout: string | undefined,
  stderr: string | undefined,
): ExecResult {
  if (error && error.code === "ENOENT") {
    return { stdout: "", stderr: "ENOENT", exitCode: 127 };
  }
  const result: ExecResult = {
    stdout: stdout ?? "",
    stderr: stderr ?? "",
    exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
  };
  // Node versions differ: some keep this code, others overwrite it with the
  // exit code once the killed child closes, so the message is checked too.
  if (
    error &&
    (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
      /maxBuffer length exceeded/i.test(error.message))
  ) {
    result.interrupted = "max-buffer";
  } else if (error && (error.killed || error.signal)) {
    result.interrupted = "signal";
  }
  return result;
}

/** Fixed text for a netlify call that was stopped before it exited (never echoes its output). */
export function interruptedError(
  reason: "max-buffer" | "signal",
  maxBuffer: number,
): AxiError {
  const why =
    reason === "max-buffer"
      ? `its output passed netlify-axi's ${Math.round(maxBuffer / (1024 * 1024))} MB limit`
      : "it was killed by a signal";
  return new AxiError(
    `netlify was stopped before it finished: ${why}`,
    "NETLIFY_INTERRUPTED",
    [UNKNOWN_SUGGESTION],
  );
}

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

function run(args: string[], maxBuffer: number): Promise<ExecResult> {
  debugArgv(args);
  return new Promise((resolve) => {
    const child = execFile(
      "netlify",
      args,
      { maxBuffer },
      (error, stdout, stderr) => {
        resolve(execOutcome(error as ExecError | null, stdout, stderr));
      },
    );
    // Agents cannot answer prompts. Commands pass every choice as a flag so
    // netlify has nothing to ask; closing stdin means any prompt that still
    // appears reads end-of-input rather than an open pipe nobody writes to.
    child?.stdin?.end();
  });
}

/** Execute netlify and return parsed JSON. */
export async function netlifyJson<T = unknown>(
  args: string[],
  options: ExecOptions = {},
): Promise<T> {
  const maxBuffer = options.maxBuffer ?? MAX_BUFFER_BYTES;
  const result = await run(args, maxBuffer);
  if (result.stderr === "ENOENT") throw netlifyNotInstalledError();
  if (result.interrupted) throw interruptedError(result.interrupted, maxBuffer);
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
export async function netlifyExec(
  args: string[],
  options: ExecOptions = {},
): Promise<string> {
  const maxBuffer = options.maxBuffer ?? MAX_BUFFER_BYTES;
  const result = await run(args, maxBuffer);
  if (result.stderr === "ENOENT") throw netlifyNotInstalledError();
  if (result.interrupted) throw interruptedError(result.interrupted, maxBuffer);
  if (result.exitCode !== 0) {
    throw mapNetlifyError(result.stderr || result.stdout, result.exitCode);
  }
  return result.stdout;
}
