# Story: three failed starts roll back locally

Draft for review. As a person receiving a bad update, I want PDD to return to
the previous version after three failed starts and retain my running work.
The [contract](../../prompts/cli/pdd-launch.prompt.md) owns local startup recovery.

- **AC1:** Stable exec shim and its support runtime remain usable independently
  of candidate code/Node. CLI/recover works without the client; there is no parent
  Link supervisor or independent launcher update loop.
- **AC2:** Each start has durable attempt/process/boot identity and a fresh ready
  marker. Exit/exec failure or 600000 ms without prior matching ready counts once.
  A one-shot deadline works independently of a hung Link event loop.
- **AC3:** Matching local success resets the consecutive count; relay, keeper and
  app-host health never affect it. Ready must be durable before the deadline;
  late ready never resets an accepted failure.
- **AC4:** At failure three, persist rejection/report/rollback intent, restore current
  to a verified previous, leave previous on that fallback, and start the old Link.
  This automatic rollback never consults minDowngrade. Missing fallback stops
  with Needs you without cycling on the failed candidate.
- **AC5:** Reboot/recovery/duplicate results cannot double-count, double-flip or
  retry the rejected release. New hints and seq edits do not identify a new release.
- **AC6:** Link checks the manifest at each start and owns its 5–7 h safety check.
  Failed network checks neither roll back nor reset the count. Offline reports
  queue; the old Link reports the same durable id when transport returns.
- **AC7:** Linux Link has StartLimitIntervalSec=0, normal cgroup isolation, separate
  Herdr/updater units; Mac retains detached contexts and AbandonProcessGroup.
  Link starts/updates never signal Herdr, controllers or agent panes.

[Cases](../../vectors/cli/pdd-launch.json) include reboot between failures, stale
markers, success between failures and no-ready hangs. These are expected results,
not evidence that platform recovery has run.
