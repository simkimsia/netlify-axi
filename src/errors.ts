export type ErrorCode =
  | "AUTH"
  | "NOT_LINKED"
  | "NOT_FOUND"
  | "CONFIG"
  | "VALIDATION_ERROR"
  | "NETLIFY_NOT_INSTALLED"
  | "UNKNOWN";

export class AxiError extends Error {
  readonly code: ErrorCode;
  readonly suggestions: string[];

  constructor(message: string, code: ErrorCode, suggestions: string[] = []) {
    super(message);
    this.name = "AxiError";
    this.code = code;
    this.suggestions = suggestions;
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
  message?: string;
  suggestions: string[];
}

// Walked in order; first regex hit wins, so narrow patterns must sit ahead of
// broader ones (same contract as gh-axi's mapGhError). Every pattern below is
// verified against real netlify-cli 18.x stderr:
//   " ›   JSONHTTPError: Unauthorized"                       (bad/absent token)
//   " ›   Error: You don't appear to be in a folder that is linked to a site"
//   " ›   JSONHTTPError: Not Found"                          (api getSite miss)
//   " ›   Error: When resolving config file <path>: Base directory does not exist: <dir>"
const patterns: ErrorPattern[] = [
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
  for (const entry of patterns) {
    if (entry.pattern.test(trimmed)) {
      return new AxiError(
        entry.message ?? firstLine(trimmed),
        entry.code,
        entry.suggestions,
      );
    }
  }
  return new AxiError(
    firstLine(trimmed) || `netlify exited with code ${exitCode}`,
    "UNKNOWN",
    [UNKNOWN_SUGGESTION],
  );
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
