import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decode } from "@toon-format/toon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiError, mapNetlifyError } from "../src/errors.js";

// No test may reach the real netlify binary: every call goes through these
// mocks, and a deploy is never run for real.
const { netlifyJson, netlifyExec } = vi.hoisted(() => ({
  netlifyJson: vi.fn(),
  netlifyExec: vi.fn(),
}));
vi.mock("../src/netlify.js", () => ({
  netlifyJson,
  netlifyExec,
  DEPLOY_MAX_BUFFER_BYTES: 64 * 1024 * 1024,
}));

// `netlify -V` and `netlify deploy` both go through netlifyExec. Route them
// apart so each test scripts the deploy on deployExec alone; -V reports a
// current netlify-cli unless a test sets `version`.
const CURRENT_CLI = "netlify-cli/23.5.0 darwin-arm64 node-v22.1.0\n";
const deployExec = vi.fn();
let version: string | Error = CURRENT_CLI;
function routeExec(): void {
  netlifyExec.mockReset();
  deployExec.mockReset();
  version = CURRENT_CLI;
  netlifyExec.mockImplementation(async (args: string[], options?: unknown) => {
    if (args[0] === "-V") {
      if (version instanceof Error) throw version;
      return version;
    }
    return deployExec(args, options);
  });
}

const {
  deployArgv,
  deployCommand,
  parseDeployArgs,
  parseDeployOutput,
  parseNetlifyVersion,
  pickTeam,
  renderDeploy,
} = await import("../src/commands/deploy.js");
const { noTargetError } = await import("../src/sites.js");

const DIR = mkdtempSync(join(tmpdir(), "netlify-axi-deploy-"));
const FILE = join(DIR, "index.html");
writeFileSync(FILE, "<h1>hi</h1>");

