import { AxiError } from "./errors.js";

/**
 * AXI §6: fail loud on unrecognized input. Every v0 command takes no args or
 * flags, so anything left in argv is rejected by name before any netlify call.
 */
export function assertNoArgs(command: string, args: string[]): void {
  if (args.length === 0) return;
  const kind = args[0].startsWith("-") ? "flag" : "argument";
  throw new AxiError(
    `unknown ${kind} ${args[0]} for \`${command}\``,
    "VALIDATION_ERROR",
    [`\`netlify-axi ${command}\` takes no arguments (--help always allowed)`],
  );
}

/**
 * Pull `--flag value` or `--flag=value` out of args (mutating it) and return
 * the value. A flag with no value, a blank value, or another flag where the
 * value should be is a VALIDATION_ERROR rather than a silent undefined.
 */
export function takeFlag(
  command: string,
  args: string[],
  flag: string,
): string | undefined {
  const equalsPrefix = `${flag}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    let value: string | undefined;
    let width: number;
    if (arg === flag) {
      value = args[i + 1];
      width = 2;
      if (value?.startsWith("-")) value = undefined;
    } else if (arg.startsWith(equalsPrefix)) {
      value = arg.slice(equalsPrefix.length);
      width = 1;
    } else {
      continue;
    }
    if (value === undefined || value.trim() === "") {
      throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR", [
        `Run \`netlify-axi ${command} --help\` for usage`,
      ]);
    }
    args.splice(i, width);
    if (args.some((a) => a === flag || a.startsWith(equalsPrefix))) {
      throw new AxiError(`${flag} given more than once`, "VALIDATION_ERROR", [
        `Pass ${flag} once`,
      ]);
    }
    return value;
  }
  return undefined;
}

/** Pull a bare boolean `--flag` out of args (mutating it). */
export function takeBoolFlag(
  command: string,
  args: string[],
  flag: string,
): boolean {
  const index = args.indexOf(flag);
  if (index === -1) {
    const withValue = args.find((a) => a.startsWith(`${flag}=`));
    if (withValue) {
      throw new AxiError(
        `${flag} takes no value, got ${withValue}`,
        "VALIDATION_ERROR",
        [`Run \`netlify-axi ${command} --help\` for usage`],
      );
    }
    return false;
  }
  args.splice(index, 1);
  if (args.includes(flag)) {
    throw new AxiError(`${flag} given more than once`, "VALIDATION_ERROR", [
      `Pass ${flag} once`,
    ]);
  }
  return true;
}

/**
 * Call after a command has taken every flag it understands. Whatever is left
 * is unknown; reject it by name with exit code 2 (AXI §6).
 */
export function rejectExtraArgs(command: string, args: string[]): void {
  if (args.length === 0) return;
  const kind = args[0].startsWith("-") ? "flag" : "argument";
  throw new AxiError(
    `unknown ${kind} ${args[0]} for \`${command}\``,
    "VALIDATION_ERROR",
    [`Run \`netlify-axi ${command} --help\` for the flags it accepts`],
  );
}
