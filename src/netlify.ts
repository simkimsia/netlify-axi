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

function run(args: string[]): Promise<ExecResult> {
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
