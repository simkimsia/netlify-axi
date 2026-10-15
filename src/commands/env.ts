import { AxiError } from "../errors.js";
import { netlifyJson } from "../netlify.js";
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

function rejectExtra(command: string, arg: string): never {
  const kind = arg.startsWith("-") ? "flag" : "argument";
  throw new AxiError(
    `unknown ${kind} ${arg} for \`${command}\``,
    "VALIDATION_ERROR",
    [`\`netlify-axi ${command}\` takes no arguments (--help always allowed)`],
  );
}

export async function envCommand(args: string[]): Promise<string> {
  const [sub, ...rest] = args;
  if (sub !== undefined && sub !== "list") rejectExtra("env", sub);
  if (rest.length > 0) rejectExtra("env list", rest[0]);

  const env = await netlifyJson<NetlifyEnv>(["env:list", "--json"]);
  const { count, names } = parseEnv(env);
  if (count === 0) {
    return renderOutput([
      "env: 0 variables set for the linked site",
      renderHelp(["Run `netlify env:set <name> <value>` to add one"]),
    ]);
  }
  return encode({ count: `${count} variables`, names });
}
