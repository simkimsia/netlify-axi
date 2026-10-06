import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/commands/env.js";

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
