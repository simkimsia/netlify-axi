import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decode } from "@toon-format/toon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiError } from "../src/errors.js";

// No test may reach the real netlify binary: every call goes through these
// mocks, and a deploy is never run for real.
const { netlifyJson, netlifyExec } = vi.hoisted(() => ({
  netlifyJson: vi.fn(),
  netlifyExec: vi.fn(),
}));
vi.mock("../src/netlify.js", () => ({ netlifyJson, netlifyExec }));

const {
  deployArgv,
  deployCommand,
  noTargetError,
  parseDeployArgs,
  parseDeployOutput,
  pickTeam,
  renderDeploy,
} = await import("../src/commands/deploy.js");

const DIR = mkdtempSync(join(tmpdir(), "netlify-axi-deploy-"));
const FILE = join(DIR, "index.html");
writeFileSync(FILE, "<h1>hi</h1>");

// Shape of `netlify deploy --json --prod` as netlify-cli 18.x writes it. Not
// captured from a live run: this repo never runs a real deploy in tests.
const PROD_RESULT = {
  name: "my-mockup",
  site_id: "ab738028-fb0a-4b71-9b4b-d4a83fdfd816",
  site_name: "my-mockup",
  deploy_id: "6718f0c2a1b2c3d4e5f60718",
  deploy_url: "https://6718f0c2a1b2c3d4e5f60718--my-mockup.netlify.app",
  logs: "https://app.netlify.com/sites/my-mockup/deploys/6718f0c2a1b2c3d4e5f60718",
  url: "https://my-mockup.netlify.app",
};

function validationError(fn: () => unknown): AxiError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AxiError);
    return error as AxiError;
  }
  throw new Error("expected a throw");
}

describe("parseDeployArgs", () => {
  it("reads every flag in --flag value and --flag=value form", () => {
    expect(
      parseDeployArgs([
        "--dir=public",
        "--prod",
        "--create-site",
        "my-mockup",
        "--team",
        "acme",
        "--message",
        "first cut",
        "--no-build",
      ]),
    ).toEqual({
      dir: "public",
      prod: true,
      site: undefined,
      createSite: "my-mockup",
      team: "acme",
      alias: undefined,
      message: "first cut",
      noBuild: true,
    });
  });

  it("requires --dir", () => {
    expect(validationError(() => parseDeployArgs(["--prod"])).message).toBe(
      "--dir is required",
    );
  });

  it("rejects unknown flags and stray arguments by name", () => {
    const flag = validationError(() =>
      parseDeployArgs(["--dir", "x", "--force"]),
    );
    expect(flag.code).toBe("VALIDATION_ERROR");
    expect(flag.message).toContain("--force");
    expect(
      validationError(() => parseDeployArgs(["--dir", "x", "extra"])).message,
    ).toContain("unknown argument extra");
  });

  it("rejects a flag with no value and a repeated flag", () => {
    expect(
      validationError(() => parseDeployArgs(["--dir", "--prod"])).message,
    ).toBe("--dir requires a value");
    expect(
      validationError(() => parseDeployArgs(["--dir", "a", "--dir", "b"]))
        .message,
    ).toBe("--dir given more than once");
    expect(
      validationError(() => parseDeployArgs(["--dir", "a", "--prod", "--prod"]))
        .message,
    ).toBe("--prod given more than once");
  });

  it("rejects conflicting target and mode flags", () => {
    expect(
      validationError(() =>
        parseDeployArgs(["--dir", "a", "--site", "s", "--create-site", "n"]),
      ).message,
    ).toContain("cannot be used together");
    expect(
      validationError(() => parseDeployArgs(["--dir", "a", "--team", "t"]))
        .message,
    ).toContain("--team only applies");
    expect(
      validationError(() =>
        parseDeployArgs(["--dir", "a", "--prod", "--alias", "x"]),
      ).message,
    ).toContain("cannot be used with --prod");
    expect(
      validationError(() => parseDeployArgs(["--dir", "a", "--prod=yes"]))
        .message,
    ).toContain("takes no value");
  });
});

describe("pickTeam", () => {
  it("uses the only team", () => {
    expect(pickTeam([{ slug: "acme", name: "Acme" }])).toBe("acme");
  });

  it("refuses and lists slugs when there are several", () => {
    const error = validationError(() =>
      pickTeam([{ slug: "acme" }, { slug: "jane" }]),
    );
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.suggestions).toEqual(["Pass --team with one of: acme, jane"]);
  });
});

describe("noTargetError", () => {
  it("lists site names and caps a long list", () => {
    const sites = Array.from({ length: 22 }, (_, i) => ({
      id: String(i),
      name: `site-${i}`,
    }));
    const error = noTargetError(sites);
    expect(error.code).toBe("NOT_LINKED");
    expect(error.suggestions[0]).toContain("site-0, site-1");
    expect(error.suggestions[0]).toContain("(+2 more");
    expect(error.suggestions[0]).not.toContain("site-21");
  });
});

