# Try the accepted user-facing behavior

Decide from the accepted prompt and Story whether this feature changes what a
person sees or types: a screen, CLI command, API answer or message. State the
evidence for that decision in the handoff.

When it does, run the documented `pdd try` command for the surface (use
`pdd try --terminal` for a terminal interaction), record the HTTPS link and give
it to the person. In the stage report, optionally add returned links:
`links:[{stage:'<current stage id>',kind:'check|try|replay',url:'https://...',verdict:'passed|failed|unknown|null'}]`.
Try links use `verdict:null`; include only HTTPS links from pdd check/try/replay output. This is a required stop: wait for the person's observation and
decision before approval or implementation continues. If the command cannot
start, report the exact reason and keep the stop visible.

For an internal-only change, do not stop for a preview. Report the check verdict
and its replay link, explain why no person-facing surface changed, and continue.
Report only links and observations that actually came from the command.
