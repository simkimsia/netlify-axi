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

const { envCommand, parseEnv, unionContexts, ENV_CONTEXTS } =
  await import("../src/commands/env.js");

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

// Answer each `env:list --json --context <c>` call from a per-context map.
function byContext(map: Record<string, unknown>) {
  netlifyJson.mockImplementation(async (argv: string[]) => map[argv[3]] ?? {});
}

describe("unionContexts", () => {
  it("lists each name once with the contexts that have a value", () => {
    expect(unionContexts({ production: ["B", "A"], dev: ["A"] })).toEqual([
      { name: "A", contexts: "production dev" },
      { name: "B", contexts: "production" },
    ]);
  });
});

describe("envCommand (netlify mocked)", () => {
  beforeEach(() => {
    netlifyJson.mockReset();
  });

  it("asks netlify for env:list --json once per deploy context", async () => {
    byContext({});
    await envCommand([]);
    for (const context of ENV_CONTEXTS) {
      expect(netlifyJson).toHaveBeenCalledWith([
        "env:list",
        "--json",
        "--context",
        context,
      ]);
    }
    expect(netlifyJson).toHaveBeenCalledTimes(ENV_CONTEXTS.length);
  });

  it("renders sorted names, their contexts and a count, never a value", async () => {
    byContext({ production: FIXTURE, "deploy-preview": FIXTURE, dev: FIXTURE });
    const out = await envCommand([]);
    expect(decode(out)).toEqual({
      count: "3 variables",
      variables: [
        { name: "API_TOKEN", contexts: "production deploy-preview dev" },
        { name: "DATABASE_URL", contexts: "production deploy-preview dev" },
        { name: "SUPABASE_URL", contexts: "production deploy-preview dev" },
      ],
    });
    expect(out).not.toContain("secret-value");
  });

  it("lists a variable that has a value only in production", async () => {
    byContext({
      production: {
        PROD_ONLY_KEY: "secret-value-prod",
        SHARED: "secret-value-4",
      },
      dev: { SHARED: "secret-value-5" },
    });
    const out = await envCommand([]);
    expect(decode(out)).toEqual({
      count: "2 variables",
      variables: [
        { name: "PROD_ONLY_KEY", contexts: "production" },
        { name: "SHARED", contexts: "production dev" },
      ],
    });
    expect(out).not.toContain("secret-value");
  });

  it("says so, with a next step, when no variable is set in any context", async () => {
    byContext({});
    const out = await envCommand([]);
    expect(out).toContain(
      "env: 0 variables set for the linked site in any context",
    );
    expect(out).toContain("netlify env:set <name> <value>");
  });

  it("rejects any argument, including `list`, before calling netlify", async () => {
    for (const args of [
      ["--values"],
      ["get"],
      ["list"],
      ["list", "API_TOKEN"],
    ]) {
      const error = await envCommand(args).catch((e) => e);
      expect(error).toBeInstanceOf(AxiError);
      expect(error.code).toBe("VALIDATION_ERROR");
    }
    expect(netlifyJson).not.toHaveBeenCalled();
  });

  it("passes netlify errors through", async () => {
    netlifyJson.mockRejectedValue(
      new AxiError("No Netlify site is linked to this directory", "NOT_LINKED"),
    );
    const error = await envCommand([]).catch((e) => e);
    expect(error.code).toBe("NOT_LINKED");
  });

  it("refuses JSON that is not a name -> value map, without echoing it", async () => {
    netlifyJson.mockResolvedValue(["secret-value-9"]);
    const error = await envCommand([]).catch((e) => e);
    expect(error.code).toBe("UNKNOWN");
    expect(JSON.stringify([error.message, error.suggestions])).not.toContain(
      "secret-value",
    );
  });
});
