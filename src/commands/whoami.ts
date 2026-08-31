import { assertNoArgs } from "../args.js";
import { netlifyJson } from "../netlify.js";
import { encode } from "../toon.js";

export const WHOAMI_HELP = `usage: netlify-axi whoami
Shows the Netlify account you are logged in as.
flags: none
examples:
  netlify-axi whoami
`;

/** Relevant slice of \`netlify api getCurrentUser\` (full_name is often null). */
export interface NetlifyUser {
  email?: string;
  full_name?: string | null;
  site_count?: number;
}

/** Flatten getCurrentUser JSON into a compact TOON-ready object. */
export function parseUser(user: NetlifyUser): Record<string, unknown> {
  return {
    user: {
      email: user.email ?? "unknown",
      ...(user.full_name ? { name: user.full_name } : {}),
      ...(typeof user.site_count === "number"
        ? { sites: user.site_count }
        : {}),
    },
  };
}

export async function whoamiCommand(args: string[]): Promise<string> {
  assertNoArgs("whoami", args);
  // `netlify api getCurrentUser` returns clean JSON; `netlify status` without
  // --json prints the user but exits 1 when the directory is not linked.
  const user = await netlifyJson<NetlifyUser>(["api", "getCurrentUser"]);
  return encode(parseUser(user));
}
