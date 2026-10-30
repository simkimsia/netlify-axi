import { describe, expect, it } from "vitest";
import {
  exitCodeForError,
  mapNetlifyError,
  UNKNOWN_SUGGESTION,
} from "../src/errors.js";

// All inputs below are verbatim netlify-cli 18.x stderr captured from real runs.
describe("mapNetlifyError", () => {
  it("maps commander's unknown-option rejection to NETLIFY_TOO_OLD", () => {
    // Wording from netlify-cli 18.0.1's outputError hook (dist/commands/main.js)
    // around commander's "unknown option" error; not captured from a run.
    const err = mapNetlifyError(
      " ›   Error: unknown option '--no-build'\n ›   See more help with --help",
      1,
    );
    expect(err.code).toBe("NETLIFY_TOO_OLD");
    expect(err.message).toBe("netlify-cli does not accept --no-build");
    expect(err.suggestions.join(" ")).toContain("netlify-cli@latest");
  });

  it("ignores commander's wording when it is not netlify's own line", () => {
    const err = mapNetlifyError(
      "> vite build\nerror: unknown option '--foo'\nBuild script returned non-zero exit code: 2",
      2,
    );
    expect(err.code).not.toBe("NETLIFY_TOO_OLD");
  });

  it("maps auth failures to AUTH with a login suggestion", () => {
    const err = mapNetlifyError(" ›   JSONHTTPError: Unauthorized", 1);
    expect(err.code).toBe("AUTH");
    expect(err.suggestions.join(" ")).toContain("netlify login");
    expect(exitCodeForError(err)).toBe(1);
  });

  it("maps unlinked directories to NOT_LINKED with a link suggestion", () => {
    const err = mapNetlifyError(
      " ›   Error: You don't appear to be in a folder that is linked to a site",
      1,
    );
    expect(err.code).toBe("NOT_LINKED");
    expect(err.suggestions.join(" ")).toContain("netlify link");
  });

  it("maps config resolution failures to CONFIG before NOT_FOUND", () => {
    const err = mapNetlifyError(
      " ›   Error: When resolving config file /repo/netlify.toml:\nBase directory does not exist: /repo/missing",
      1,
    );
    // "does not exist" would also match the broader NOT_FOUND pattern, so
    // ordering (narrow before broad) is what this asserts.
    expect(err.code).toBe("CONFIG");
    expect(err.message).toContain("When resolving config file");
  });

  it("maps missing API resources to NOT_FOUND", () => {
    const err = mapNetlifyError(" ›   JSONHTTPError: Not Found", 1);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.suggestions.join(" ")).toContain("netlify-axi list");
  });

  // netlify-cli on Windows decorates its own lines with "»" instead of "›"
  // (issue #27); the same stderr with that prefix must map the same way.
  describe("Windows-style » decoration", () => {
    it("maps commander's unknown-option rejection to NETLIFY_TOO_OLD", () => {
      const err = mapNetlifyError(
        " »   Error: unknown option '--no-build'\n »   See more help with --help",
        1,
      );
      expect(err.code).toBe("NETLIFY_TOO_OLD");
      expect(err.message).toBe("netlify-cli does not accept --no-build");
      expect(err.fromNetlifyLine).toBe(true);
    });

    it("maps auth failures to AUTH", () => {
      const err = mapNetlifyError(" »   JSONHTTPError: Unauthorized", 1);
      expect(err.code).toBe("AUTH");
      expect(err.fromNetlifyLine).toBe(true);
    });

    it("maps config resolution failures to CONFIG before NOT_FOUND", () => {
      const err = mapNetlifyError(
        " »   Error: When resolving config file C:\\repo\\netlify.toml:\nBase directory does not exist: C:\\repo\\missing",
        1,
      );
      expect(err.code).toBe("CONFIG");
      expect(err.message).toMatch(/^When resolving config file/);
      expect(err.fromNetlifyLine).toBe(true);
    });

    it("maps missing API resources to NOT_FOUND", () => {
      const err = mapNetlifyError(" »   JSONHTTPError: Not Found", 1);
      expect(err.code).toBe("NOT_FOUND");
      expect(err.fromNetlifyLine).toBe(true);
    });

    it("strips the » prefix and Error: label from UNKNOWN messages", () => {
      const err = mapNetlifyError(" »   Error: Something exploded", 1);
      expect(err.code).toBe("UNKNOWN");
      expect(err.message).toBe("Something exploded");
    });
  });

  it("falls back to UNKNOWN with the first stderr line, stripped of decoration", () => {
    const err = mapNetlifyError(
      " ›   Error: Something exploded\nstack trace line",
      1,
    );
    expect(err.code).toBe("UNKNOWN");
    expect(err.message).toBe("Something exploded");
    expect(err.suggestions).toEqual([UNKNOWN_SUGGESTION]);
  });

  it("reports the exit code when stderr is empty", () => {
    const err = mapNetlifyError("", 3);
    expect(err.message).toBe("netlify exited with code 3");
  });
});
