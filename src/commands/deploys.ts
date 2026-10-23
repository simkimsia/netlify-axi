import { rejectExtraArgs, takeFlag } from "../args.js";
import { AxiError } from "../errors.js";
import { netlifyJson } from "../netlify.js";
import { readFailedError, resolveSite } from "../sites.js";
import {
  encode,
  relativeTime,
  renderHelp,
  renderList,
  renderOutput,
} from "../toon.js";
import { siteUrl, type NetlifySite } from "./list.js";

export const DEPLOYS_HELP = `usage: netlify-axi deploys [--site <name-or-id>] [--limit <n>]
Lists a site's deploys, newest first: id, state, context, branch, commit, when created and published, and which one is live.
Without --site it lists the deploys of the site linked to this directory, and refuses if there is none.
flags[2]:
  --site <name-or-id>  site to list (name, id, or custom domain)
  --limit <n>          how many deploys to show, 1-100 (default 10)
examples:
  netlify-axi deploys
  netlify-axi deploys --site my-app
  netlify-axi deploys --site my-app --limit 30
`;

export const DEFAULT_LIMIT = 10;
/** Netlify's API caps per_page at 100. */
export const MAX_LIMIT = 100;
const ERROR_MESSAGE_LIMIT = 120;

export interface DeploysOptions {
  site?: string;
  limit: number;
}

/** Parse and validate deploys argv. Every rejection happens before any netlify call. */
export function parseDeploysArgs(argv: string[]): DeploysOptions {
  const args = [...argv];
  const site = takeFlag("deploys", args, "--site");
  const rawLimit = takeFlag("deploys", args, "--limit");
  rejectExtraArgs("deploys", args);
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new AxiError(
        `--limit must be a whole number from 1 to ${MAX_LIMIT}, got ${rawLimit}`,
        "VALIDATION_ERROR",
        [`Pass e.g. --limit ${DEFAULT_LIMIT}`],
      );
    }
  }
  return { site, limit };
}

/** Relevant slice of one `netlify api listSiteDeploys` entry (open-api `deploy`). */
export interface NetlifyDeploy {
  id: string;
  state?: string | null;
  context?: string | null;
  branch?: string | null;
  commit_ref?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  published_at?: string | null;
}

/** Argv for one page of a site's deploys; netlify's API returns newest first. */
export function deploysArgv(siteId: string, limit: number): string[] {
  return [
    "api",
    "listSiteDeploys",
    "--data",
    JSON.stringify({ site_id: siteId, per_page: limit }),
  ];
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > ERROR_MESSAGE_LIMIT
    ? `${flat.slice(0, ERROR_MESSAGE_LIMIT - 1)}…`
    : flat;
}

/**
 * Flatten deploys into rows, newest first. `live` flags the deploy the site
 * currently serves; `error_message` is a column only when some deploy has one.
 */
export function deployRows(
  deploys: NetlifyDeploy[],
  liveId: string | undefined,
): Record<string, unknown>[] {
  const withError = deploys.some((d) => d.error_message);
  return [...deploys]
    .sort(
      (a, b) =>
        new Date(b.created_at ?? 0).getTime() -
        new Date(a.created_at ?? 0).getTime(),
    )
    .map((d) => ({
      deploy_id: d.id,
      state: d.state ?? "unknown",
      context: d.context ?? "none",
      branch: d.branch ?? "none",
      commit_ref: d.commit_ref ?? "none",
      created_at: relativeTime(d.created_at),
      published_at: d.published_at ? relativeTime(d.published_at) : "never",
      live: Boolean(liveId) && d.id === liveId,
      ...(withError
        ? { error_message: d.error_message ? oneLine(d.error_message) : "" }
        : {}),
    }));
}

/** The deploy live at the site's URL, from the site entry itself. */
function liveBlock(site: NetlifySite): Record<string, unknown> | string {
  const live = site.published_deploy;
  if (!live?.id) return "none (nothing published yet)";
  return {
    deploy_id: live.id,
    branch: live.branch ?? "none",
    commit_ref: live.commit_ref ?? "none",
    published_at: relativeTime(live.published_at),
    url: siteUrl(site),
  };
}

export function renderDeploys(
  site: NetlifySite,
  deploys: NetlifyDeploy[],
  limit: number,
): string {
  const header = encode({ site: site.name, live: liveBlock(site) });
  if (deploys.length === 0) {
    return renderOutput([
      header,
      `deploys: 0 deploys found for ${site.name}`,
      renderHelp([
        "Run `netlify-axi deploy --dir <path>` to make a draft deploy",
      ]),
    ]);
  }

  const liveId = site.published_deploy?.id;
  const rows = deployRows(deploys, liveId);
  const help: string[] = [];
  if (deploys.length >= limit && limit < MAX_LIMIT) {
    help.push(
      `Showing the newest ${limit}; pass --limit <n> (up to ${MAX_LIMIT}) for older deploys`,
    );
  }
  if (liveId && !rows.some((r) => r.live)) {
    help.push(
      `The live deploy ${liveId} is older than these ${rows.length}; see \`live\` above`,
    );
  }
  const failed = rows.find((r) => r.state === "error");
  if (failed && site.admin_url) {
    help.push(
      `Build log for failed deploy ${failed.deploy_id}: ${site.admin_url}/deploys/${failed.deploy_id}`,
    );
  }
  help.push(
    "Run `netlify-axi deploy --dir <path> --prod` to publish a new deploy",
  );
  return renderOutput([
    header,
    `count: ${rows.length} deploys (newest first)`,
    renderList("deploys", rows),
    renderHelp(help),
  ]);
}

/** A failed `listSiteDeploys` call, in fixed text only (see readFailedError). */
export function deploysFailedError(error: unknown, site: string): unknown {
  return readFailedError(
    error,
    "api listSiteDeploys",
    new AxiError(`Netlify has no deploys for site ${site}`, "NOT_FOUND", [
      "Run `netlify-axi list` to check the site name",
    ]),
  );
}

export async function deploysCommand(args: string[]): Promise<string> {
  const opts = parseDeploysArgs(args);
  const site = await resolveSite(opts.site);
  const deploys = await netlifyJson<NetlifyDeploy[]>(
    deploysArgv(site.id, opts.limit),
  ).catch((error: unknown) => {
    throw deploysFailedError(error, site.name);
  });
  return renderDeploys(site, Array.isArray(deploys) ? deploys : [], opts.limit);
}
