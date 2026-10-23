import { statSync } from "node:fs";
import { resolve } from "node:path";
import { rejectExtraArgs, takeBoolFlag, takeFlag } from "../args.js";
import { AxiError, UNKNOWN_SUGGESTION } from "../errors.js";
import { netlifyExec, netlifyJson } from "../netlify.js";
import { encode, renderHelp, renderOutput } from "../toon.js";
import {
  linkedSiteId,
  listSites,
  noTargetError,
  readFailedError,
} from "../sites.js";

export const DEPLOY_HELP = `usage: netlify-axi deploy --dir <path> [--site <name-or-id> | --create-site <name> [--team <slug>]] [flags]
Uploads a directory to a Netlify site and prints the deploy it made (site, ids, state, url).
Without --prod the deploy is a draft at its own URL; production is untouched.
Without --site or --create-site it deploys to the site linked to this directory, and refuses if there is none.
Runs the site's build command before uploading unless --no-build is passed.
Needs netlify-cli >= 23.2.0 (older releases lack --create-site and --team).
flags[8]:
  --dir <path>          directory to upload (required)
  --prod                publish to the production URL
  --site <name-or-id>   existing site to deploy to
  --create-site <name>  create a new site with this name, then deploy to it
  --team <slug>         team for --create-site (required when you belong to more than one)
  --alias <name>        draft URL prefix (<alias>--<site>.netlify.app); not with --prod
  --message <text>      deploy message shown in the Netlify UI
  --no-build            upload --dir as is, without running the build command
examples:
  netlify-axi deploy --dir dist
  netlify-axi deploy --dir dist --prod
  netlify-axi deploy --dir public --prod --create-site my-mockup
`;

/** First netlify-cli release whose `deploy` has every flag forwarded here. */
export const MIN_NETLIFY_CLI = "23.2.0";

export interface DeployOptions {
  dir: string;
  prod: boolean;
  site?: string;
  createSite?: string;
  team?: string;
  alias?: string;
  message?: string;
  noBuild: boolean;
}

/** Parse and validate deploy argv. Every rejection happens before any netlify call. */
export function parseDeployArgs(argv: string[]): DeployOptions {
  const args = [...argv];
  const opts: DeployOptions = {
    dir: takeFlag("deploy", args, "--dir") ?? "",
    prod: takeBoolFlag("deploy", args, "--prod"),
    site: takeFlag("deploy", args, "--site"),
    createSite: takeFlag("deploy", args, "--create-site"),
    team: takeFlag("deploy", args, "--team"),
    alias: takeFlag("deploy", args, "--alias"),
    message: takeFlag("deploy", args, "--message"),
    noBuild: takeBoolFlag("deploy", args, "--no-build"),
  };
  rejectExtraArgs("deploy", args);

  const usage = "Run `netlify-axi deploy --help` for usage";
  if (!opts.dir) {
    throw new AxiError("--dir is required", "VALIDATION_ERROR", [
      "Pass the directory to upload, e.g. `netlify-axi deploy --dir dist`",
    ]);
  }
  if (opts.site && opts.createSite) {
    throw new AxiError(
      "--site and --create-site cannot be used together",
      "VALIDATION_ERROR",
      ["Pass --site for an existing site, or --create-site for a new one"],
    );
  }
  if (opts.team && !opts.createSite) {
    throw new AxiError(
      "--team only applies with --create-site",
      "VALIDATION_ERROR",
      [usage],
    );
  }
  if (opts.alias && opts.prod) {
    throw new AxiError(
      "--alias names a draft URL and cannot be used with --prod",
      "VALIDATION_ERROR",
      ["Drop --alias to publish to production, or drop --prod for a draft"],
    );
  }
  return opts;
}

/** Fail before netlify runs if --dir is not an existing directory. */
export function assertDirectory(dir: string): string {
  const full = resolve(dir);
  let isDir = false;
  try {
    isDir = statSync(full).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    throw new AxiError(`--dir ${dir} is not a directory`, "VALIDATION_ERROR", [
      "Pass an existing directory to upload (relative to the current one)",
    ]);
  }
  return full;
}

/** Relevant slice of one `netlify api listAccountsForUser` entry. */
export interface NetlifyAccount {
  slug?: string;
  name?: string;
}

