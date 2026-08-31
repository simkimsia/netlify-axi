# netlify-axi

An [AXI](https://axi.md)-compliant wrapper around the [Netlify](https://netlify.com) CLI —
token-efficient [TOON](https://toonformat.dev) output, structured errors, and
agent-first ergonomics for AI coding agents that operate Netlify via shell.

Built on [`axi-sdk-js`](https://github.com/kunchenguid/axi), modeled on the
reference implementation [`gh-axi`](https://github.com/kunchenguid/gh-axi).

## Status

Early scaffold (v0). Read-only commands only.

## Requirements

- Node.js >= 20
- The [Netlify CLI](https://docs.netlify.com/cli/get-started/) installed and
  logged in (`netlify login`)

## Usage

```sh
netlify-axi            # dashboard: linked site, or most recent sites
netlify-axi list       # all sites you have access to
netlify-axi status     # site linked to the current directory
netlify-axi whoami     # logged-in Netlify account
netlify-axi --help
netlify-axi --version  # fast path, never loads the command graph
netlify-axi update     # self-update (built into axi-sdk-js)
```

Example output (TOON):

```
count: 5 sites
sites[5]{name,team,url,updated}:
  my-app,Acme,https://my-app.netlify.app,3d ago
  ...
help[2]:
  Run `netlify link` in a project directory to link a site
  Run `netlify-axi status` to see the linked site
```

## Development

```sh
pnpm install
pnpm run dev          # run from source (tsx)
pnpm test             # vitest
pnpm run build        # tsc -> dist/
pnpm run format:check
```

## License

MIT
