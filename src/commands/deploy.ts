import { statSync } from "node:fs";
import { resolve } from "node:path";
import { rejectExtraArgs, takeBoolFlag, takeFlag } from "../args.js";
import { AxiError, UNKNOWN_SUGGESTION } from "../errors.js";
import { netlifyExec, netlifyJson } from "../netlify.js";
import { encode, renderHelp, renderOutput } from "../toon.js";
import type { NetlifySite } from "./list.js";
import type { NetlifyStatus } from "./status.js";

export const DEPLOY_HELP = `usage: netlify-axi deploy --dir <path> [--site <name-or-id> | --create-site <name> [--team <slug>]] [flags]
Uploads a directory to a Netlify site and prints the deploy it made (site, ids, state, url).
Without --prod the deploy is a draft at its own URL; production is untouched.
Without --site or --create-site it deploys to the site linked to this directory, and refuses if there is none.
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

const SITE_NAME_LIMIT = 20;

/** The refusal for "no site named, none linked": list the candidates. */
export function noTargetError(sites: NetlifySite[]): AxiError {
  const names = sites.map((s) => s.name).filter(Boolean);
  const help: string[] = [];
  if (names.length === 0) {
    help.push("No sites in this account: pass --create-site <name>");
  } else {
    const shown = names.slice(0, SITE_NAME_LIMIT).join(", ");
    const more =
      names.length > SITE_NAME_LIMIT
        ? ` (+${names.length - SITE_NAME_LIMIT} more, see \`netlify-axi list\`)`
        : "";
    help.push(`Pass --site with one of: ${shown}${more}`);
    help.push("Or pass --create-site <name> for a new site");
  }
  return new AxiError(
    "No site named and no site is linked to this directory",
    "NOT_LINKED",
    help,
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

/** Shape of `netlify deploy --json` (netlify-cli 18.x); `url` only with --prod. */
export interface NetlifyDeployResult {
  name?: string;
  site_id?: string;
  site_name?: string;
  deploy_id?: string;
  deploy_url?: string;
  logs?: string;
  url?: string;
}

/**
 * netlify may print build output ahead of the JSON document, so parse the
 * whole of stdout first and fall back to the last line that opens an object.
 */
export function parseDeployOutput(stdout: string): NetlifyDeployResult {
  const text = stdout.trim();
  const candidates = [text];
  const lastObject = text.lastIndexOf("\n{");
  if (lastObject !== -1) candidates.push(text.slice(lastObject + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as NetlifyDeployResult;
      }
    } catch {
      // try the next candidate
    }
  }
  throw new AxiError(
    `Unexpected netlify deploy output: ${text.slice(0, 200)}`,
    "UNKNOWN",
    [UNKNOWN_SUGGESTION],
  );
}

/** Flatten the deploy result into what changed (VISION.md: writes print it). */
export function renderDeploy(
  result: NetlifyDeployResult,
  opts: { prod: boolean; created: boolean },
): string {
  const site = result.site_name ?? result.name ?? "unknown";
  const deploy: Record<string, unknown> = {
    site,
    site_id: result.site_id ?? "unknown",
    ...(opts.created ? { site_created: true } : {}),
    deploy_id: result.deploy_id ?? "unknown",
    // `netlify deploy` waits for the deploy to finish and exits non-zero if it
    // fails, so a parsed success result means the deploy is live.
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
        await netlifyJson<NetlifyAccount[]>(["api", "listAccountsForUser"]),
      );
  } else {
    const status = await netlifyJson<NetlifyStatus>(["status", "--json"]).catch(
      async (error: unknown) => {
        if (error instanceof AxiError && error.code === "NOT_LINKED") {
          throw noTargetError(
            await netlifyJson<NetlifySite[]>(["sites:list", "--json"]),
          );
        }
        throw error;
      },
    );
    const linked = status.siteData?.["site-id"];
    if (!linked) {
      throw noTargetError(
        await netlifyJson<NetlifySite[]>(["sites:list", "--json"]),
      );
    }
    // Name the linked site explicitly so netlify has nothing left to ask.
    target.site = linked;
  }

  const stdout = await netlifyExec(deployArgv(opts, dir, target));
  return renderDeploy(parseDeployOutput(stdout), {
    prod: opts.prod,
    created: Boolean(opts.createSite),
  });
}
