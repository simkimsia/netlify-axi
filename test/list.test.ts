import { describe, expect, it } from "vitest";
import { siteRows, siteUrl } from "../src/commands/list.js";

// Trimmed from real `netlify sites:list --json` output (netlify-cli 18.x);
// the full objects carry ~100 keys, these are the ones the wrapper reads.
const SITES_FIXTURE = [
  {
    id: "ab738028-fb0a-4b71-9b4b-d4a83fdfd816",
    name: "frontdesk-calendar",
    account_name: "jane's team",
    custom_domain: null,
    url: "http://frontdesk-calendar.netlify.app",
    ssl_url: "https://frontdesk-calendar.netlify.app",
    updated_at: "2026-02-02T06:06:55.824Z",
  },
  {
    id: "1f4e21aa-0000-0000-0000-000000000000",
    name: "smartly",
    account_name: "jane's team",
    custom_domain: "app.example.com",
    url: "http://smartly.netlify.app",
    ssl_url: "https://smartly.netlify.app",
    updated_at: "2026-08-25T11:58:04.817Z",
  },
];

describe("siteUrl", () => {
  it("prefers the custom domain when set", () => {
    expect(siteUrl(SITES_FIXTURE[1])).toBe("https://app.example.com");
  });

  it("falls back to ssl_url, then url", () => {
    expect(siteUrl(SITES_FIXTURE[0])).toBe(
      "https://frontdesk-calendar.netlify.app",
    );
    expect(siteUrl({ id: "x", name: "x", url: "http://x.netlify.app" })).toBe(
      "http://x.netlify.app",
    );
  });
});

describe("siteRows", () => {
  it("flattens to 4 fields and sorts most recently updated first", () => {
    const rows = siteRows(SITES_FIXTURE);
    expect(rows.map((r) => r.name)).toEqual(["smartly", "frontdesk-calendar"]);
    expect(Object.keys(rows[0])).toEqual(["name", "team", "url", "updated"]);
    expect(rows[0].team).toBe("jane's team");
    expect(rows[0].url).toBe("https://app.example.com");
  });

  it("tolerates missing optional fields", () => {
    const rows = siteRows([{ id: "x", name: "bare" }]);
    expect(rows[0]).toEqual({
      name: "bare",
      team: "unknown",
      url: "unknown",
      updated: "unknown",
    });
  });
});