/**
 * Pick the team for --create-site. One team is unambiguous; several mean the
 * caller must name one, so refuse and list the slugs (VISION.md: never guess).
 */
export function pickTeam(accounts: NetlifyAccount[]): string {
  const slugs = accounts
    .map((a) => a.slug)
    .filter((s): s is string => Boolean(s));
  if (slugs.length === 1) return slugs[0];
  if (slugs.length === 0) {
    throw new AxiError(
      "No Netlify team found to create the site in",
      "NOT_FOUND",
      ["Pass --team <slug> with the team to create the site in"],
    );
  }
  throw new AxiError(
    `You belong to ${slugs.length} teams; --create-site needs --team`,
    "VALIDATION_ERROR",
    [`Pass --team with one of: ${slugs.join(", ")}`],
  );
}

/** Build the argv forwarded to `netlify deploy`. */
export function deployArgv(
  opts: DeployOptions,
  dir: string,
  target: { site?: string; createSite?: string; team?: string },
): string[] {
  const argv = ["deploy", "--json", "--dir", dir];
  if (target.site) argv.push("--site", target.site);
  if (target.createSite) {
    argv.push("--create-site", target.createSite);
    if (target.team) argv.push("--team", target.team);
  }
  if (opts.prod) argv.push("--prod");
  if (opts.alias) argv.push("--alias", opts.alias);
  if (opts.message) argv.push("--message", opts.message);
  if (opts.noBuild) argv.push("--no-build");
  return argv;
}

/**
 * Shape of `netlify deploy --json`, read from netlify-cli 23.2.0's
 * dist/commands/deploy/deploy.js (printResults). `url` is set only for a
 * production deploy. netlify prints it after waitForDeploy has seen the
 * deploy reach `ready`; a failed deploy exits non-zero instead.
 */
export interface NetlifyDeployResult {
  site_id?: string;
  site_name?: string;
  deploy_id?: string;
  deploy_url?: string;
  logs?: string;
  function_logs?: string;
  edge_function_logs?: string;
  url?: string;
}

/** Help for a deploy netlify did not report: say what to check, not guess. */
const UNREPORTED_HELP = [
  "No deploy is confirmed. Check the site's deploys in the Netlify UI before retrying",
  "If production deploys are locked for this site, netlify asks to unlock them and netlify-axi cannot answer: unlock in the Netlify UI, or deploy a draft without --prod",
];

/**
 * A failed `netlify deploy` with fixed text only: its stdout and stderr carry
 * build output, which can include env values, so none of it is echoed.
 */
export function deployFailedError(error: AxiError): AxiError {
  if (error.code === "NETLIFY_NOT_INSTALLED") return error;
  if (
    error.fromNetlifyLine &&
    (error.code === "AUTH" || error.code === "NOT_LINKED")
  ) {
    return error;
  }
  if (error.fromNetlifyLine && error.code === "CONFIG") {
    return new AxiError(
      "netlify could not resolve this directory's netlify.toml",
      "CONFIG",
      error.suggestions,
    );
  }
  if (error.fromNetlifyLine && error.code === "NOT_FOUND") {
    return new AxiError(
      "netlify deploy could not find the site or a path it needs",
      "NOT_FOUND",
      [
        "Run `netlify-axi list` to check the site name",
        "Check that --dir and the paths in netlify.toml exist",
      ],
    );
  }
  return new AxiError(
    "netlify deploy failed, or the site's build failed (output not shown: it may include build logs)",
    "UNKNOWN",
    [
      "Run the same `netlify deploy` locally to see its full output",
      "Or open the site's deploys page in the Netlify UI for the build log",
    ],
  );
}

/**
 * netlify may print build output ahead of the JSON document, so parse the
 * whole of stdout first and fall back to the last line that opens an object.
 * stdout is never echoed in an error: build logs can carry env values.
 */
export function parseDeployOutput(stdout: string): NetlifyDeployResult {
  const text = stdout.trim();
  if (text === "") {
    throw new AxiError(
      "netlify deploy exited without reporting a deploy",
      "DEPLOY_NOT_REPORTED",
      UNREPORTED_HELP,
    );
  }
  const candidates = [text];
  const lastObject = text.lastIndexOf("\n{");
  if (lastObject !== -1) candidates.push(text.slice(lastObject + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof (parsed as NetlifyDeployResult).deploy_id === "string"
      ) {
        return parsed as NetlifyDeployResult;
      }
    } catch {
      // try the next candidate
    }
  }
  throw new AxiError(
    "netlify deploy finished without a deploy result netlify-axi could read (output not shown: it may include build logs)",
    "DEPLOY_NOT_REPORTED",
    [...UNREPORTED_HELP, UNKNOWN_SUGGESTION],
  );
}

