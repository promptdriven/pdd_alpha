# Check the corrected contract and scenario

Read the accepted prompt, Story and independent regression cases. Choose the
accepted runtime scenario and run these commands in order:

```sh
pdd lint
pdd check <scenario>
```

Record the verdict, failed criteria, expected versus observed values and the HTTPS
result link. Run `pdd replay <run-id>` with the returned id and record its replay
link; never invent a link. A zero exit is a pass.

For exit 1, fix the accepted scope, run `pdd lint` again and rerun
`pdd check <scenario>`. Allow at most two fix-and-recheck attempts after the
initial check. If the second retry still fails, stop and ask the person. Include
the failed criteria, expected versus observed values, and the result link in that
question. Do not change regression expectations just to make a check pass.

Exit 3 means the result is unknown. If the output says the runtime service is not
configured, report that exact limitation plainly. In either case, record the
unknown result and continue the workflow; it is not a reason to block the run.
