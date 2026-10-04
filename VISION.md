# Vision

`netlify-axi` is an agent-ergonomic interface to Netlify. It wraps the official CLI, `netlify`, first, and calls Netlify's public API, through `netlify api`, only where the other `netlify` commands have no surface or their output is not usable by an agent.

## Scope

We aim for functional parity with `netlify` on the surfaces agents operate: sites, deploys, environment variables, logs, and account identity.
Every capability available through `netlify` should eventually be accessible through an AXI-native interface.

A command may use the public Netlify API through `netlify api` when no other `netlify` command has the surface, or when the other command's output cannot be read reliably, as with `whoami` reading `netlify api getCurrentUser`.
Every Netlify call goes through the `netlify` binary and reuses the credentials `netlify` already resolves, its `netlify login` session or `NETLIFY_AUTH_TOKEN`; we do not add separate token management.

We accept contributions that expose existing Netlify capabilities more ergonomically.
We do not add functionality that Netlify itself does not provide, and we do not embed workflow logic that belongs in the calling agent.

## Interface

The interface must follow validated AXI principles and optimize for autonomous agent use.

Output may be structured, but its structure exists for agent comprehension rather than as a stable API for imperative programs.
Human-oriented presentation and compatibility work primarily serving hand-written parsers are not goals.

Errors carry a stable code and a next step the agent can act on.
An unknown flag or argument is rejected by name before any `netlify` call; it is never accepted silently.
The wrapper may reshape, combine, or simplify `netlify` and API operations when doing so improves agent ergonomics without expanding the underlying capability.

## Safety

Read commands are the default and never change site or account state.
Write commands are explicit, named as verbs, and print what changed, including any deploy they trigger.
A command that deletes or overwrites requires the target to be named in full.
When several sites could match and none is named with a flag or linked to the current directory, the command refuses and lists the names; it never guesses.
Environment variable values are printed only by a command that names one variable, and never appear in lists, errors, or logs.
