#!/bin/sh
# Generated from prompts/cli/bootstrap.prompt.md (sha256: 7b07a734be0f15fca1a6457f5dd15f3374d9bd60fa8baf0f6b8eba97b4e90b09).
set -eu
# This installer is a child process; never change the invoking shell's umask.
umask 077
# Release CI replaces this empty, pinned table in its verified installer. A
# checkout deliberately contains no production URL, key or fabricated artifact.
pdd_release_table='__PDD_RELEASE_TABLE__'
pdd_npm_cleanup='__PDD_NPM_CLEANUP__'
pdd_r_line_move='__PDD_R_LINE_MOVE__'
pdd_trust_descriptor='__PDD_TRUST_DESCRIPTOR__'
pdd_trust_signature='__PDD_TRUST_SIGNATURE__'
pdd_trust_root='__PDD_TRUST_ROOT__'
pdd_bootstrap_fail() { printf '%s\n' "$1" 'Next: Obtain the verified GitHub release installer, then rerun pdd setup.' >&2; exit 1; }
case "$pdd_release_table" in '__PDD_RELEASE_TABLE__') pdd_bootstrap_fail 'verification_error: trusted release descriptor is unavailable.' ;; esac
for pdd_tool in uname curl openssl tar gzip awk df mktemp mkdir chmod cat cp; do
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
# Enter through the current verified directory, then operate on ".". A path
# recheck after chmod would be too late if an ancestor had become a symlink.
pdd_enter_private() {
  [ "$(pwd -P)" = "$pdd_directory" ] && [ "$pdd_directory" -ef . ] || pdd_bootstrap_fail 'Owned install directory changed.'
  [ ! -L "$1" ] || pdd_bootstrap_fail 'Owned install directory is a symlink.'
  pdd_created=false
  if [ -e "$1" ]; then
    [ -d "$1" ] && [ -O "$1" ] || pdd_bootstrap_fail 'Owned install directory has an unsafe type or owner.'
  else
    pdd_created=true
    mkdir -m 700 "./$1" || pdd_bootstrap_fail 'Owned install directory cannot be created.'
  fi
  pdd_directory="$pdd_directory/$1"
  CDPATH= cd -P "./$1" || pdd_bootstrap_fail 'Owned install directory cannot be opened.'
  [ "$(pwd -P)" = "$pdd_directory" ] && [ "$pdd_directory" -ef . ] && [ -O . ] || pdd_bootstrap_fail 'Owned install directory changed.'
  if [ "$pdd_created" = true ] || [ "${2:-}" = repair ]; then
    chmod 700 . || pdd_bootstrap_fail 'Owned install directory cannot be made private.'
  fi
  [ "$(pwd -P)" = "$pdd_directory" ] && [ "$pdd_directory" -ef . ] || pdd_bootstrap_fail 'Owned install directory changed.'
}
# This traversal is used only inside the newly extracted transaction tree.
# Each child inherits the entered parent as its filesystem authority.
pdd_normalize_fresh_tree() {
  [ "$(pwd -P)" = "$pdd_directory" ] && [ "$pdd_directory" -ef . ] || pdd_bootstrap_fail 'Extracted directory changed.'
  for pdd_child in .[!.]* ..?* *; do
    if [ -L "./$pdd_child" ]; then
      pdd_bootstrap_fail 'Extracted directory contains an unsafe link.'
    elif [ -d "./$pdd_child" ]; then
      (pdd_enter_private "$pdd_child" repair; pdd_normalize_fresh_tree) || return 1
    elif [ -e "./$pdd_child" ] && [ ! -f "./$pdd_child" ]; then
      pdd_bootstrap_fail 'Extracted tree contains an unsafe type.'
    fi
  done
  [ "$(pwd -P)" = "$pdd_directory" ] && [ "$pdd_directory" -ef . ] || pdd_bootstrap_fail 'Extracted directory changed.'
}
(
  CDPATH= cd -P "$HOME" || pdd_bootstrap_fail 'Owned install home cannot be opened.'
  pdd_directory="$HOME"
  pdd_enter_private .pdd repair
  for pdd_mutable in logs runs fleet accounts claims install link; do
    if [ -e "$pdd_mutable" ] || [ -L "$pdd_mutable" ]; then
      (pdd_enter_private "$pdd_mutable" repair) || exit 1
    fi
  done
) || exit 1
# Begin R-line migration: the embedded owner script decides exact targets.
pdd_old_line=false
for pdd_old_path in "$HOME/pocket" "$HOME/Applications/PDD Session Links.app" "$HOME/.config/fish/conf.d/pocket.fish"   "$HOME/Library/LaunchAgents/ai.promptdriven.pocket.gateway.plist" "$HOME/Library/LaunchAgents/ai.promptdriven.pocket.team-access.plist"   "$HOME/Library/LaunchAgents/ai.promptdriven.pdw.session-links.plist"   "$HOME/.config/systemd/user/pocket-gateway.service" "$HOME/.config/systemd/user/pocket-team-access.service" "$HOME/.config/systemd/user/pocket-team-access.timer"; do
  if [ -e "$pdd_old_path" ] || [ -L "$pdd_old_path" ]; then pdd_old_line=true; fi
