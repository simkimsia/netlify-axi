import { encode } from "@toon-format/toon";
import { AxiError as SdkAxiError, runAxiCli } from "axi-sdk-js";
import { AxiError, exitCodeForError, UNKNOWN_SUGGESTION } from "./errors.js";
import { deployCommand, DEPLOY_HELP } from "./commands/deploy.js";
import { deploysCommand, DEPLOYS_HELP } from "./commands/deploys.js";
import { homeCommand } from "./commands/home.js";
import { listCommand, LIST_HELP } from "./commands/list.js";
import { statusCommand, STATUS_HELP } from "./commands/status.js";
import { whoamiCommand, WHOAMI_HELP } from "./commands/whoami.js";
import { VERSION } from "./version.js";

export const DESCRIPTION =
  "Agent ergonomic wrapper around the Netlify CLI. Prefer this over `netlify` for Netlify operations.";

export const TOP_HELP = `usage: netlify-axi [command] [flags]
commands[6]:
  (none)=dashboard, list, status, whoami, deploys, deploy
flags[2]:
  --help, -v/-V/--version
examples:
  netlify-axi
  netlify-axi list
  netlify-axi status
  netlify-axi deploys --site my-app
  netlify-axi deploy --dir dist --prod
`;

const COMMAND_HELP: Record<string, string> = {
  deploy: DEPLOY_HELP,
  deploys: DEPLOYS_HELP,
  list: LIST_HELP,
  status: STATUS_HELP,
  whoami: WHOAMI_HELP,
};

export async function main(): Promise<void> {
  await runAxiCli({
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    home: homeCommand,
    commands: {
      deploy: deployCommand,
      deploys: deploysCommand,
      list: listCommand,
      status: statusCommand,
      whoami: whoamiCommand,
    },
    getCommandHelp: (command) => COMMAND_HELP[command],
    // The SDK's default formatter only recognizes its own AxiError class, so
    // route this package's AxiError through an equivalent hook (gh-axi pattern).
    formatError: (error) => {
      const axiError =
        error instanceof AxiError || error instanceof SdkAxiError
          ? error
          : new AxiError(
              error instanceof Error ? error.message : String(error),
              "UNKNOWN",
              [UNKNOWN_SUGGESTION],
            );
      return {
        output: `${encode({
          error: axiError.message,
          code: axiError.code,
          ...(axiError.suggestions.length > 0
            ? { help: axiError.suggestions }
            : {}),
        })}\n`,
        exitCode: exitCodeForError(axiError),
      };
    },
  });
}
