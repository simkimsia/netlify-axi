import { assertNoArgs } from "../args.js";
import { netlifyJson } from "../netlify.js";
import { encode } from "../toon.js";

export const STATUS_HELP = `usage: netlify-axi status
Shows the Netlify site linked to the current directory: name, url, admin url, team.
flags: none
examples:
  netlify-axi status
`;

/** Real shape of \`netlify status --json\` (netlify-cli 18.x). */
export interface NetlifyStatus {
  account?: {
    Email?: string;
    Teams?: Record<string, string>;
  };
  siteData?: {
    "site-name"?: string;
    "admin-url"?: string;
    "site-url"?: string;
    "site-id"?: string;
  };
}

/** Flatten \`netlify status --json\` into a compact TOON-ready object. */
export function parseStatus(status: NetlifyStatus): Record<string, unknown> {
  const site = status.siteData ?? {};
  const teams = Object.keys(status.account?.Teams ?? {});
  return {
    site: site["site-name"] ?? "unknown",
    url: site["site-url"] ?? "unknown",
    admin: site["admin-url"] ?? "unknown",
    id: site["site-id"] ?? "unknown",
    ...(teams.length > 0 ? { teams } : {}),
  };
}

export async function statusCommand(args: string[]): Promise<string> {
  assertNoArgs("status", args);
  const status = await netlifyJson<NetlifyStatus>(["status", "--json"]);
  return encode(parseStatus(status));
}
