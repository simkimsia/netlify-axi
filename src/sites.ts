import { AxiError, UNKNOWN_SUGGESTION } from "./errors.js";
import { netlifyJson } from "./netlify.js";
import type { NetlifySite } from "./commands/list.js";
import type { NetlifyStatus } from "./commands/status.js";

/**
 * Site resolution shared by the commands that act on one site (`deploy`,
 * `deploys`). VISION.md: when no site is named and none is linked, refuse and
 * list the names; never guess.
 */

const SITE_NAME_LIMIT = 20;

/**
 * Rewrite a failed read call into fixed text, so no raw netlify output (a
 * stderr line, or stdout that was not JSON) reaches the agent. Codes whose
 * messages errors.ts already fixes pass through unchanged.
 */
export function readFailedError(
  error: unknown,
  call: string,
  notFound?: AxiError,
): unknown {
  if (!(error instanceof AxiError)) return error;
  switch (error.code) {
    case "AUTH":
    case "NOT_LINKED":
    case "NETLIFY_NOT_INSTALLED":
    case "NETLIFY_TOO_OLD":
    case "NETLIFY_INTERRUPTED":
      return error;
    case "CONFIG":
      return new AxiError(
        "netlify could not resolve this directory's netlify.toml",
        "CONFIG",
        error.suggestions,
      );
    case "NOT_FOUND":
      return (
        notFound ??
        new AxiError(
          `\`netlify ${call}\` found nothing`,
          "NOT_FOUND",
          error.suggestions,
        )
      );
    default:
      return new AxiError(
        `\`netlify ${call}\` failed (output not shown)`,
        "UNKNOWN",
        [UNKNOWN_SUGGESTION],
      );
  }
}

/** Every site the account can access (`netlify sites:list --json`). */
export function listSites(): Promise<NetlifySite[]> {
  return netlifyJson<NetlifySite[]>(["sites:list", "--json"]).catch(
    (error: unknown) => {
      throw readFailedError(error, "sites:list --json");
    },
  );
}

/** "Pass --site with one of: a, b (+N more ...)" for a refusal's help. */
function siteChoices(sites: NetlifySite[]): string | undefined {
  const names = sites.map((s) => s.name).filter(Boolean);
  if (names.length === 0) return undefined;
  const shown = names.slice(0, SITE_NAME_LIMIT).join(", ");
  const more =
    names.length > SITE_NAME_LIMIT
      ? ` (+${names.length - SITE_NAME_LIMIT} more, see \`netlify-axi list\`)`
      : "";
  return `Pass --site with one of: ${shown}${more}`;
}

/**
 * The refusal for "no site named, none linked": list the candidates.
 * `createSite` adds the `deploy`-only way out of naming a new site.
 */
export function noTargetError(
  sites: NetlifySite[],
  options: { createSite?: boolean } = {},
): AxiError {
  const help: string[] = [];
  const choices = siteChoices(sites);
  if (choices) {
    help.push(choices);
    if (options.createSite)
      help.push("Or pass --create-site <name> for a new site");
  } else if (options.createSite) {
    help.push("No sites in this account: pass --create-site <name>");
  } else {
    help.push("No sites in this account: run `netlify-axi list` to check");
  }
  return new AxiError(
    "No site named and no site is linked to this directory",
    "NOT_LINKED",
    help,
  );
}

/**
 * Id of the site linked to the current directory, or undefined when there is
 * none. Errors other than NOT_LINKED (auth, missing CLI, broken netlify.toml)
 * propagate.
 */
export async function linkedSiteId(): Promise<string | undefined> {
  try {
    const status = await netlifyJson<NetlifyStatus>(["status", "--json"]);
    return status.siteData?.["site-id"] || undefined;
  } catch (error) {
    if (error instanceof AxiError && error.code === "NOT_LINKED") {
      return undefined;
    }
    throw readFailedError(error, "status --json");
  }
}

/** Find a site by id, name, or custom domain (exact match only, never fuzzy). */
export function findSite(
  sites: NetlifySite[],
  ref: string,
): NetlifySite | undefined {
  const wanted = ref.trim().toLowerCase();
  return (
    sites.find((s) => s.id === ref) ??
    sites.find((s) => s.name?.toLowerCase() === wanted) ??
    sites.find((s) => s.custom_domain?.toLowerCase() === wanted)
  );
}

/** --site named something the account does not have. */
export function siteNotFoundError(ref: string, sites: NetlifySite[]): AxiError {
  const help: string[] = [];
  const choices = siteChoices(sites);
  if (choices) help.push(choices);
  help.push("Run `netlify-axi list` to see every site you can access");
  return new AxiError(
    `No site named ${ref} in this account`,
    "NOT_FOUND",
    help,
  );
}

/**
 * The site a read command acts on: `--site` (name, id, or custom domain) when
 * given, else the linked site. Neither refuses with NOT_LINKED and the names.
 * Returns the full `sites:list` entry, so callers get `published_deploy` too.
 */
export async function resolveSite(
  ref: string | undefined,
): Promise<NetlifySite> {
  const linked = ref ? undefined : await linkedSiteId();
  const sites = await listSites();
  if (ref) {
    const site = findSite(sites, ref);
    if (!site) throw siteNotFoundError(ref, sites);
    return site;
  }
  if (!linked) throw noTargetError(sites);
  const site = sites.find((s) => s.id === linked);
  if (!site) {
    throw new AxiError(
      "The site linked to this directory is not in your account",
      "NOT_FOUND",
      [
        "Run `netlify link` to relink this directory, or pass --site",
        "Run `netlify-axi list` to see every site you can access",
      ],
    );
  }
  return site;
}
