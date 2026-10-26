# Hosted runtime client

Own `src/runtime-client.mjs`; export `runRuntimeCommand(command, input, ports)`.
This is the sole HTTP boundary for the open `pdd` CLI's hosted runtime commands:
`lint`, `check`, `try`, `try stop`, `replay`, `call`, `runs` and `usage`. The
engine and service remain closed; this module only sends the proposal protocol
from [runtime usage §4](../../../../research/R-runtime-usage.md#4-commands-for-the-hosted-version).

The base origin is `PDD_RUNTIME_URL`; hosted origins are HTTPS (loopback HTTP is
accepted only by tests). If it is absent, every command returns 1 and prints
`The runtime service is not configured yet.`. Authentication reads a GitHub CLI
token using `gh auth token` for the request only and sends `Authorization: Bearer TOKEN`;
the token is never printed, returned, logged or persisted. A missing token
returns 1 with `Sign in to GitHub first: gh auth login`.

Source-bearing mutations capture the unique NUL-delimited git file list, create
an uncompressed tar, include its lowercase SHA-256 in the JSON `request` part,
and send `request` plus `source` as multipart. Each effectful operation gets one
UUID in its request body; stop uses `X-Request-Id`. Before the one possible
submit, print the exact read-only recovery command (`pdd check --request UUID`,
etc.) to stderr. A lost answer only GETs that UUID and never resubmits. Accepted
jobs are polled with GET until terminal. States map to exit 0 for `passed`, 1
for `failed`/`refused`, and 3 for `unknown`; malformed replies are uncertainty.
The command may print only safe server messages,
results and links; response objects and credentials are not dumped.

## Commands and protocol

| command | request | result |
| --- | --- | --- |
| `lint [path]` | `POST /v1/lint` multipart request/source | print verdict and diagnostics |
| `check SCENARIO [--max-calls N]` | `POST /v1/check` multipart request/source | print verdict and report link |
| `try [--from ID]` | `POST /v1/try` multipart, or JSON restore | validate and print the returned HTTPS link and QR |
| `try --terminal` | `/v1/try/:id/call` per line with an admitted `runCli` input | print safe action output |
| `try stop ID` | `DELETE /v1/try/ID` with `X-Request-Id` | print the safe result |
| `replay ID` | `POST /v1/replay`, `{requestId,from}` | print verdict and returned report link |
| `call PROMPT OP JSON [--session S]` | `POST /v1/try/ID/call`, `{requestId,prompt,operation,input}` | print the safe result |
| `runs` | `GET /v1/runs` | list safe run summaries |
| `runs show ID` | `GET /v1/runs/ID` | print one safe run summary |
| `usage` | `GET /v1/usage` | print today's safe usage |

The call session is the supplied `--session`, otherwise the prompt value is
treated as the session/try identifier required by the proposal. JSON input must
be an object or array and is parsed before any request. IDs are opaque nonempty
text accepted by the parser; path text is sent exactly as supplied.

Links from server answers are accepted only when `URL.protocol` is `https:` and
both `username` and `password` are empty. A missing, malformed, non-HTTPS or
credential-bearing link returns 1 with a plain refusal and no link is printed.
QR output is dependency-free terminal ASCII and is best effort: the link still
prints when a compact QR cannot be represented. No dependency is added.

`try --terminal` reads one line at a time from the supplied input (default
stdin), sends each line once, and prints the returned stdout, stderr, exit code
and calls-left fields. End of input stops the loop. It does not retry or hide a
network uncertainty.

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md) is required before changing this prompt or module.
- [Runtime usage §4](../../../../research/R-runtime-usage.md#4-commands-for-the-hosted-version) supplies the proposal paths and meanings used here.
- [PDD CLI](pdd-cli.prompt.md) owns parsing, help and dispatch; this module owns all HTTP details and result mapping.
- [Public boundary](public-boundary.prompt.md) permits only these explicitly listed hosted client routes.
