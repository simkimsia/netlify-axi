import { decode } from "@toon-format/toon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiError, mapNetlifyError } from "../src/errors.js";

// No test may reach the real netlify binary: every call goes through these mocks.
const { netlifyJson, netlifyExec } = vi.hoisted(() => ({
  netlifyJson: vi.fn(),
  netlifyExec: vi.fn(),
}));
vi.mock("../src/netlify.js", () => ({ netlifyJson, netlifyExec }));

const {
  DEFAULT_LIMIT,
  deployRows,
  deploysArgv,
  deploysCommand,
  parseDeploysArgs,
  renderDeploys,
} = await import("../src/commands/deploys.js");
const { findSite } = await import("../src/sites.js");

const SITE_ID = "ab738028-fb0a-4b71-9b4b-d4a83fdfd816";

// Keys as the open-api `site` definition names them (netlify-cli 18.0.1's
// bundled @netlify/open-api); values are made up.
const SITES = [
  {
    id: SITE_ID,
    name: "my-app",
    custom_domain: "app.example.com",
    ssl_url: "https://my-app.netlify.app",
    admin_url: "https://app.netlify.com/sites/my-app",
    published_deploy: {
      id: "d2",
      branch: "main",
      commit_ref: "1390f2c0a1b2c3d4e5f60718293a4b5c6d7e8f90",
      published_at: "2026-10-20T06:00:00.000Z",
    },
  },
  { id: "other-id", name: "other" },
];

// Keys as the open-api `deploy` definition names them; values are made up.
const DEPLOYS = [
  {
    id: "d1",
    state: "ready",
    context: "deploy-preview",
    branch: "feat-x",
    commit_ref: "aaaa111",
    created_at: "2026-10-19T06:00:00.000Z",
    published_at: null,
  },
  {
    id: "d3",
    state: "error",
    context: "production",
    branch: "main",
    commit_ref: "bbbb222",
    error_message: "Build script returned non-zero exit code: 2",
    created_at: "2026-10-21T06:00:00.000Z",
    published_at: null,
  },
  {
    id: "d2",
    state: "ready",
    context: "production",
    branch: "main",
    commit_ref: "1390f2c0a1b2c3d4e5f60718293a4b5c6d7e8f90",
    created_at: "2026-10-20T05:58:00.000Z",
    published_at: "2026-10-20T06:00:00.000Z",
  },
];

