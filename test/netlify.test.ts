import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  DEPLOY_MAX_BUFFER_BYTES,
  execOutcome,
  interruptedError,
  MAX_BUFFER_BYTES,
} from "../src/netlify.js";

type ExecError = Parameters<typeof execOutcome>[0];

/** Run node (never netlify) and classify its outcome the way run() does. */
function nodeOutcome(script: string, maxBuffer = MAX_BUFFER_BYTES) {
  return new Promise<ReturnType<typeof execOutcome>>((resolve) => {
    execFile(
      process.execPath,
      ["-e", script],
      { maxBuffer },
      (error, stdout, stderr) =>
        resolve(execOutcome(error as ExecError, stdout, stderr)),
    );
  });
}

describe("execOutcome", () => {
  it("reports a clean exit and a plain non-zero exit as not interrupted", async () => {
    expect(await nodeOutcome("process.stdout.write('ok')")).toEqual({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
    });
    const failed = await nodeOutcome("process.exit(3)");
    expect(failed.exitCode).toBe(3);
    expect(failed.interrupted).toBeUndefined();
  });

  it("flags output past maxBuffer", async () => {
    const out = await nodeOutcome(
      "process.stdout.write('x'.repeat(5000))",
      100,
    );
    expect(out.interrupted).toBe("max-buffer");
    expect(out.exitCode).not.toBe(0);
  });

  it("flags an older Node's overwritten maxBuffer code by its message", () => {
    const error = Object.assign(
      new RangeError("stdout maxBuffer length exceeded"),
      { code: null as unknown as string, killed: true, signal: "SIGTERM" },
    );
    expect(execOutcome(error, "", "").interrupted).toBe("max-buffer");
  });

  it("flags a child killed by a signal", async () => {
    const out = await nodeOutcome("process.kill(process.pid, 'SIGKILL')");
    expect(out.interrupted).toBe("signal");
    expect(out.exitCode).toBe(1);
  });

  it("maps a missing binary to ENOENT", () => {
    const error = Object.assign(new Error("spawn netlify ENOENT"), {
      code: "ENOENT",
    });
    expect(execOutcome(error, "", "")).toEqual({
      stdout: "",
      stderr: "ENOENT",
      exitCode: 127,
    });
  });
});

describe("interruptedError", () => {
  it("names the limit for an overflow and never carries output", () => {
    const error = interruptedError("max-buffer", DEPLOY_MAX_BUFFER_BYTES);
    expect(error.code).toBe("NETLIFY_INTERRUPTED");
    expect(error.message).toContain("64 MB limit");
    expect(error.suggestions.length).toBeGreaterThan(0);
  });

  it("says a signal stopped it", () => {
    expect(interruptedError("signal", MAX_BUFFER_BYTES).message).toContain(
      "killed by a signal",
    );
  });
});
