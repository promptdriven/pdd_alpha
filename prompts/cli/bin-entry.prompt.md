# PDD executable entry

Owns `bin/pdd.mjs`. It has no exports. It is the Node executable that the package's `pdd` bin mapping names.

It runs one `pdd` command line and ends the process with that command's exit code. [CLI dispatch](pdd-cli.prompt.md) owns all command behavior, output and exit codes. This file only connects the Node process to it. Its input is the process argv. Its outcome is the process exit code.

Preservation: behavioral refinement. Keep the path, the shebang, the words passed to `runPdd` and the exit code that the shell sees. The file's form may vary.

## Rules

- Start with the shebang `#!/usr/bin/env node`, so the installed `pdd` link runs under Node. Keep the file executable.
- Import `runPdd` from `../src/pdd-cli.mjs`, resolved from this file's own location. So an absolute path to this file always runs this package, even when another `pdd` comes first on `PATH`. [Guidance](guidance.prompt.md) gives agents the absolute Node executable plus `<package root>/bin/pdd.mjs` as the exact command prefix for this reason, so keep this path.
- Call `runPdd(process.argv.slice(2))` once, with no dependencies object. The slice drops the Node executable and the script path. Without a dependencies object, the dispatcher uses the process streams, `process.cwd()`, its own package root and the real owners.
- Wait for the result and assign it to `process.exitCode`. Do not call `process.exit()`, because an early exit can cut off buffered stdout or stderr.
- Add nothing else: no output, argument change, catch, retry, environment change, second launcher, setup or install hook, or private adapter. `runPdd` resolves to an exit code for its handled failures. Any other rejection reaches Node's default handler, which reports it on stderr and exits with a nonzero code.

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md) — authoring and review method for this prompt.
- [public boundary](public-boundary.prompt.md) — shared [package manifest](public-boundary.prompt.md#package-manifest-and-checks) (authoring, generation). Local consequence: this file is the target of the bin name `pdd`, and no lifecycle script or installer wraps it.
- [CLI dispatch](pdd-cli.prompt.md) — `runPdd(argv)` and its exit codes (generation, runtime).
- [guidance](guidance.prompt.md) — names this file's path in the installed command prefix (authoring; navigation for the reason above).
- Node.js — an ES module with top-level `await`, `process.argv` and `process.exitCode` (runtime). The supported Node version is set in package metadata.
