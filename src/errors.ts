export type ErrorCode =
  | "AUTH"
  | "NOT_LINKED"
  | "NOT_FOUND"
  | "CONFIG"
  | "VALIDATION_ERROR"
  | "NETLIFY_NOT_INSTALLED"
  | "NETLIFY_TOO_OLD"
  | "DEPLOY_NOT_REPORTED"
  | "UNKNOWN";

export class AxiError extends Error {
  readonly code: ErrorCode;
  readonly suggestions: string[];
  /** True when the pattern matched a line netlify itself printed (prefixed "›"). */
  readonly fromNetlifyLine: boolean;

  constructor(
    message: string,
    code: ErrorCode,
    suggestions: string[] = [],
    fromNetlifyLine = false,
  ) {
    super(message);
    this.name = "AxiError";
    this.code = code;
    this.suggestions = suggestions;
    this.fromNetlifyLine = fromNetlifyLine;
  }
}

export function exitCodeForError(error: { code: string }): number {
  return error.code === "VALIDATION_ERROR" ? 2 : 1;
}

export function netlifyNotInstalledError(): AxiError {
  return new AxiError(
    "Netlify CLI is not installed or not on PATH",
    "NETLIFY_NOT_INSTALLED",
    ["Install it: `brew install netlify-cli` or `npm install -g netlify-cli`"],
  );
}

interface ErrorPattern {
  pattern: RegExp;
  code: ErrorCode;
  message?: string | ((match: RegExpMatchArray) => string);
  suggestions: string[];
  /** Match the undecorated stderr, so the pattern can require netlify's own line prefix. */
  raw?: boolean;
}

// Walked in order; first regex hit wins, so narrow patterns must sit ahead of
// broader ones (same contract as gh-axi's mapGhError). Every pattern below is
// verified against real netlify-cli 18.x stderr:
//   " ›   JSONHTTPError: Unauthorized"                       (bad/absent token)
//   " ›   Error: You don't appear to be in a folder that is linked to a site"
//   " ›   JSONHTTPError: Not Found"                          (api getSite miss)
//   " ›   Error: When resolving config file <path>: Base directory does not exist: <dir>"
// The unknown-option line is commander's wording as netlify-cli's outputError
// hook prints it (netlify-cli 18.0.1 dist/commands/main.js), e.g. when an old
// netlify-cli is handed a flag it does not have yet:
//   " ›   Error: unknown option '--create-site'"
// It must match on that decorated line only: a build that netlify runs can
// print the same commander wording for a flag of some other tool.
const patterns: ErrorPattern[] = [
  {
    pattern: /^\s*›\s*Error:\s*(?:error:\s*)?unknown option '([^']+)'/im,
    raw: true,
    code: "NETLIFY_TOO_OLD",
    message: (match) => `netlify-cli does not accept ${match[1]}`,
    suggestions: [
      "Upgrade netlify-cli: `npm install -g netlify-cli@latest`, then retry",
    ],
  },
  {
    pattern: /unauthorized|not logged in|log ?in required/i,
    code: "AUTH",
    message: "Not logged in to Netlify",
    suggestions: [
      "Run `netlify login` in an interactive terminal, then retry",
      "Or set NETLIFY_AUTH_TOKEN to a valid personal access token",
    ],
  },
  {
    pattern:
      /don't appear to be in a folder that is linked|not linked to a site/i,
    code: "NOT_LINKED",
    message: "No Netlify site is linked to this directory",
    suggestions: [
      "Run `netlify-axi list` to see sites",
      "Run `netlify link` to link one, then retry",
    ],
  },
  {
    pattern: /when resolving config file/i,
    code: "CONFIG",
    suggestions: [
      "Check netlify.toml in this directory — a path it references may not exist",
    ],
  },
  {
    pattern: /not found|does not exist/i,
    code: "NOT_FOUND",
    suggestions: ["Run `netlify-axi list` to see available sites"],
  },
];

/** Translate raw netlify CLI stderr into a structured, actionable AxiError. */
export function mapNetlifyError(stderr: string, exitCode: number): AxiError {
  const trimmed = stripDecoration(stderr);
  const netlifyLines = stderr
    .split("\n")
    .filter((line) => /^\s*›/.test(line))
    .join("\n");
  const decorated = stripDecoration(netlifyLines);
  const first = firstMatch(stderr, trimmed);
  if (!first) {
    return new AxiError(
      firstLine(trimmed) || `netlify exited with code ${exitCode}`,
      "UNKNOWN",
      [UNKNOWN_SUGGESTION],
    );
  }
  if (first.entry.raw || first.entry.pattern.test(decorated)) {
    return toError(first, trimmed, true);
  }
  const own = firstMatch(netlifyLines, decorated);
  return own ? toError(own, decorated, true) : toError(first, trimmed, false);
}

interface PatternMatch {
  entry: ErrorPattern;
  match: RegExpMatchArray;
}

function firstMatch(raw: string, stripped: string): PatternMatch | undefined {
  for (const entry of patterns) {
    const match = (entry.raw ? raw : stripped).match(entry.pattern);
    if (match) return { entry, match };
  }
  return undefined;
}

function toError(
  { entry, match }: PatternMatch,
  stripped: string,
  fromNetlifyLine: boolean,
): AxiError {
  const message =
    typeof entry.message === "function"
      ? entry.message(match)
      : (entry.message ?? firstLine(stripped));
  return new AxiError(message, entry.code, entry.suggestions, fromNetlifyLine);
}

/** Next step for errors no pattern recognizes (VISION.md: every error carries one). */
export const UNKNOWN_SUGGESTION =
  "Rerun the same command with plain `netlify` to see its full output, then report the gap at https://github.com/simkimsia/netlify-axi/issues";

/** Strip netlify's " ›   " line prefix and leading "Error: " label. */
function stripDecoration(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => line.replace(/^\s*›\s*/, "").replace(/^Error:\s*/, ""))
    .join("\n");
}

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? "";
}