// Keys of `netlify deploy --json --prod` as netlify-cli 23.2.0's printResults
// writes them (read from its published source). Values are made up: this repo
// never runs a real deploy, in tests or anywhere else.
const PROD_RESULT = {
  site_id: "ab738028-fb0a-4b71-9b4b-d4a83fdfd816",
  site_name: "my-mockup",
  deploy_id: "6718f0c2a1b2c3d4e5f60718",
  deploy_url: "https://6718f0c2a1b2c3d4e5f60718--my-mockup.netlify.app",
  logs: "https://app.netlify.com/projects/my-mockup/deploys/6718f0c2a1b2c3d4e5f60718",
  function_logs: "https://app.netlify.com/projects/my-mockup/logs/functions",
  edge_function_logs:
    "https://app.netlify.com/projects/my-mockup/logs/edge-functions",
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
    const error = noTargetError(sites, { createSite: true });
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

  it("never echoes stdout when it cannot find a deploy result", () => {
    const stdout = "Netlify Build\nSECRET_TOKEN=hunter2 npm run build\n";
    const error = validationError(() => parseDeployOutput(stdout));
    expect(error.code).toBe("DEPLOY_NOT_REPORTED");
    const rendered = [error.message, ...error.suggestions].join("\n");
    expect(rendered).not.toContain("hunter2");
    expect(rendered).not.toContain("SECRET_TOKEN");
  });

  it("treats JSON without a deploy_id as no deploy, not success", () => {
    const error = validationError(() =>
      parseDeployOutput('{"site_id":"abc","site_name":"x"}'),
    );
    expect(error.code).toBe("DEPLOY_NOT_REPORTED");
  });

  it("treats empty stdout (e.g. a declined lock prompt) as no deploy", () => {
    const error = validationError(() => parseDeployOutput(""));
    expect(error.code).toBe("DEPLOY_NOT_REPORTED");
    expect(error.suggestions.join(" ")).toContain("locked");
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
    routeExec();
    deployExec.mockResolvedValue(JSON.stringify(PROD_RESULT));
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
    expect(deployExec).toHaveBeenCalledWith(
      [
        "deploy",
        "--json",
        "--dir",
        DIR,
        "--create-site",
        "my-mockup",
        "--team",
        "acme",
        "--prod",
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    expect(netlifyExec).toHaveBeenCalledWith(["-V"]);
    expect(out).toContain("site_created: true");
    expect(out).not.toContain("could not read the netlify-cli version");
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
    expect(deployExec.mock.calls[0]![0]).toEqual([
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

describe("netlify-cli too old for deploy", () => {
  beforeEach(() => {
    netlifyJson.mockReset();
    routeExec();
  });

  it("reads the version from `netlify -V`", () => {
    expect(
      parseNetlifyVersion("netlify-cli/18.0.1 darwin-arm64 node-v22.1.0\n"),
    ).toBe("18.0.1");
    expect(parseNetlifyVersion("")).toBeUndefined();
  });

  it.each(["18.0.1", "20.1.1", "23.1.0"])(
    "refuses netlify-cli %s before deploying",
    async (old) => {
      version = `netlify-cli/${old} darwin-arm64 node-v22.1.0\n`;
      const error = await deployCommand(["--dir", DIR, "--site", "s"]).catch(
        (e) => e,
      );
      expect(error.code).toBe("NETLIFY_TOO_OLD");
      expect(error.message).toBe(
        `netlify-cli ${old} is too old for \`deploy\``,
      );
      expect(error.suggestions[0]).toContain(">= 23.2.0");
      expect(deployExec).not.toHaveBeenCalled();
    },
  );

  it("deploys on netlify-cli 23.2.0 and reads the version once", async () => {
    version = "netlify-cli/23.2.0 linux-x64 node-v20.11.0\n";
    deployExec.mockResolvedValueOnce(JSON.stringify(PROD_RESULT));
    await deployCommand(["--dir", DIR, "--site", "s"]);
    expect(netlifyExec.mock.calls.filter(([a]) => a[0] === "-V")).toHaveLength(
      1,
    );
    expect(deployExec).toHaveBeenCalledTimes(1);
  });

  it("proceeds and says so when the version cannot be read", async () => {
    version = new AxiError("boom", "UNKNOWN");
    deployExec.mockResolvedValueOnce(JSON.stringify(PROD_RESULT));
    const out = await deployCommand(["--dir", DIR, "--site", "s"]);
    expect(out).toContain("deploy_id:");
    expect(out).toContain("could not read the netlify-cli version");
    expect(out).toContain(">= 23.2.0");
  });

  it("proceeds when -V prints something unparseable", async () => {
    version = "garbage\n";
    deployExec.mockResolvedValueOnce(JSON.stringify(PROD_RESULT));
    const out = await deployCommand(["--dir", DIR, "--site", "s"]);
    expect(out).toContain("could not read the netlify-cli version");
  });

  it("reports a missing netlify binary from the version check", async () => {
    version = new AxiError("not installed", "NETLIFY_NOT_INSTALLED");
    const error = await deployCommand(["--dir", DIR, "--site", "s"]).catch(
      (e) => e,
    );
    expect(error.code).toBe("NETLIFY_NOT_INSTALLED");
    expect(deployExec).not.toHaveBeenCalled();
  });

  it("still gives the upgrade instruction for an unknown option when the version cannot be read", async () => {
    // netlify-cli 18.0.1 has no --create-site; commander rejects it with this
    // stderr (outputError hook in its dist/commands/main.js).
    const rejection = mapNetlifyError(
      " ›   Error: unknown option '--create-site'\n ›   See more help with --help\n",
      1,
    );
    expect(rejection.code).toBe("NETLIFY_TOO_OLD");
    version = "";
    deployExec.mockRejectedValueOnce(rejection);
    const error = await deployCommand([
      "--dir",
      DIR,
      "--create-site",
      "x",
      "--team",
      "acme",
    ]).catch((e) => e);
    expect(error.code).toBe("NETLIFY_TOO_OLD");
    expect(error.message).toContain("(version unknown) is too old");
    expect(error.suggestions[0]).toContain(">= 23.2.0");
    expect(netlifyExec.mock.calls.filter(([a]) => a[0] === "-V")).toHaveLength(
      1,
    );
  });

  it("does not call netlify-cli 23.5.0 too old for an unknown option", async () => {
    deployExec.mockRejectedValueOnce(
      mapNetlifyError(" ›   Error: unknown option '--foo'\n", 1),
    );
    const error = await deployCommand(["--dir", DIR, "--site", "s"]).catch(
      (e) => e,
    );
    expect(error.code).toBe("UNKNOWN");
    expect(error.message).not.toContain("too old");
    expect(error.message).toContain("build failed");
  });
});

describe("deploy stopped mid-way (buffer overflow or signal)", () => {
  beforeEach(() => {
    netlifyJson.mockReset();
    routeExec();
  });

  it("uses the linked site id in interrupted-deploy recovery guidance", async () => {
    netlifyJson.mockResolvedValueOnce({
      siteData: { "site-id": "linked-id" },
    });
    deployExec.mockRejectedValueOnce(
      new AxiError("stopped by signal", "NETLIFY_INTERRUPTED"),
    );
    const error = await deployCommand(["--dir", DIR]).catch((e) => e);
    expect(error.code).toBe("DEPLOY_NOT_REPORTED");
    expect(error.message).toContain("a deploy may have started");
    expect(error.suggestions[0]).toContain("netlify-axi deploys --site linked-id");
  });

  it("preserves interruption during team resolution without checking the version or deploying", async () => {
    const interrupted = new AxiError("stopped by signal", "NETLIFY_INTERRUPTED");
    netlifyJson.mockRejectedValueOnce(interrupted);
    const error = await deployCommand([
      "--dir", DIR, "--create-site", "new-site",
    ]).catch((e) => e);
    expect(error).toBe(interrupted);
    expect(netlifyExec).not.toHaveBeenCalled();
  });

  it("runs netlify deploy with the larger deploy buffer", async () => {
    deployExec.mockResolvedValueOnce(JSON.stringify(PROD_RESULT));
    await deployCommand(["--dir", DIR, "--site", "s"]);
    expect(deployExec.mock.calls[0]![1]).toEqual({
      maxBuffer: 64 * 1024 * 1024,
    });
  });

  it.each([
    ["--site", ["--site", "my-site"], "my-site"],
    [
      "--create-site",
      ["--create-site", "new-site", "--team", "acme"],
      "new-site",
    ],
  ])(
    "says a deploy may have started and how to check (%s)",
    async (_n, flags, site) => {
      deployExec.mockRejectedValueOnce(
        new AxiError(
          "netlify was stopped before it finished: its output passed netlify-axi's 64 MB limit",
          "NETLIFY_INTERRUPTED",
        ),
      );
      const error = await deployCommand(["--dir", DIR, ...flags]).catch(
        (e) => e,
      );
      expect(error.code).toBe("DEPLOY_NOT_REPORTED");
      expect(error.message).toContain("a deploy may have started");
      expect(error.suggestions[0]).toContain(
        `netlify-axi deploys --site ${site}`,
      );
    },
  );
});

describe("failed deploy output is never echoed", () => {
  const SECRET = "sk_live_FAKE_SECRET_123";

  beforeEach(() => {
    netlifyJson.mockReset();
    routeExec();
  });

  const failures: Array<[string, string]> = [
    [
      "build output on stdout, empty stderr",
      `> build\nAPI_KEY=${SECRET}\nBuild failed`,
    ],
    [
      "build output on stderr",
      `API_KEY=${SECRET}\nCommand failed with exit code 1`,
    ],
    [
      "config error",
      ` ›   Error: When resolving config file /r/netlify.toml: ${SECRET} does not exist`,
    ],
    ["not-found wording", `token ${SECRET} not found`],
    [
      "commander error from a build tool",
      `vite build\nerror: unknown option '--foo'\nTOKEN=${SECRET}`,
    ],
  ];

  it.each(failures)("%s", async (_name, output) => {
    deployExec.mockRejectedValueOnce(mapNetlifyError(output, 1));
    const error = await deployCommand(["--dir", DIR, "--site", "s"]).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(AxiError);
    expect(error.code).not.toBe("NETLIFY_TOO_OLD");
    expect(error.message).not.toContain(SECRET);
    expect(error.suggestions.join("\n")).not.toContain(SECRET);
    expect(deployExec).toHaveBeenCalledTimes(1);
  });
});

describe("deploy keeps netlify's own error codes only", () => {
  beforeEach(() => {
    netlifyJson.mockReset();
    routeExec();
  });

  async function deployFailure(output: string): Promise<AxiError> {
    deployExec.mockRejectedValueOnce(mapNetlifyError(output, 1));
    return deployCommand(["--dir", DIR, "--site", "s"]).catch((e) => e);
  }

  it.each([
    ["Module not found", "> webpack\nModule not found: Can't resolve './x'"],
    ["Unauthorized", "> fetch-data\nRequest failed: 401 Unauthorized"],
  ])(
    "an undecorated %s in build output is a build failure",
    async (_n, out) => {
      const error = await deployFailure(out);
      expect(error.code).toBe("UNKNOWN");
      expect(error.message).toContain("build failed");
    },
  );

  it("a decorated netlify auth error stays AUTH", async () => {
    const error = await deployFailure(" ›   JSONHTTPError: Unauthorized");
    expect(error.code).toBe("AUTH");
    expect(error.suggestions.join(" ")).toContain("netlify login");
  });

  it("finds netlify's own error behind an earlier build-output match", async () => {
    const error = await deployFailure(
      "npm warn fetch GET 401 Unauthorized\n ›   JSONHTTPError: Not Found",
    );
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).not.toContain("Unauthorized");
  });
});

describe("deploy's team lookup never echoes raw netlify output", () => {
  beforeEach(() => {
    netlifyJson.mockReset();
    routeExec();
  });

  it("rewrites an unrecognized listAccountsForUser failure to fixed text", async () => {
    netlifyJson.mockRejectedValueOnce(
      mapNetlifyError(" ›   Error: boom SECRET_TOKEN=abc123", 1),
    );
    const error = await deployCommand([
      "--dir",
      DIR,
      "--create-site",
      "x",
    ]).catch((e) => e);
    expect(error.code).toBe("UNKNOWN");
    expect(error.message).toBe(
      "`netlify api listAccountsForUser` failed (output not shown)",
    );
    expect(netlifyExec).not.toHaveBeenCalled();
  });

  it("keeps AUTH from the team lookup", async () => {
    netlifyJson.mockRejectedValueOnce(
      mapNetlifyError(" ›   JSONHTTPError: Unauthorized", 1),
    );
    const error = await deployCommand([
      "--dir",
      DIR,
      "--create-site",
      "x",
    ]).catch((e) => e);
    expect(error.code).toBe("AUTH");
  });
});
