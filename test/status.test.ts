import { describe, expect, it } from "vitest";
import { parseStatus } from "../src/commands/status.js";

// Verbatim shape of `netlify status --json` (netlify-cli 18.x, linked dir):
// note the dash-cased keys and capitalized account keys.
const LINKED_FIXTURE = {
  account: {
    Email: "jane@example.com",
    Teams: {
      "jane's team": "Owner Developer Reviewer Publisher Internal Builder",
    },
  },
  siteData: {
    "site-name": "pbsg-frontdesk-calendar",
    "admin-url": "https://app.netlify.com/projects/pbsg-frontdesk-calendar",
    "site-url": "https://pbsg-frontdesk-calendar.netlify.app",
    "site-id": "ab738028-fb0a-4b71-9b4b-d4a83fdfd816",
  },
};

describe("parseStatus", () => {
  it("flattens the dash-cased siteData keys and team names", () => {
    expect(parseStatus(LINKED_FIXTURE)).toEqual({
      site: "pbsg-frontdesk-calendar",
      url: "https://pbsg-frontdesk-calendar.netlify.app",
      admin: "https://app.netlify.com/projects/pbsg-frontdesk-calendar",
      id: "ab738028-fb0a-4b71-9b4b-d4a83fdfd816",
      teams: ["jane's team"],
    });
  });

  it("tolerates a missing siteData block without throwing", () => {
    expect(parseStatus({})).toEqual({
      site: "unknown",
      url: "unknown",
      admin: "unknown",
      id: "unknown",
    });
  });
});
