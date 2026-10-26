# What checks mean

PDD Alpha helps author contracts and expected cases. Its local issue runner can launch native agent stages and execute approved project test commands. Runtime-backed projects can also use `pdd lint`, `pdd check` and `pdd try` when their runtime is configured.

For the included synthetic code example, from the repository root:

```sh
node --test examples/ticket-status/test/status.test.mjs
```

That native Node test compares actual implementation behavior with independently authored cases. The cases' JSON shape belongs to this example, not a general PDD schema. Review the prompt and Story as well as the tests. Passing these cases is useful evidence, not exhaustive correctness or formal proof.

For a different project, inspect its instructions and use its actual test runner. Keep the intended behavior and expected results independent of the implementation's output. Report failures without silently changing expectations to make them pass. A test that was only written is unrun.

The public repository's full suite is `npm test`. Package checks should verify that the CLI works from a clean extracted archive and that guide, skill, recipes and example links resolve. A command's help entry alone is not behavioral acceptance. Capturing Herdr/native/GitHub stand-ins do not establish actual installed-agent, attachment or PR behavior. Isolated issues can exercise worktree boundaries without establishing concurrent-session capacity; report actual platform and session results. See [CONTRIBUTING.md](../CONTRIBUTING.md).

An agent's review, project tests, runtime verdict, manual app observations and optional formal analysis are different forms of evidence. Report what actually happened, with the scope and remaining uncertainty. A runtime exit 3 or an unconfigured service is an unknown result and does not block the workflow; it is not a pass.