/** Flatten the deploy result into what changed (VISION.md: writes print it). */
export function renderDeploy(
  result: NetlifyDeployResult,
  opts: { prod: boolean; created: boolean },
): string {
  const site = result.site_name ?? "unknown";
  const deploy: Record<string, unknown> = {
    site,
    site_id: result.site_id ?? "unknown",
    ...(opts.created ? { site_created: true } : {}),
    deploy_id: result.deploy_id ?? "unknown",
    // parseDeployOutput only accepts netlify's final JSON with a deploy_id,
    // which netlify prints only after the deploy reached `ready`.
    state: "ready",
    production: opts.prod,
    url: (opts.prod ? result.url : result.deploy_url) ?? "unknown",
    ...(opts.prod && result.deploy_url
      ? { deploy_url: result.deploy_url }
      : {}),
    ...(result.logs ? { logs: result.logs } : {}),
  };
  const help = opts.prod
    ? [`Run \`netlify-axi list\` to see ${site} among your sites`]
    : [
        "This is a draft deploy; production is unchanged",
        "Rerun with --prod to publish this directory to production",
      ];
  return renderOutput([encode({ deploy }), renderHelp(help)]);
}

export async function deployCommand(args: string[]): Promise<string> {
  const opts = parseDeployArgs(args);
  const dir = assertDirectory(opts.dir);

  const target: { site?: string; createSite?: string; team?: string } = {};
  if (opts.site) {
    target.site = opts.site;
  } else if (opts.createSite) {
    target.createSite = opts.createSite;
    target.team =
      opts.team ??
      pickTeam(
        await netlifyJson<NetlifyAccount[]>([
          "api",
          "listAccountsForUser",
        ]).catch((error: unknown) => {
          throw readFailedError(error, "api listAccountsForUser");
        }),
      );
  } else {
    const linked = await linkedSiteId();
    if (!linked) {
      throw noTargetError(await listSites(), { createSite: true });
    }
    // Name the linked site explicitly so netlify has nothing left to ask.
    target.site = linked;
  }

  const stdout = await netlifyExec(deployArgv(opts, dir, target)).catch(
    async (error: unknown) => {
      if (!(error instanceof AxiError)) throw error;
      if (error.code === "NETLIFY_TOO_OLD") {
        const found = await netlifyVersion();
        if (!found || compareVersions(found, MIN_NETLIFY_CLI) < 0) {
          throw tooOldError(found);
        }
      }
      throw deployFailedError(error);
    },
  );
  return renderDeploy(parseDeployOutput(stdout), {
    prod: opts.prod,
    created: Boolean(opts.createSite),
  });
}

/**
 * Installed netlify-cli version, if it can be read. `-V` prints commander's
 * one-line USER_AGENT; `--version` prints a longer environment page.
 */
async function netlifyVersion(): Promise<string | undefined> {
  const out = await netlifyExec(["-V"]).catch(() => "");
  return parseNetlifyVersion(out);
}

/** `netlify -V` prints e.g. "netlify-cli/18.0.1 darwin-arm64 node-v22.1.0". */
export function parseNetlifyVersion(output: string): string | undefined {
  return output.match(/netlify-cli\/(\d+\.\d+\.\d+\S*)/)?.[1];
}

/** Numeric major.minor.patch comparison; pre-release tags are ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/, 3).map(Number);
  const pb = b.split(/[.-]/, 3).map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Rewrite netlify's "unknown option" into the version the agent must install. */
export function tooOldError(found: string | undefined): AxiError {
  return new AxiError(
    `netlify-cli ${found ?? "(version unknown)"} is too old for \`deploy\``,
    "NETLIFY_TOO_OLD",
    [
      `Upgrade to netlify-cli >= ${MIN_NETLIFY_CLI}: \`npm install -g netlify-cli@latest\`, then retry`,
    ],
  );
}
