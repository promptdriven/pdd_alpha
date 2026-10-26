# Hosted runtime client

Own `src/runtime-client.mjs`; export `runRuntimeCommand(command, input, ports)`.
This is the sole HTTP boundary for the open `pdd` CLI's hosted runtime commands:
`lint`, `check`, `try`, `try stop`, `replay`, `call`, `runs` and `usage`. The
engine and service remain closed; this module only sends the proposal protocol
from [runtime usage §4](../../../../research/R-runtime-usage.md#4-commands-for-the-hosted-version).

The base origin is `PDD_RUNTIME_URL`. If it is absent, every command returns 1
and prints `The runtime service is not configured yet.`. Every origin is joined
with a fixed path in this module. Authentication reads a GitHub CLI token using
`gh auth token` for the request only and sends `Authorization: Bearer TOKEN`;
the token is never printed, returned, logged or persisted. A missing token
returns 1 with `Sign in to GitHub first: gh auth login`.

Each HTTP request gets a fresh UUID in `Idempotency-Key` and is sent once. Before
the request is sent, print `If this stops, run: pdd runs show REQUEST_ID`. A request or
response failure that does not establish a clear verdict is unknown and exits 3.
Server verdicts `passed`/`completed` return 0, `failed` return 1 and
`unknown`/`unclear` return 3. The command may print only safe server messages,
results and links; response objects and credentials are not dumped.

## Commands and protocol

| command | request | result |
| --- | --- | --- |
| `lint [path]` | `POST /v1/lint`, `{path}` when supplied | print verdict and diagnostics |
| `check SCENARIO [--max-calls N]` | `POST /v1/check`, `{scenario,maxCalls}` | print verdict, reason, calls and link |
| `try [--from ID]` | `POST /v1/try`, `{from}` when supplied | validate and print the returned HTTPS link and QR |
| `try --terminal` | same start request, then `POST /s/TOKEN/api/command` per input line with `{line}` | print stdout, stderr, exit code and calls left |
| `try stop ID` | `DELETE /v1/try/ID` | print the safe result |
| `replay ID` | `POST /v1/replays`, `{id}` | print verdict and returned HTTPS link |
| `call PROMPT OP JSON [--session S]` | `POST /v1/try/ID/call`, `{prompt,op,args,session}` | print the safe result |
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
