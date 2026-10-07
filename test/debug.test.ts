import { describe, expect, it } from "vitest";
import { debugArgv, debugLine, shellQuote } from "../src/netlify.js";

describe("shellQuote", () => {
  it("leaves plain args bare", () => {
    expect(shellQuote("sites:list")).toBe("sites:list");
    expect(shellQuote("--json")).toBe("--json");
  });

  it("single-quotes spaces, empty strings, and apostrophes", () => {
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote("")).toBe("''");
    expect(shellQuote("O'Brien")).toBe("'O'\\''Brien'");
  });
});

describe("debugLine", () => {
  it("prefixes the netlify argv", () => {
    expect(debugLine(["api", "getCurrentUser"])).toBe(
      "[axi-debug] netlify api getCurrentUser",
    );
  });
});

describe("debugArgv", () => {
  it("writes one line when AXI_DEBUG=1", () => {
    const lines: string[] = [];
    debugArgv(["sites:list", "--json"], { AXI_DEBUG: "1" }, (l) =>
      lines.push(l),
    );
    expect(lines).toEqual(["[axi-debug] netlify sites:list --json\n"]);
  });

  it("writes nothing when AXI_DEBUG is unset or not 1", () => {
    const lines: string[] = [];
    const write = (l: string) => lines.push(l);
    debugArgv(["status", "--json"], {}, write);
    debugArgv(["status", "--json"], { AXI_DEBUG: "0" }, write);
    expect(lines).toEqual([]);
  });
});
