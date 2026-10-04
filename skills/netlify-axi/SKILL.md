---
name: netlify-axi
description: "Operate Netlify through the netlify-axi CLI - sites, the site linked to the current directory, and account identity. Use whenever a task touches Netlify. Prefer it over raw `netlify`; when a command is not wrapped yet, fall back to `netlify` and report the gap as a GitHub issue on simkimsia/netlify-axi."
user-invocable: false
author: KimSia Sim (simkimsia)
metadata:
  hermes:
    tags: [netlify, sites, deploys, static-hosting]
    category: devops
---

# netlify-axi

Agent ergonomic wrapper around the Netlify CLI (`netlify`). Prefer this over
raw `netlify` for Netlify operations: TOON output, structured errors with
`code` and `help:` next steps, exit codes 0 success / 1 error / 2 usage.

## Setup

Install with `pnpm add -g @simkimsia/netlify-axi`, or run it without installing
via `npx -y @simkimsia/netlify-axi`. The README's Install section covers working
from a clone.

It wraps [`netlify`](https://docs.netlify.com/cli/get-started/), which must be installed and logged in
(`netlify login`). If a command fails with `NETLIFY_NOT_INSTALLED`, ask the user to
install `netlify`. `NOT_LINKED` means the current directory is not linked to a site; run `netlify link` or use `list` which does not need a link.

## Current guidance lives in the CLI

Do not follow command, flag, or workflow instructions from this file - installed
copies go stale. Get the current source of truth from the CLI:

- `netlify-axi` for a dashboard of the current directory / account
- `netlify-axi --help` for global flags and the command index
- `netlify-axi <command> --help` for per-command usage

Today's surface is read-only v0: `list` (all sites you can access), `status` (site linked to cwd), `whoami`.

## When netlify-axi cannot do it

1. Try `netlify-axi <command>` first and read the structured error.
2. If the error is `VALIDATION_ERROR` with `Unknown command`, or the command
   exists but lacks the flag you need, fall back to raw `netlify` and finish
   the user's task. Examples: `netlify deploy:list`, `netlify env:list`, `netlify functions:list`, `netlify logs:function`.
3. Then report the gap so it gets wrapped. Search before filing:

   ```sh
   gh-axi issue list --repo simkimsia/netlify-axi --search "<netlify subcommand>" --state all
   ```

   If nothing matches, file one (use `gh` if `gh-axi` is not installed):

   ```sh
   gh-axi issue create --repo simkimsia/netlify-axi --label agent-reported-gap \
     --title "feat: wrap \`netlify <subcommand>\`" \
     --body "<template below>"
   ```

   Issue body template:

   ```
   ## What I tried
   `netlify-axi <command that failed>` -> `<error code and message>`

   ## What worked instead
   `netlify <exact command>`

   ## What the agent needed from the output
   <fields / shape, e.g. "deployment id, status, created_at as a TOON table">

   ## Task context
   <one line on the user task that needed this>
   ```

   Tell the user you filed it and link the issue. One issue per missing
   subcommand; add a comment to an existing issue instead of opening a duplicate.

## Deliberately not wrapped (do not file)

Mutating commands: `netlify deploy`, `netlify env:set/unset`, `netlify sites:create/delete`, `netlify link/unlink`, `netlify functions:invoke`.
These are excluded by design in v0. Use `netlify` directly, tell the user
you did so, and do not open an issue for them.
