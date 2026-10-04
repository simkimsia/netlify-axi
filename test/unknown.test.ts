import { describe, expect, it, vi } from "vitest";
import { decode } from "@toon-format/toon";
import { AxiError as SdkAxiError } from "axi-sdk-js";
import { AxiError, UNKNOWN_SUGGESTION } from "../src/errors.js";

vi.mock("node:child_process", () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (error: Error | null, stdout: string, stderr: string) => void,
  ) => cb(null, "A new version of netlify-cli is available\n", ""),
}));

const { runAxiCli } = vi.hoisted(() => ({ runAxiCli: vi.fn() }));
vi.mock("axi-sdk-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("axi-sdk-js")>()),
  runAxiCli,
}));

describe("UNKNOWN errors outside mapNetlifyError", () => {
  it("netlifyJson suggests a next step when netlify prints non-JSON", async () => {
    const { netlifyJson } = await import("../src/netlify.js");
    const err = await netlifyJson(["status", "--json"]).catch((e) => e);
    expect(err).toBeInstanceOf(AxiError);
    expect(err.code).toBe("UNKNOWN");
    expect(err.suggestions).toEqual([UNKNOWN_SUGGESTION]);
  });

  it("formatError renders a help next step for foreign thrown errors", async () => {
    const { main } = await import("../src/cli.js");
    await main();
    const { formatError } = runAxiCli.mock.calls[0]![0];
    const { output, exitCode } = formatError(new Error("boom"));
    expect(decode(output.trim())).toEqual({
      error: "boom",
      code: "UNKNOWN",
      help: [UNKNOWN_SUGGESTION],
    });
    expect(exitCode).toBe(1);
  });

  it("formatError keeps the SDK's own AxiError code, help and exit code", async () => {
    const { main } = await import("../src/cli.js");
    await main();
    const { formatError } = runAxiCli.mock.calls[0]![0];
    const { output, exitCode } = formatError(
      new SdkAxiError("Unknown update option: --bogus", "VALIDATION_ERROR", [
        "Run `netlify-axi update --help`",
      ]),
    );
    expect(decode(output.trim())).toEqual({
      error: "Unknown update option: --bogus",
      code: "VALIDATION_ERROR",
      help: ["Run `netlify-axi update --help`"],
    });
    expect(exitCode).toBe(2);
  });
});
