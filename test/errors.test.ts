import { describe, expect, it } from "vitest";
import {
  exitCodeForError,
  mapNetlifyError,
  UNKNOWN_SUGGESTION,
} from "../src/errors.js";

// All inputs below are verbatim netlify-cli 18.x stderr captured from real runs.
describe("mapNetlifyError", () => {
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
