import { decode } from "@toon-format/toon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiError } from "../src/errors.js";

// No test may reach the real netlify binary: netlifyJson is mocked here, and
// test/env-secret.test.ts covers the real netlifyJson with execFile mocked.
const { netlifyJson } = vi.hoisted(() => ({ netlifyJson: vi.fn() }));
vi.mock("../src/netlify.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/netlify.js")>()),
  netlifyJson,
}));

const { envCommand, parseEnv } = await import("../src/commands/env.js");

// Shape of `netlify env:list --json` (netlify-cli 18.x): flat name -> value
// map. Values here are fake sentinels, used to prove they never leak.
const FIXTURE = {
  SUPABASE_URL: "https://secret-value-1.supabase.co",
  API_TOKEN: "secret-value-2",
  DATABASE_URL: "postgres://user:secret-value-3@host/db",
};

describe("parseEnv", () => {
  it("returns sorted names and a count", () => {
    expect(parseEnv(FIXTURE)).toEqual({
      count: 3,
      names: ["API_TOKEN", "DATABASE_URL", "SUPABASE_URL"],
    });
  });

  it("never includes a value in its output", () => {
    expect(JSON.stringify(parseEnv(FIXTURE))).not.toContain("secret-value");
  });

  it("handles an empty environment", () => {
    expect(parseEnv({})).toEqual({ count: 0, names: [] });
  });
});

describe("envCommand (netlify mocked)", () => {
  beforeEach(() => {
    netlifyJson.mockReset();
  });

  it("asks netlify for env:list --json", async () => {
    netlifyJson.mockResolvedValueOnce(FIXTURE);
    await envCommand([]);
    expect(netlifyJson).toHaveBeenCalledWith(["env:list", "--json"]);
  });

  it("renders sorted names and a count, never a value", async () => {
    netlifyJson.mockResolvedValueOnce(FIXTURE);
    const out = await envCommand([]);
    expect(decode(out)).toEqual({
      count: "3 variables",
      names: ["API_TOKEN", "DATABASE_URL", "SUPABASE_URL"],
    });
    expect(out).not.toContain("secret-value");
  });

  it("accepts the explicit `list` subcommand", async () => {
    netlifyJson.mockResolvedValueOnce(FIXTURE);
    const out = await envCommand(["list"]);
    expect(out).toContain("3 variables");
  });

  it("says so, with a next step, when no variable is set", async () => {
    netlifyJson.mockResolvedValueOnce({});
    const out = await envCommand([]);
    expect(out).toContain("env: 0 variables set for the linked site");
    expect(out).toContain("netlify env:set <name> <value>");
  });

  it("rejects unknown arguments before calling netlify", async () => {
    for (const args of [["--values"], ["get"], ["list", "API_TOKEN"]]) {
      const error = await envCommand(args).catch((e) => e);
      expect(error).toBeInstanceOf(AxiError);
      expect(error.code).toBe("VALIDATION_ERROR");
    }
    expect(netlifyJson).not.toHaveBeenCalled();
  });

  it("passes netlify errors through", async () => {
    netlifyJson.mockRejectedValueOnce(
      new AxiError("No Netlify site is linked to this directory", "NOT_LINKED"),
    );
    const error = await envCommand([]).catch((e) => e);
    expect(error.code).toBe("NOT_LINKED");
  });

  it("refuses JSON that is not a name -> value map, without echoing it", async () => {
    netlifyJson.mockResolvedValueOnce(["secret-value-9"]);
    const error = await envCommand([]).catch((e) => e);
    expect(error.code).toBe("UNKNOWN");
    expect(JSON.stringify([error.message, error.suggestions])).not.toContain(
      "secret-value",
    );
  });
});
