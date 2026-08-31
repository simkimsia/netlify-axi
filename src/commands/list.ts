import { assertNoArgs } from "../args.js";
import { netlifyJson } from "../netlify.js";
import { relativeTime, renderHelp, renderList, renderOutput } from "../toon.js";

export const LIST_HELP = `usage: netlify-axi list
Lists all Netlify sites you have access to (name, team, url, last update).
flags: none
examples:
  netlify-axi list
`;

export interface NetlifySite {
  id: string;
  name: string;
  account_name?: string;
  url?: string;
  ssl_url?: string;
  custom_domain?: string | null;
  updated_at?: string | null;
}

/** Best public URL for a site: custom domain first, then ssl_url, then url. */
export function siteUrl(site: NetlifySite): string {
  if (site.custom_domain) return `https://${site.custom_domain}`;
  return site.ssl_url ?? site.url ?? "unknown";
}

/** Flatten sites into list rows, most recently updated first (AXI §2: 3–4 fields). */
export function siteRows(sites: NetlifySite[]): Record<string, unknown>[] {
  return [...sites]
    .sort(
      (a, b) =>
        new Date(b.updated_at ?? 0).getTime() -
        new Date(a.updated_at ?? 0).getTime(),
    )
    .map((s) => ({
      name: s.name,
      team: s.account_name ?? "unknown",
      url: siteUrl(s),
      updated: relativeTime(s.updated_at),
    }));
}

export async function listCommand(args: string[]): Promise<string> {
  assertNoArgs("list", args);
  const sites = await netlifyJson<NetlifySite[]>(["sites:list", "--json"]);

  if (sites.length === 0) {
    return "sites: 0 sites found in this account";
  }

  return renderOutput([
    `count: ${sites.length} sites`,
    renderList("sites", siteRows(sites)),
    renderHelp([
      "Run `netlify link` in a project directory to link a site",
      "Run `netlify-axi status` to see the linked site",
    ]),
  ]);
}