describe("parseDeployOutput", () => {
  it("parses clean JSON", () => {
    expect(parseDeployOutput(JSON.stringify(PROD_RESULT, null, 2))).toEqual(
      PROD_RESULT,
    );
  });

  it("skips build output printed before the JSON document", () => {
    const stdout = `Netlify Build\n{not json}\n${JSON.stringify(PROD_RESULT, null, 2)}\n`;
    expect(parseDeployOutput(stdout).deploy_id).toBe(PROD_RESULT.deploy_id);
  });

  it("throws UNKNOWN with a next step on unparseable output", () => {
    const error = validationError(() => parseDeployOutput("Deploying..."));
    expect(error.code).toBe("UNKNOWN");
    expect(error.suggestions.length).toBe(1);
  });
});

describe("renderDeploy", () => {
  it("prints site, ids, state and the production URL for --prod", () => {
    const out = renderDeploy(PROD_RESULT, { prod: true, created: true });
    const [toon] = out.split("\nhelp[");
    expect(decode(toon)).toEqual({
      deploy: {
        site: "my-mockup",
        site_id: PROD_RESULT.site_id,
        site_created: true,
        deploy_id: PROD_RESULT.deploy_id,
        state: "ready",
        production: true,
        url: "https://my-mockup.netlify.app",
        deploy_url: PROD_RESULT.deploy_url,
        logs: PROD_RESULT.logs,
      },
    });
  });

  it("prints the draft URL and a --prod hint for a draft", () => {
    const { url: _url, ...draft } = PROD_RESULT;
    const out = renderDeploy(draft, { prod: false, created: false });
    expect(out).toContain(`url: "${PROD_RESULT.deploy_url}"`);
    expect(out).toContain("production: false");
    expect(out).toContain("Rerun with --prod");
  });
});

describe("deployArgv", () => {
  it("always asks for --json and forwards only flags that were given", () => {
    const opts = parseDeployArgs(["--dir", "a", "--alias", "pr-1"]);
    expect(deployArgv(opts, "/abs/a", { site: "my-site" })).toEqual([
      "deploy",
      "--json",
      "--dir",
      "/abs/a",
      "--site",
      "my-site",
      "--alias",
      "pr-1",
    ]);
  });
});

describe("deployCommand (netlify mocked)", () => {
  beforeEach(() => {
    netlifyJson.mockReset();
    netlifyExec.mockReset();
    netlifyExec.mockResolvedValue(JSON.stringify(PROD_RESULT));
  });

  it("rejects a --dir that is not a directory before any netlify call", async () => {
    const error = await deployCommand(["--dir", FILE]).catch((e) => e);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(netlifyJson).not.toHaveBeenCalled();
    expect(netlifyExec).not.toHaveBeenCalled();
  });

  it("creates a site in the only team and deploys to production", async () => {
    netlifyJson.mockResolvedValueOnce([{ slug: "acme" }]);
    const out = await deployCommand([
      "--dir",
      DIR,
      "--prod",
      "--create-site",
      "my-mockup",
    ]);
    expect(netlifyJson).toHaveBeenCalledWith(["api", "listAccountsForUser"]);
    expect(netlifyExec).toHaveBeenCalledWith([
      "deploy",
      "--json",
      "--dir",
      DIR,
      "--create-site",
      "my-mockup",
      "--team",
      "acme",
      "--prod",
    ]);
    expect(out).toContain("site_created: true");
    expect(out).toContain('url: "https://my-mockup.netlify.app"');
  });

  it("refuses --create-site without --team when there are several teams", async () => {
    netlifyJson.mockResolvedValueOnce([{ slug: "acme" }, { slug: "jane" }]);
    const error = await deployCommand([
      "--dir",
      DIR,
      "--create-site",
      "x",
    ]).catch((e) => e);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(netlifyExec).not.toHaveBeenCalled();
  });

  it("deploys to the linked site by id when no target is named", async () => {
    netlifyJson.mockResolvedValueOnce({
      siteData: { "site-name": "linked", "site-id": "linked-id" },
    });
    await deployCommand(["--dir", DIR]);
    expect(netlifyJson).toHaveBeenCalledWith(["status", "--json"]);
    expect(netlifyExec.mock.calls[0]![0]).toEqual([
      "deploy",
      "--json",
      "--dir",
      DIR,
      "--site",
      "linked-id",
    ]);
  });

  it("refuses and lists sites when nothing is named or linked", async () => {
    netlifyJson
      .mockRejectedValueOnce(new AxiError("not linked", "NOT_LINKED"))
      .mockResolvedValueOnce([
        { id: "1", name: "alpha" },
        { id: "2", name: "beta" },
      ]);
    const error = await deployCommand(["--dir", DIR]).catch((e) => e);
    expect(error.code).toBe("NOT_LINKED");
    expect(error.suggestions[0]).toBe("Pass --site with one of: alpha, beta");
    expect(netlifyExec).not.toHaveBeenCalled();
  });

  it("passes other status errors through without deploying", async () => {
    netlifyJson.mockRejectedValueOnce(new AxiError("Not logged in", "AUTH"));
    const error = await deployCommand(["--dir", DIR]).catch((e) => e);
    expect(error.code).toBe("AUTH");
    expect(netlifyExec).not.toHaveBeenCalled();
  });
});
