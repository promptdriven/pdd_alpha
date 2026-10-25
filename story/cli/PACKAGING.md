# Story: self-contained Alpha releases

Draft for review. As a person using local PDD, I want installation and recovery
to work without joining a fleet, while an optional client shares the same atomic
machine-release activation. The [contract](../../prompts/cli/packaging.prompt.md)
owns package behavior. Examples are synthetic; no release has been published.

- **AC1:** The ESM Alpha artifact keeps bin `pdd`, MIT, engine floor and the complete
  public runtime, guide, skill references, recipes and example. A packed isolated
  consumer can use local discovery and recovery without the client.
- **AC2:** Alpha contains no private client/phone/keeper code or real credentials.
  No lifecycle hook changes a machine or starts a service on package install.
- **AC3:** One verified release binds Alpha, optional client and Node. Both packages
  are complete before a managed current changes. Live packages are never overwritten.
- **AC4:** The client is public npm @promptdriven/pdd-fleet under the proprietary
  license, separately from its private source repo. Verify npm integrity and signed
  manifest authenticity; end-user npm credentials are never required. Missing
  signed artifact inputs leave current intact and Alpha-alone remains independent.
- **AC5:** Compatibility evidence covers N-1, retained older consumers and the actual
  fallback. Unknown control state cannot grant execution permission.
- **AC6:** Release evidence names immutable candidate, fixture set, staging/lab
  results, signing key id and stock-version matrix. A failed gate cannot publish;
  every release also needs the manual ten-minute iPhone check. Public Alpha
  merge/publication needs review and the full suite green on the VM.
  A test needing a person's sign-in remains pending until that person supplies it;
  an authorized merger still uses the reviewed path, never a direct push to main.
- **AC7:** Explicit setup installs the public runs-keeper boot/login service,
  generic claims and restore contract. Link reuses that recovery owner; equal
  stable service files do not change on each release.
- **AC8:** Public prompts, Stories and independent expected cases remain in the
  repository/source release with their generated module. Each part completes its
  specification before build; private specifications stay outside public Alpha.
- **AC9:** Packaging and activation preserve machine/tool account settings,
  project base folder and per-tool model/effort defaults. They add no launch-time
  account choice or bundled model/effort capability list.

[Expected cases](../../vectors/cli/packaging.json) state intended results before
implementation. Registry rights, real signatures and compatibility runs remain
release inputs; these cases are not proof that they exist.
