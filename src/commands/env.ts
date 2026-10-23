import { assertNoArgs } from "../args.js";
import { AxiError } from "../errors.js";
import { netlifyJson, WITHHELD_SUGGESTION } from "../netlify.js";
import { encode, renderHelp, renderOutput } from "../toon.js";

export const ENV_HELP = `usage: netlify-axi env [list]
Lists the environment variable names of the site linked to the current directory.
Values are secrets and are never printed.
flags: none
examples:
  netlify-axi env
  netlify-axi env list
`;

/** Shape of \`netlify env:list --json\` (netlify-cli 18.x): a flat name -> value map. */
export type NetlifyEnv = Record<string, unknown>;

/**
 * Reduce \`netlify env:list --json\` to sorted variable names and a count.
 * Only keys are read — values must never reach the output.
 */
export function parseEnv(env: NetlifyEnv): { count: number; names: string[] } {
  const names = Object.keys(env ?? {}).sort();
  return { count: names.length, names };
}

export async function envCommand(args: string[]): Promise<string> {
  const [sub, ...rest] = args;
  if (sub !== "list") assertNoArgs("env", args);
  else assertNoArgs("env list", rest);

  // secretOutput: env:list stdout holds every value, so no error may echo it.
  const env = await netlifyJson<NetlifyEnv>(["env:list", "--json"], {
    secretOutput: true,
  });
  if (typeof env !== "object" || env === null || Array.isArray(env)) {
    throw new AxiError(
      "netlify env:list printed JSON that is not a name -> value map; its output is withheld because it can contain secret values",
      "UNKNOWN",
      [WITHHELD_SUGGESTION],
    );
  }
  const { count, names } = parseEnv(env);
  if (count === 0) {
    return renderOutput([
      "env: 0 variables set for the linked site",
      renderHelp(["Run `netlify env:set <name> <value>` to add one"]),
    ]);
  }
  return encode({ count: `${count} variables`, names });
}
