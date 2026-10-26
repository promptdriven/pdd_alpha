# Story: install on a stock machine

Draft for review. As a person on a stock Mac or Linux machine, I want the release
installer to start setup even if Node and npx are missing. The
[contract](../../prompts/cli/bootstrap.prompt.md) owns bootstrap. Setup owns account
questions and consents; this Story supplies no sign-in or install authority.

- **AC1:** Verified bootstrap installs verified PDD Node before executing Alpha.
  Missing system Node/npx is supported; missing trust material is an error.
- **AC2:** Unsupported platform, missing verification/download tools, unwritable
  owned paths and insufficient disk fail before active install changes, with one
  next step. No sudo or profile edit is automatic.
- **AC3:** cwd and argv, including shell metacharacters, reach setup unchanged.
  Codex-only, Claude-only and both-tool choices belong to the same setup flow.
- **AC4:** Existing installs recover and hand off to their installed runtime.
  A newer bootstrap does not silently replace it. Repeated setup preserves work.
- **AC5:** Interruption before flip preserves current; after flip recovery uses the
  durable transaction. An accepted detached job survives terminal/SSH closure.
- **AC6:** Each checkpoint prints plain `pdd setup`, which recovers the same
  transaction from the install record without a --resume flag. Setup proves shim precedence in
  fresh zsh/bash/fish and Herdr panes, and leaves old-tool cleanup to doctor.
  Ordinary typed native commands remain untouched by default; vendor sign-ins
  stay untouched and any Herdr hook/config addition needs setup's stated consent.
- **AC7:** Initial/continued setup delegates accounts to machine/tool Settings
  and preserves existing account, project-base and model/effort defaults. It asks
  no agent/run account question and supplies no project picker or model list.

[Cases](../../vectors/cli/bootstrap.json) use synthetic downloads and process
evidence. No actual bootstrap artifact or clean-image run is claimed here.
