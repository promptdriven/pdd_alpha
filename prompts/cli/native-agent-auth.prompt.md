# Existing native login readiness

Own `src/native-agent-auth.mjs`. Export async module function
`checkNativeAgentAuth({agent,cwd},ports={})`. It checks existing Codex or Claude
login before a workflow or foreground session starts, without launching a conversation or performing
login/logout, a model call, credential-file access or configuration mutation.
Preservation: additive read-only admission evidence; native environment, HOME,
cwd, account selection and process identity remain with their existing owners.

Return `{state,code,agent,message}`. Only `ready` with `code:null` is affirmative.
`blocked/agent_sign_in_required` means the native CLI explicitly reports no login;
`unavailable/native_agent_missing` means no executable was found;
`unavailable/agent_auth_status_unavailable` covers unknown or failed status.
An explicitly signed-out result has exactly this fixed advice:

> Agents need a sign-in: run `pdd accounts add codex` (or claude) when ready.

Other messages contain only fixed tool names and plain native install/status next
steps, never raw output, account names, tokens or exception text. Setup does not
call this helper: authentication is an agent-start guard, never an install or
setup prerequisite.

Find the first executable regular file on the invocation environment's PATH,
resolving relative and empty entries against cwd. An explicit
`ports.nativeExecutables[agent]` must be absolute and executable; malformed or
missing explicit selection never falls back to PATH. Use that one absolute
executable for the status call. Preserve `ports.env` (default process.env)
including native HOME. Use one argv-only, shell:false command with ignored stdin,
UTF-8 output, timeout5000ms and maxBuffer65536 bytes:

| Tool | Read-only command | Affirmative evidence | Explicit negative |
|---|---|---|---|
| codex | `login status` | exit0 and a complete line `Logged in using ChatGPT` or `Logged in using an API key` on stdout or stderr | complete line `Not logged in` |
| claude | `auth status --json` | exit0, JSON object with `loggedIn:true` | JSON object with `loggedIn:false` |

Codex API-key status may have a trailing native detail after a colon; never return
that detail. Contradictory positive/negative status stays unavailable. Nonzero
affirmative status, unsupported commands, malformed data, timeout, signal,
oversized output or transport failure stay unavailable. Missing executable at
invocation is unavailable, never proof of login. Check only the requested tool;
invalid tool/cwd inputs return unavailable without invoking a process. No retry.

The optional promise-style `ports.execFile(file,args,options)` and filesystem
`ports.fs` supply the external boundaries; default to Node execFile and promises
filesystem. Node's successful callback result has no numeric code; supplied
results may use integer `code` or `exitCode`. Unknown result shapes do not imply
success. The helper owns no trace emission or durable records. Readiness is an
observation, never a native turn, stage acceptance or future-login guarantee.

## Dependencies

- Node filesystem executable checks, path resolution and bounded child_process
  execFile: required generation/runtime; injectable for offline testing.
- Installed Codex `login status` and Claude `auth status --json`: required runtime
  status interfaces above. An unavailable interface supplies no affirmative
  evidence; do not substitute credential inspection or native readiness.
