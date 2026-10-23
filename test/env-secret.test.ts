import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiError, UNKNOWN_SUGGESTION } from "../src/errors.js";

// The real netlifyJson with execFile mocked: each test plants a fake secret
// value in netlify's stdout or stderr and asserts no error ever carries it.
const SECRET = "sk_live_PLANTED_SECRET_VALUE";
const { reply } = vi.hoisted(() => ({
  reply: {
    error: null as (Error & { code?: number }) | null,
    stdout: "",
    stderr: "",
  },
}));
vi.mock("node:child_process", () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (error: Error | null, stdout: string, stderr: string) => void,
  ) => cb(reply.error, reply.stdout, reply.stderr),
}));

const { netlifyJson } = await import("../src/netlify.js");
const { WITHHELD_SUGGESTION } = await import("../src/sites.js");
const { envCommand } = await import("../src/commands/env.js");

function exitWith(code: number): Error & { code: number } {
  return Object.assign(new Error("Command failed"), { code });
}

function serialized(error: AxiError): string {
  return JSON.stringify({
    message: error.message,
    suggestions: error.suggestions,
    stack: error.stack,
  });
}

async function envError(): Promise<AxiError> {
  const error = await envCommand([]).catch((e) => e);
  expect(error).toBeInstanceOf(AxiError);
  return error;
}

describe("env never echoes netlify output into an error", () => {
  beforeEach(() => {
    reply.error = null;
    reply.stdout = "";
    reply.stderr = "";
  });

  it("withholds stdout that is not JSON", async () => {
    reply.stdout = `API_TOKEN=${SECRET}\nnot json`;
    const error = await envError();
    expect(error.code).toBe("UNKNOWN");
    expect(error.suggestions).toEqual([WITHHELD_SUGGESTION]);
    expect(serialized(error)).not.toContain(SECRET);
  });

  it("withholds stdout on a non-zero exit with empty stderr", async () => {
    reply.error = exitWith(1);
    reply.stdout = JSON.stringify({ API_TOKEN: SECRET });
    const error = await envError();
    expect(error.code).toBe("UNKNOWN");
    expect(serialized(error)).not.toContain(SECRET);
  });

  it("withholds a stdout line that a pattern would otherwise echo", async () => {
    reply.error = exitWith(1);
    reply.stdout = `{"NOTE":"${SECRET} not found"}`;
    const error = await envError();
    expect(error.code).toBe("NOT_FOUND");
    expect(serialized(error)).not.toContain(SECRET);
  });

  it("withholds an echoed stderr line but keeps its code and next steps", async () => {
    reply.error = exitWith(1);
    reply.stderr = ` ›   Error: When resolving config file ${SECRET}: Base directory does not exist`;
    const error = await envError();
    expect(error.code).toBe("CONFIG");
    expect(error.suggestions[0]).toContain("netlify.toml");
    expect(serialized(error)).not.toContain(SECRET);
  });

  it("keeps fixed messages, which never contain output", async () => {
    reply.error = exitWith(1);
    reply.stdout = JSON.stringify({ API_TOKEN: SECRET });
    reply.stderr = " ›   JSONHTTPError: Unauthorized";
    const error = await envError();
    expect(error.code).toBe("AUTH");
    expect(error.message).toBe("Not logged in to Netlify");
  });

  it("still renders names only on success", async () => {
    reply.stdout = JSON.stringify({ API_TOKEN: SECRET, B: SECRET });
    const out = await envCommand([]);
    expect(out).toContain("API_TOKEN");
    expect(out).not.toContain(SECRET);
  });
});

// Why env must wrap its call in readFailedError: netlifyJson on its own still
// quotes stdout that is not JSON.
describe("netlifyJson on its own", () => {
  it("quotes non-JSON output", async () => {
    reply.error = null;
    reply.stderr = "";
    reply.stdout = "A new version of netlify-cli is available\n";
    const error = await netlifyJson(["status", "--json"]).catch((e) => e);
    expect(error.message).toContain("A new version of netlify-cli");
    expect(error.suggestions).toEqual([UNKNOWN_SUGGESTION]);
  });
});
