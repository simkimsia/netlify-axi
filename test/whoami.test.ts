import { describe, expect, it } from "vitest";
import { parseUser } from "../src/commands/whoami.js";

describe("parseUser", () => {
  it("keeps email, drops a null full_name, includes the site count", () => {
    // Real `netlify api getCurrentUser` responses often have full_name: null.
    expect(
      parseUser({ email: "jane@example.com", full_name: null, site_count: 5 }),
    ).toEqual({ user: { email: "jane@example.com", sites: 5 } });
  });

  it("includes the name when present", () => {
    expect(
      parseUser({ email: "jane@example.com", full_name: "Jane Doe" }),
    ).toEqual({ user: { email: "jane@example.com", name: "Jane Doe" } });
  });

  it("never throws on an empty object", () => {
    expect(parseUser({})).toEqual({ user: { email: "unknown" } });
  });
});
