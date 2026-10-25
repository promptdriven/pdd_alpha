# Story: choose a project by name

Draft for review. As a person starting work, I want the same named projects in the terminal and phone so I can choose familiar work without typing a folder.

The [owning prompt](../../prompts/cli/workflow-projects.prompt.md) defines the contract.

## Observable acceptance criteria

- **AC1:** Discovery combines past native chat folders, Herdr, runs, usual local places and GitHub metadata without launching, cloning, signing in or reading conversation bodies.
- **AC2:** Canonical local roots merge source evidence; equal names on distinct roots remain distinct and receive repository/machine context.
- **AC3:** Results sort by latest use, then case-insensitive name and stable id; missing sources become warnings while other results remain available.
- **AC4:** Name resolution prefers exact case-insensitive matches, then substring matches; exactly one local match selects the actual allowed cwd.
- **AC5:** Ambiguous, empty, path-looking and absent queries fail finitely with no launch or implicit write.
- **AC6:** An uncloned GitHub repository requires an explicit Projects clone action; the project base defaults to ~/pdd and collisions never overwrite.
- **AC7:** A disappeared or no-longer-allowed root refuses before launch.
- **AC8:** New agent uses the same identities and preselects its last successfully used available project; browsing is by taps and creation is explicit.

[Expected cases](../../vectors/cli/workflow-projects.json) are synthetic independent expectations, not implementation or live-service results.