describe("parseDeploysArgs", () => {
  it("defaults to the linked site and 10 deploys", () => {
    expect(parseDeploysArgs([])).toEqual({
      site: undefined,
      limit: DEFAULT_LIMIT,
    });
  });

  it("reads --site and --limit in both forms", () => {
    expect(parseDeploysArgs(["--site", "my-app", "--limit=30"])).toEqual({
      site: "my-app",
      limit: 30,
    });
  });

  it.each(["0", "101", "abc", "2.5", "-3"])("rejects --limit %s", (value) => {
    const error = (() => {
      try {
        parseDeploysArgs([`--limit=${value}`]);
      } catch (e) {
        return e as AxiError;
      }
    })();
    expect(error?.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a positional site and unknown flags by name", () => {
    expect(() => parseDeploysArgs(["my-app"])).toThrow(
      "unknown argument my-app for `deploys`",
    );
    expect(() => parseDeploysArgs(["--prod"])).toThrow(
      "unknown flag --prod for `deploys`",
    );
  });
});

describe("deploysArgv", () => {
  it("asks the API for one page of the site's deploys", () => {
    expect(deploysArgv(SITE_ID, 5)).toEqual([
      "api",
      "listSiteDeploys",
      "--data",
      `{"site_id":"${SITE_ID}","per_page":5}`,
    ]);
  });
});

describe("findSite", () => {
  it("matches id, name (any case), or custom domain, never a prefix", () => {
    expect(findSite(SITES, SITE_ID)?.name).toBe("my-app");
    expect(findSite(SITES, "My-App")?.name).toBe("my-app");
    expect(findSite(SITES, "app.example.com")?.name).toBe("my-app");
    expect(findSite(SITES, "my")).toBeUndefined();
  });
});

describe("deployRows", () => {
  it("sorts newest first and flags the live deploy", () => {
    const rows = deployRows(DEPLOYS, "d2");
    expect(rows.map((r) => r.deploy_id)).toEqual(["d3", "d2", "d1"]);
    expect(rows.map((r) => r.live)).toEqual([false, true, false]);
    expect(Object.keys(rows[0])).toEqual([
      "deploy_id",
      "state",
      "context",
      "branch",
      "commit_ref",
      "created_at",
      "published_at",
      "live",
      "error_message",
    ]);
    expect(rows[2].published_at).toBe("never");
    expect(rows[0].error_message).toContain("non-zero exit code");
  });

  it("drops the error column when no deploy failed and fills nulls", () => {
    const rows = deployRows([{ id: "x" }], undefined);
    expect(rows[0]).toEqual({
      deploy_id: "x",
      state: "unknown",
      context: "none",
      branch: "none",
      commit_ref: "none",
      created_at: "unknown",
      published_at: "never",
      live: false,
    });
  });
});

describe("renderDeploys", () => {
  it("shows the live deploy, a table, and next steps", () => {
    const out = renderDeploys(SITES[0], DEPLOYS, 3);
    const parsed = decode(out.split("\nhelp[")[0]) as Record<string, unknown>;
    expect(parsed.site).toBe("my-app");
    expect(parsed.live).toMatchObject({
      deploy_id: "d2",
      commit_ref: "1390f2c0a1b2c3d4e5f60718293a4b5c6d7e8f90",
      url: "https://app.example.com",
    });
    expect((parsed.deploys as unknown[]).length).toBe(3);
    expect(out).toContain("pass --limit <n>");
    expect(out).toContain("https://app.netlify.com/sites/my-app/deploys/d3");
  });

  it("says when the live deploy is older than the window", () => {
    const out = renderDeploys(SITES[0], [DEPLOYS[1]], 10);
    expect(out).toContain("The live deploy d2 is older than these 1");
    expect(out).not.toContain("pass --limit");
  });

  it("has an empty state", () => {
    const out = renderDeploys(SITES[1], [], 10);
    expect(out).toContain("live: none (nothing published yet)");
    expect(out).toContain("deploys: 0 deploys found for other");
  });
});

describe("deploysCommand (netlify mocked)", () => {
  beforeEach(() => {
    netlifyJson.mockReset();
    netlifyExec.mockReset();
  });

  it("resolves --site by name to its id without reading the link", async () => {
    netlifyJson.mockResolvedValueOnce(SITES).mockResolvedValueOnce(DEPLOYS);
    const out = await deploysCommand(["--site", "my-app", "--limit", "3"]);
    expect(netlifyJson.mock.calls.map((c) => c[0])).toEqual([
      ["sites:list", "--json"],
      deploysArgv(SITE_ID, 3),
    ]);
    expect(out).toContain("count: 3 deploys (newest first)");
  });

  it("uses the linked site when --site is absent", async () => {
    netlifyJson
      .mockResolvedValueOnce({ siteData: { "site-id": SITE_ID } })
      .mockResolvedValueOnce(SITES)
      .mockResolvedValueOnce(DEPLOYS);
    await deploysCommand([]);
    expect(netlifyJson.mock.calls.map((c) => c[0])).toEqual([
      ["status", "--json"],
      ["sites:list", "--json"],
      deploysArgv(SITE_ID, DEFAULT_LIMIT),
    ]);
  });

  it("refuses with NOT_LINKED and lists sites when nothing is named or linked", async () => {
    netlifyJson
      .mockRejectedValueOnce(new AxiError("not linked", "NOT_LINKED"))
      .mockResolvedValueOnce(SITES);
    const error = await deploysCommand([]).catch((e) => e);
    expect(error.code).toBe("NOT_LINKED");
    expect(error.suggestions).toEqual([
      "Pass --site with one of: my-app, other",
    ]);
    expect(netlifyJson).toHaveBeenCalledTimes(2);
  });

  it("refuses an unknown --site with NOT_FOUND and the names", async () => {
    netlifyJson.mockResolvedValueOnce(SITES);
    const error = await deploysCommand(["--site", "nope"]).catch((e) => e);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("No site named nope in this account");
    expect(error.suggestions[0]).toBe("Pass --site with one of: my-app, other");
    expect(netlifyJson).toHaveBeenCalledTimes(1);
  });

  it("rejects bad input before any netlify call", async () => {
    const error = await deploysCommand(["--limit", "0"]).catch((e) => e);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(netlifyJson).not.toHaveBeenCalled();
  });

  it("passes auth errors through", async () => {
    netlifyJson.mockRejectedValueOnce(
      mapNetlifyError(" ›   JSONHTTPError: Unauthorized", 1),
    );
    const error = await deploysCommand(["--site", "my-app"]).catch((e) => e);
    expect(error.code).toBe("AUTH");
  });
});

describe("deploys never echoes raw netlify output in errors", () => {
  beforeEach(() => netlifyJson.mockReset());

  it("replaces an unrecognized listSiteDeploys failure with fixed text", async () => {
    const secret = "SECRET_TOKEN=abc123";
    netlifyJson
      .mockResolvedValueOnce(SITES)
      .mockRejectedValueOnce(mapNetlifyError(` ›   Error: boom ${secret}`, 1));
    const error = await deploysCommand(["--site", "my-app"]).catch((e) => e);
    expect(error.code).toBe("UNKNOWN");
    expect(error.message).toBe(
      "`netlify api listSiteDeploys` failed (output not shown)",
    );
    expect(JSON.stringify(error.suggestions)).not.toContain(secret);
  });

  it("gives a fixed NOT_FOUND for the deploys call", async () => {
    netlifyJson
      .mockResolvedValueOnce(SITES)
      .mockRejectedValueOnce(
        mapNetlifyError(" ›   JSONHTTPError: Not Found", 1),
      );
    const error = await deploysCommand(["--site", "my-app"]).catch((e) => e);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Netlify has no deploys for site my-app");
  });

  it("hides a broken netlify.toml path behind a fixed CONFIG message", async () => {
    netlifyJson.mockRejectedValueOnce(
      mapNetlifyError(
        " ›   Error: When resolving config file /secret/path/netlify.toml: Base directory does not exist: /x",
        1,
      ),
    );
    const error = await deploysCommand([]).catch((e) => e);
    expect(error.code).toBe("CONFIG");
    expect(error.message).not.toContain("/secret/path");
  });
});
