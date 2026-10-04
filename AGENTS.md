# Project agent memory

Project-intrinsic knowledge for agents working on netlify-axi.

## What this is

An AXI-compliant wrapper around the Netlify CLI, built on `axi-sdk-js`
(`runAxiCli` in `src/cli.ts`) and deliberately modeled on the reference
implementation [gh-axi](https://github.com/kunchenguid/gh-axi) and the sibling
project railway-axi. When adding a capability, check how gh-axi solved the
analogous problem first, and follow the AXI principles (the `axi` skill in the
upstream `kunchenguid/axi` repo).

## Architecture

- `bin/netlify-axi.ts` — entrypoint; answers bare `-v`/`-V`/`--version` via
  `axi-sdk-js/fast-path` before dynamically importing `src/cli.ts`.
  `src/version.ts` must stay a LEAF module (node builtins only) or the fast
  path silently stops being fast.
- `src/netlify.ts` — sole place that spawns the `netlify` binary
  (`netlifyJson` / `netlifyExec`). Non-zero exits route through
  `mapNetlifyError`; a missing binary maps to `NETLIFY_NOT_INSTALLED`.
- `src/errors.ts` — `mapNetlifyError` walks `patterns` in order and returns on
  the first regex hit, so order is the contract: narrow patterns before broad
  ones (`CONFIG`'s "When resolving config file" must precede `NOT_FOUND`'s
  "does not exist"). Verify new patterns against real netlify stderr before
  adding them; `stripDecoration` removes the `›  ` prefix and the leading
  `Error: ` label netlify puts on every stderr line.
- `src/args.ts` — v0 commands take no args/flags; `assertNoArgs` rejects
  unknown input by name with exit code 2 before any netlify call (AXI §6).
- Commands live in `src/commands/`, return TOON strings via `src/toon.ts`
  helpers; errors render through the `formatError` hook in `src/cli.ts`
  because the SDK's default formatter only recognizes its own AxiError class.

## Netlify CLI notes (netlify-cli 18.x, verified by real runs)

- `netlify sites:list --json` returns an array of very large flat objects
  (~100 keys per site); the wrapper reads `name`, `account_name`,
  `custom_domain`, `ssl_url`/`url`, `updated_at`. The array is NOT sorted by
  update time — `siteRows` sorts it most-recent-first.
- `netlify status --json` is directory-scoped (linked site) and returns
  `{ account: { Email, Teams }, siteData }` where `siteData` keys are
  dash-cased (`site-name`, `admin-url`, `site-url`, `site-id`). In an unlinked
  directory it prints nothing on stdout and exits 1 with
  `Error: You don't appear to be in a folder that is linked to a site`.
- `netlify status` WITHOUT `--json` prints the logged-in user even when
  unlinked but still exits 1 — do not use it for whoami. Use
  `netlify api getCurrentUser` instead: clean JSON, `full_name` may be null.
- Auth errors surface as `JSONHTTPError: Unauthorized`; missing API resources
  as `JSONHTTPError: Not Found`. Every stderr line starts with `›  `.
- A broken `netlify.toml` (e.g. base dir that no longer exists) fails ANY
  command run in that directory with `Error: When resolving config file …` —
  mapped to `CONFIG`.
- DANGER: an unauthenticated netlify invocation does not fail fast — it starts
  a browser login flow and hangs on "Waiting for authorization...". Never
  probe auth state by clearing HOME/config; use an invalid
  `NETLIFY_AUTH_TOKEN` env var to observe auth errors safely.
- The SDK ships `update` as a reserved built-in, so `netlify-axi update` works
  with no code here; the npm package name resolves from `package.json`.

## Conventions

- pnpm, Node >= 20, ES modules, TypeScript Node16 resolution
  (import specifiers end in `.js`), Vitest tests in `test/`.
- Tests are OFFLINE: they feed captured real fixtures to the exported parse
  helpers and never spawn the real netlify binary.
- Conventional commit messages (`feat:`, `fix:`, `docs:`). Releases are cut by
  release-please from these commits and published to npm by trusted publishing.

## Maintaining this file

Keep entries concise and durable; point at the authoritative file rather than
restating what the code shows. Prefer rewriting or pruning over appending.
