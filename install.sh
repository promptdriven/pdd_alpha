#!/bin/sh
# Generated from prompts/cli/bootstrap.prompt.md (sha256: d198a03e4fa35a1aa37c81f1fc660e09baca624a604ce12c0ac2625a2021e069).
set -eu
# Release CI replaces this empty, pinned table in its verified installer. A
# checkout deliberately contains no production URL, key or fabricated artifact.
pdd_release_table='__PDD_RELEASE_TABLE__'
pdd_bootstrap_fail() { printf '%s\n' "$1" 'Next: Obtain the verified GitHub release installer, then rerun pdd setup.' >&2; exit 1; }
case "$pdd_release_table" in '__PDD_RELEASE_TABLE__') pdd_bootstrap_fail 'verification_error: trusted release descriptor is unavailable.' ;; esac
for pdd_tool in uname curl openssl tar gzip awk df mktemp mkdir chmod cat; do
  command -v "$pdd_tool" >/dev/null 2>&1 || pdd_bootstrap_fail "Missing prerequisite: $pdd_tool"
done
case "$(uname -s)" in Darwin) pdd_os=darwin ;; Linux) pdd_os=linux ;; *) pdd_bootstrap_fail 'Unsupported runtime.' ;; esac
case "$(uname -m)" in x86_64|amd64) pdd_arch=x64 ;; arm64|aarch64) pdd_arch=arm64 ;; *) pdd_bootstrap_fail 'Unsupported architecture.' ;; esac
if [ -f /proc/sys/kernel/osrelease ]; then
  case "$(cat /proc/sys/kernel/osrelease)" in *[Mm]icrosoft*|*WSL*) pdd_bootstrap_fail 'WSL requires its separately verified systemd, linger and restart preflight.' ;; esac
fi
[ -n "${HOME:-}" ] || pdd_bootstrap_fail 'Owned install home is unavailable.'
case "$HOME" in /*) ;; *) pdd_bootstrap_fail 'Owned install home must be absolute.' ;; esac
[ ! -L "$HOME/.pdd" ] || pdd_bootstrap_fail 'Owned install path is a symlink.'
if [ -e "$HOME/.pdd/current" ] || [ -L "$HOME/.pdd/current" ] || [ -e "$HOME/.pdd/install/record.json" ]; then
  if [ -x "$HOME/.pdd/launcher/pdd-launch" ]; then
    printf '%s\n' 'Continue with pdd setup'
    exec "$HOME/.pdd/launcher/pdd-launch" cli setup "$@"
  fi
  # Re-enter only through this verified installer. Its Node entry must reconcile
  # the saved first-install identity before any activation or support repair.
fi
pdd_row=$(printf '%s\n' "$pdd_release_table" | awk -F '|' -v os="$pdd_os" -v arch="$pdd_arch" '$1==os && $2==arch {print}')
[ -n "$pdd_row" ] || pdd_bootstrap_fail 'No trusted artifact matches this platform.'
pdd_old_ifs=$IFS; IFS='|'; read -r pdd_os pdd_arch pdd_version pdd_node_url pdd_node_hash pdd_alpha_url pdd_alpha_hash pdd_descriptor <<EOF
$pdd_row
EOF
IFS=$pdd_old_ifs
case "$pdd_node_url $pdd_alpha_url" in https://*' 'https://*) ;; *) pdd_bootstrap_fail 'Release assets require HTTPS.' ;; esac
mkdir -p "$HOME/.pdd/update/staging" || pdd_bootstrap_fail 'Owned path is not writable.'
[ ! -L "$HOME/.pdd/update" ] && [ ! -L "$HOME/.pdd/update/staging" ] || pdd_bootstrap_fail 'Staging path is a symlink.'
pdd_stage=$(mktemp -d "$HOME/.pdd/update/staging/bootstrap-XXXXXXXX") || pdd_bootstrap_fail 'Cannot stage this install.'
# Incomplete data remains transaction-owned after interruption. No trap removes
# a folder that an accepted worker or a flipped current might reference.
printf '%s\n' 'Downloading verified runtime. Continue with pdd setup'
curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location --silent --show-error "$pdd_node_url" -o "$pdd_stage/node.tar.gz" || pdd_bootstrap_fail 'Runtime download failed.'
curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location --silent --show-error "$pdd_alpha_url" -o "$pdd_stage/alpha.tar.gz" || pdd_bootstrap_fail 'Alpha download failed.'
pdd_check_hash() {
  pdd_actual=$(openssl dgst -sha256 "$1") || return 1
  [ "${pdd_actual##* }" = "$2" ]
}
pdd_check_hash "$pdd_stage/node.tar.gz" "$pdd_node_hash" || pdd_bootstrap_fail 'Runtime verification failed.'
pdd_check_hash "$pdd_stage/alpha.tar.gz" "$pdd_alpha_hash" || pdd_bootstrap_fail 'Alpha verification failed.'
pdd_free=$(df -Pk "$pdd_stage" | awk 'END {print $4}')
[ "$pdd_free" -ge 1048576 ] || pdd_bootstrap_fail 'Leave at least 1 GB free after staging.'
pdd_safe_archive() {
  tar -tzf "$1" > "$pdd_stage/list" || return 1
  awk 'BEGIN {bad=0} /^\// || /\\/ || /(^|\/)\.\.(\/|$)/ {bad=1} END {exit bad}' "$pdd_stage/list"
}
pdd_safe_archive "$pdd_stage/node.tar.gz" || pdd_bootstrap_fail 'Unsafe runtime archive.'
pdd_node_member="node-v$pdd_version-$pdd_os-$pdd_arch/bin/node"
tar -tvzf "$pdd_stage/node.tar.gz" "$pdd_node_member" > "$pdd_stage/node-member" || pdd_bootstrap_fail 'Runtime executable is missing.'
awk 'substr($0,1,1)!="-" {exit 1} END {if (NR!=1) exit 1}' "$pdd_stage/node-member" || pdd_bootstrap_fail 'Unsafe runtime executable.'
pdd_safe_archive "$pdd_stage/alpha.tar.gz" || pdd_bootstrap_fail 'Unsafe Alpha archive.'
tar -tvzf "$pdd_stage/alpha.tar.gz" > "$pdd_stage/alpha-members" || pdd_bootstrap_fail 'Invalid Alpha archive.'
awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" {exit 1}' "$pdd_stage/alpha-members" || pdd_bootstrap_fail 'Alpha archive contains unsupported links.'
mkdir "$pdd_stage/node" "$pdd_stage/alpha"
tar -xzf "$pdd_stage/node.tar.gz" -C "$pdd_stage/node" --strip-components=1 "$pdd_node_member" || pdd_bootstrap_fail 'Runtime extraction failed.'
tar -xzf "$pdd_stage/alpha.tar.gz" -C "$pdd_stage/alpha" --strip-components=1 || pdd_bootstrap_fail 'Alpha extraction failed.'
pdd_probe=$("$pdd_stage/node/bin/node" -p 'process.versions.node+"|"+process.platform+"|"+process.arch') || pdd_bootstrap_fail 'Verified runtime cannot execute.'
[ "$pdd_probe" = "$pdd_version|$pdd_os|$pdd_arch" ] || pdd_bootstrap_fail 'Runtime identity mismatch.'
printf '%s' "$pdd_descriptor" > "$pdd_stage/release.json"
printf '%s\n' 'Runtime ready. Continue with pdd setup'
exec "$pdd_stage/node/bin/node" "$pdd_stage/alpha/launcher/bootstrap-entry.mjs" "$HOME" "$pdd_stage" "$@"
