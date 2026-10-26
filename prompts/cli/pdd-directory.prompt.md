# Private PDD directories

Own `src/pdd-directory.mjs`, `launcher/native/pdd-directory.c` and its bundled
platform executable. Installation and setup keep PDD directories private
because they contain keys, vault material and journals. This authorized security
refinement preserves file contents, file modes, install identities and user data.

Module function `ensurePrivateDirectory(directory, io)` creates the requested
directory at exactly 0700, independent of umask. On existing paths, repair only
`.pdd` itself and its direct mutable children `logs`, `runs`, `fleet`, `accounts`,
`claims`, `install` and `link`; preserve other existing directory modes. Do not
chmod HOME or ancestors outside PDD. A private `.pdd` parent already excludes
other users from existing immutable runtimes.
Create absent outer parents when needed, preserving their existing modes; an
existing aliased parent must be refused before creating anything through it.

Module function `repairPrivatePddHome(directory, io)` secures the supplied
`.pdd` root and the listed direct mutable children that already exist, without
recursing or creating absent children. Reject unsafe types or owners for these
paths. Never traverse `versions`, `tools/node`, `current` or other runtime trees;
leave existing runtime modes, bytes, receipts and tree digests unchanged.

Module function `repairPrivateTree(directory, io)` normalizes every real directory
in a newly created, transaction-owned extraction/support tree to 0700 before its
first integrity receipt is computed. It is not an upgrade migration for existing
runtime trees. Skip files and symbolic links without reading or changing their
targets; directory repair never changes file bytes or permissions.

Before changing an existing component, require a real directory owned by the
effective user. Refuse symbolic links, other types, ownership mismatch and
unproved filesystem identity. Use the opened directory identity for mode repair;
retain the expected ancestor identity across every traversal step, never follow
a substituted ancestor/final symlink or block on a FIFO. Creation and mode changes
must be descriptor-relative to a verified parent, including absent-child races;
rechecking a pathname after an outside effect is insufficient. Revalidate named
identities before returning success. If directory authority cannot be retained,
refuse without any outside creation or chmod. Do not fall back to path-based
mutation when the bundled helper is missing or fails. A failure throws
and cannot authorize installation, activation or service effects. Equal private
directories need no mode write. Preserve directory inodes, file bytes/modes,
symlink targets and the process umask. Concurrent creation of the same owned
directory is allowed; replacement with a different object is not.

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md): authoring.
- Runtime: Node filesystem directory handles and the bundled platform
  `launcher/native/<platform>-<arch>/pdd-directory` executable. The POSIX helper
  takes a canonical absolute target, repair-existing flag and expected parent/
  optional existing target device+inode identities; it verifies all ancestors
  without links, uses mkdirat/openat/fchmod on bound descriptors, and returns
  the resulting directory device+inode. Only directories owned by the effective
  user may be created/repaired. Invalid input, changed identity or failed privacy
  repair exits unsuccessfully, without authorizing further setup effects.
- [Native build owner](update-lock.prompt.md): navigation-only release build
  entry for bundled Mac/Linux helpers; no runtime compiler or external installer.
