import { assertNoArgs } from "../args.js";
import { AxiError } from "../errors.js";
import { netlifyJson } from "../netlify.js";
import { readFailedError, WITHHELD_SUGGESTION } from "../sites.js";
import { encode, renderHelp, renderOutput } from "../toon.js";

/**
 * The deploy contexts netlify scopes a value to. `netlify env:list` reads one
 * context per call (default `dev`), so a variable set only for production
 * would be missed by a single call; env reads each and unions the names.
 */
export const ENV_CONTEXTS = [
  "production",
  "deploy-preview",
  "branch-deploy",
  "dev",
] as const;
export type EnvContext = (typeof ENV_CONTEXTS)[number];

export const ENV_HELP = `usage: netlify-axi env
Lists the environment variable names of the site linked to the current directory,
across every deploy context (${ENV_CONTEXTS.join(", ")}), with the contexts each one has a value in.
Values are secrets and are never printed. Branch-specific values (one named branch) are not listed.
flags: none
examples:
  netlify-axi env
`;

/** Shape of `netlify env:list --json` (netlify-cli 18.x): a flat name -> value map. */
export type NetlifyEnv = Record<string, unknown>;

/**
 * Reduce `netlify env:list --json` to sorted variable names and a count.
 * Only keys are read — values must never reach the output.
 */
export function parseEnv(env: NetlifyEnv): { count: number; names: string[] } {
  const names = Object.keys(env ?? {}).sort();
  return { count: names.length, names };
}

/**
 * Union the per-context name lists into one row per name, listing the
 * contexts (in ENV_CONTEXTS order) that have a value. Names only.
 */
export function unionContexts(
  byContext: Partial<Record<EnvContext, string[]>>,
): { name: string; contexts: string }[] {
  const seen = new Map<string, EnvContext[]>();
  for (const context of ENV_CONTEXTS) {
    for (const name of byContext[context] ?? []) {
      const contexts = seen.get(name) ?? [];
      contexts.push(context);
      seen.set(name, contexts);
    }
  }
  return [...seen.keys()]
    .sort()
    .map((name) => ({ name, contexts: (seen.get(name) ?? []).join(" ") }));
}

/** Names that have a value in one context. Values are never read. */
async function namesIn(context: EnvContext): Promise<string[]> {
  const call = `env:list --json --context ${context}`;
  // env:list stdout holds every value, so no error may echo netlify's output:
  // readFailedError rewrites every failure into fixed text (VISION Safety).
  const env = await netlifyJson<NetlifyEnv>([
    "env:list",
    "--json",
    "--context",
    context,
  ]).catch((error: unknown) => {
    throw readFailedError(error, call, undefined, { secretOutput: true });
  });
  if (typeof env !== "object" || env === null || Array.isArray(env)) {
    throw new AxiError(
      `netlify ${call} printed JSON that is not a name -> value map; its output is withheld because it can contain secret values`,
      "UNKNOWN",
      [WITHHELD_SUGGESTION],
    );
  }
  return parseEnv(env).names;
}

export async function envCommand(args: string[]): Promise<string> {
  assertNoArgs("env", args);

  const lists = await Promise.all(ENV_CONTEXTS.map(namesIn));
  const variables = unionContexts(
    Object.fromEntries(ENV_CONTEXTS.map((c, i) => [c, lists[i]])),
  );
  if (variables.length === 0) {
    return renderOutput([
      "env: 0 variables set for the linked site in any context",
      renderHelp(["Run `netlify env:set <name> <value>` to add one"]),
    ]);
  }
  return encode({ count: `${variables.length} variables`, variables });
}