done
for pdd_old_name in pdd pdw pdd-v1; do
  pdd_old_path="$HOME/.local/bin/$pdd_old_name"
  if [ -L "$pdd_old_path" ]; then
    pdd_old_target=$(/usr/bin/readlink "$pdd_old_path") || pdd_bootstrap_fail 'Old-build wrapper cannot be inspected.'
    case "$pdd_old_target" in "$HOME/pocket"|"$HOME/pocket/"*|../../pocket|../../pocket/*) pdd_old_line=true ;; esac
  elif [ "$pdd_old_name" = pdd-v1 ] && [ -f "$pdd_old_path" ]; then
    if /usr/bin/grep -q 'pocket' "$pdd_old_path"; then pdd_old_line=true; fi
  fi
done
if [ "$pdd_old_line" = true ]; then
  (
    [ -x /bin/bash ] || pdd_bootstrap_fail 'Old-build move requires /bin/bash.'
    command -v rm >/dev/null 2>&1 || pdd_bootstrap_fail 'Old-build move requires rm.'
    command -v date >/dev/null 2>&1 || pdd_bootstrap_fail 'Old-build move requires date.'
    case "$pdd_r_line_move" in '__PDD_R_LINE_MOVE__') pdd_bootstrap_fail 'The old-build move is not ready yet.' ;; esac
    pdd_move_tmp=$(mktemp -d) || pdd_bootstrap_fail 'Old-build move cannot create temporary storage.'
    trap 'rm -rf "$pdd_move_tmp"' 0
    trap 'exit 1' HUP INT TERM
    printf '%s' "$pdd_r_line_move" > "$pdd_move_tmp/migrate-r-line.sh"
    chmod 700 "$pdd_move_tmp/migrate-r-line.sh"
    pdd_move_code=0
    /bin/bash "$pdd_move_tmp/migrate-r-line.sh" --dry-run || pdd_move_code=$?
    case "$pdd_move_code" in
      2) exit 0 ;;
      0) ;;
      *) pdd_bootstrap_fail 'Old-build move refused; resolve the reported problem before setup.' ;;
    esac
    printf '%s ' 'Move off the old PDD build? [Y]'
    pdd_move_answer=
    IFS= read -r pdd_move_answer || pdd_bootstrap_fail 'Old-build move needs an explicit response before setup.'
    case "$pdd_move_answer" in ''|y|Y|yes|Yes|YES) ;; *) pdd_bootstrap_fail 'Old-build move declined; installation stopped.' ;; esac
    pdd_move_backup="$HOME/.pdd/migrate/$(date -u +%Y%m%dT%H%M%SZ)"
    if ! /bin/bash "$pdd_move_tmp/migrate-r-line.sh" --apply --backup-dir "$pdd_move_backup"; then
      printf '%s\n' "Old-build move failed. Log: $pdd_move_backup/log.txt" >&2
      exit 1
    fi
  ) || exit 1
fi
# End R-line migration.
if [ -e "$HOME/.pdd/current" ] || [ -L "$HOME/.pdd/current" ] || [ -e "$HOME/.pdd/install/record.json" ]; then
  if [ -x "$HOME/.pdd/launcher/pdd-launch" ]; then
    printf '%s\n' 'This installer did not install a new release. The existing PDD runtime is retained.' 'Continue with pdd setup to check that existing installation.'
    if [ -x "$HOME/.pdd/launcher/support/node" ]; then
      "$HOME/.pdd/launcher/support/node" --input-type=module -e "$pdd_npm_cleanup" || pdd_bootstrap_fail 'legacy_npm_cleanup_failed: Remove the identified old global npm pdd, then rerun pdd setup.'
    fi
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
pdd_stage=$(
  CDPATH= cd -P "$HOME" || pdd_bootstrap_fail 'Owned install home cannot be opened.'
  pdd_directory="$HOME"
  pdd_enter_private .pdd repair
  pdd_enter_private update
  pdd_enter_private staging
  pdd_name=$(mktemp -d ./bootstrap-XXXXXXXX) || pdd_bootstrap_fail 'Cannot stage this install.'
  printf '%s/%s\n' "$pdd_directory" "${pdd_name#./}"
) || pdd_bootstrap_fail 'Cannot stage this install.'
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
(
  CDPATH= cd -P "$pdd_stage" || pdd_bootstrap_fail 'Verified staging directory cannot be opened.'
  pdd_directory="$pdd_stage"
  [ "$(pwd -P)" = "$pdd_directory" ] && [ "$pdd_directory" -ef . ] && [ -O . ] || pdd_bootstrap_fail 'Verified staging directory changed.'
  mkdir node alpha || pdd_bootstrap_fail 'Fresh extraction directories cannot be created.'
  tar -xzf ./node.tar.gz -C ./node --strip-components=1 "$pdd_node_member" || pdd_bootstrap_fail 'Runtime extraction failed.'
  tar -xzf ./alpha.tar.gz -C ./alpha --strip-components=1 || pdd_bootstrap_fail 'Alpha extraction failed.'
  for pdd_tree in node alpha; do
    (pdd_enter_private "$pdd_tree" repair; pdd_normalize_fresh_tree) || exit 1
  done
  # Begin signed release custody: entered directories remain the write authority.
  if [ -n "$pdd_trust_descriptor" ]; then
    (
      pdd_enter_private alpha
      [ ! -e trust ] && [ ! -L trust ] || pdd_bootstrap_fail 'Release custody path already exists.'
      pdd_enter_private trust
      set -C
      printf '%s' "$pdd_trust_descriptor" | openssl base64 -d -A > ./descriptor.json || pdd_bootstrap_fail 'Signed release bytes cannot be retained.'
      printf '%s\n' "$pdd_trust_signature" > ./descriptor.sig || pdd_bootstrap_fail 'Release signature cannot be retained.'
      printf '%s' "$pdd_trust_root" | openssl base64 -d -A > ./release-root.json || pdd_bootstrap_fail 'Public release root cannot be retained.'
      [ "$(pwd -P)" = "$pdd_directory" ] && [ "$pdd_directory" -ef . ] && [ -O . ] || pdd_bootstrap_fail 'Release custody directory changed.'
    ) || exit 1
  fi
  # End signed release custody.
  # Publication moves alpha into versions/. Keep the executing module/native
  # closure at its own stable path until activation and support setup finish.
  cp -R -P ./alpha ./bootstrap || pdd_bootstrap_fail 'Bootstrap support cannot be staged.'
  (pdd_enter_private bootstrap repair; pdd_normalize_fresh_tree) || exit 1
) || exit 1
pdd_probe=$("$pdd_stage/node/bin/node" -p 'process.versions.node+"|"+process.platform+"|"+process.arch') || pdd_bootstrap_fail 'Verified runtime cannot execute.'
[ "$pdd_probe" = "$pdd_version|$pdd_os|$pdd_arch" ] || pdd_bootstrap_fail 'Runtime identity mismatch.'
printf '%s' "$pdd_descriptor" > "$pdd_stage/release.json"
printf '%s\n' 'Runtime ready. Continue with pdd setup'
exec "$pdd_stage/node/bin/node" "$pdd_stage/bootstrap/launcher/bootstrap-entry.mjs" "$HOME" "$pdd_stage" "$@"
