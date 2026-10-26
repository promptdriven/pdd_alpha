#!/bin/bash
# migrate-r-line.sh   (release path: launcher/migrate-r-line.sh)
#
# Moves a user off the old Pocket / pdd-workflow install (the "R line"), so
# the new PDD (@promptdriven/pdd Alpha + the Fleet client) can install cleanly.
# macOS and Linux. Bash 3.2 compatible (stock macOS /bin/bash).
#
# It ports backup_older_installation() from promptdriven/pdd-workflow
# scripts/pocket-bootstrap.sh (lines 308-431, main a31120a88), with fixes:
#   - "PDD Session Links" is an app in ~/pocket, not a LaunchAgent.
#   - the fish PATH is its own file, conf.d/pocket.fish.
#   - only ~/.local/bin entries that point into ~/pocket are removed.
#   - LaunchAgents are found in gui/<uid> and user/<uid>; Linux uses the
#     systemd user units of the old bootstrap.
#
# Installer contract (Oct 26 2026):
#   migrate-r-line.sh [--dry-run] [--backup-dir DIR]
#       stdout: one line per planned action. stderr: notes. Changes nothing.
#       Exit 0 = something to do. Exit 2 = nothing to do (no old R line).
#       Exit 1 = a real run would fail now (the last stderr line says why).
#   migrate-r-line.sh --apply [--backup-dir DIR]
#       DIR (default ~/.pdd/migrate/<UTC time>/) gets the backup and DIR/log.txt.
#       Exit 0 = done, or nothing to do. Exit 1 = failed or partly done: the
#       summary on stdout says what was done and how to undo it, and the last
#       stderr line is the log path.
#   migrate-r-line.sh --undo DIR
#       Restores from DIR, and from any earlier unfinished run that DIR continued.
#       Exit 0 = done. Exit 1 = failed or partly done (last stderr line = log path).
#
# --apply and --undo refuse when the user name matches PDD_MOVE_REFUSE_USER
# (default "serhanasad"; set it to an empty value to allow every user).
# Never touched: Herdr panes and sessions, ~/.codex, the user's own codex and
# claude. It never prints tokens or auth files.

# Messages show "~/..." on purpose (SC2088), and the old PATH lines are
# literal text (SC2016).
# shellcheck disable=SC2088,SC2016

if [ -z "${BASH_VERSION:-}" ]; then
  echo "Run this script with bash, for example: bash $0 --dry-run" >&2
  exit 1
fi

# Use the system tools, not GNU tools from Homebrew. Keep the caller PATH
# only to find out which commands the user can still run after the move.
USER_PATH=${PATH:-}
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH

VERSION=0.2-20261026
SCRIPT_NAME=migrate-r-line.sh
case "$0" in
  */migrate-r-line.sh|migrate-r-line.sh)
    case "$0" in /*) SELF="$0" ;; *) SELF="$(pwd)/$0" ;; esac ;;
  *) SELF=$SCRIPT_NAME ;;
esac
OS=$(uname -s)
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
KNOWN_LABELS="ai.promptdriven.pocket.gateway ai.promptdriven.pocket.team-access ai.promptdriven.pdw.session-links"
KNOWN_UNITS="pocket-team-access.timer pocket-team-access.service pocket-gateway.service"
REFUSE_USERS=${PDD_MOVE_REFUSE_USER-serhanasad}

TAB=$(printf '\t')
NL='
'

# The exact lines that the old installer added (all versions of pocket-bootstrap.sh).
SH_OLD1='export PATH="$HOME/.local/bin:$HOME/pocket/bin:$PATH"'
SH_OLD2='export PATH="$HOME/pocket/terminal/bin:$HOME/.local/bin:$HOME/pocket/bin:$PATH"'
SH_NEW='export PATH="$HOME/.local/bin:$PATH"'
FISH_OLD1='fish_add_path --path --move "$HOME/.local/bin" "$HOME/pocket/bin"'
FISH_OLD2='fish_add_path --path "$HOME/.local/bin" "$HOME/pocket/bin"'
FISH_LOCAL1='fish_add_path --path --move "$HOME/.local/bin"'
FISH_NEW='fish_add_path --path "$HOME/.local/bin"'

MODE=dry
UNDO_DIR=
BACKUP_ARG=
LOG=
MANIFEST=
BACKUP=
RESUME=no
TS=$(date +%Y%m%d-%H%M%S)
CHANGED=0
PLANNED=0
DONE_LIST=
FAIL_LIST=
NOTE_LIST=
LOCK=
WOULD_REFUSE=

usage() {
  cat <<EOF
$SCRIPT_NAME $VERSION

Moves this user off the old Pocket install (~/pocket, the "R line"), so the
new PDD can install cleanly. It keeps a full backup and it can undo the move.

  bash $SCRIPT_NAME [--dry-run] [--backup-dir DIR]   Show each action. Change nothing.
  bash $SCRIPT_NAME --apply [--backup-dir DIR]        Do the move. DIR gets the backup
                                                       and log.txt (default
                                                       ~/.pdd/migrate/<UTC time>/).
  bash $SCRIPT_NAME --undo DIR                        Restore from DIR.

--dry-run: exit 0 = something to do, 2 = nothing to do, 1 = a real run would fail.
--apply, --undo: exit 0 = done, 1 = failed or partly done (last stderr line = log).
EOF
}

# ---------------------------------------------------------------- output

is_mac() { [ "$OS" = Darwin ]; }

log_line() { if [ -n "$LOG" ]; then printf '%s\n' "$*" >> "$LOG"; fi; }
# Human text: stderr in a dry run (stdout holds only the plan), stdout otherwise.
say() {
  if [ "$MODE" = dry ]; then printf '%s\n' "$*" >&2; else printf '%s\n' "$*"; fi
  log_line "$*"
}
step() { say ""; say "== $*"; }
info() { say "  $*"; }
# One planned action: one line on stdout in a dry run.
plan() {
  PLANNED=$((PLANNED + 1))
  if [ "$MODE" = dry ]; then printf '%s\n' "$*"; else say "  Do: $*"; fi
}
ok() { say "  Done: $*"; DONE_LIST="$DONE_LIST$*$NL"; CHANGED=1; }
fail_item() { say "  NOT DONE: $*"; FAIL_LIST="$FAIL_LIST$*$NL"; }
note() { say "  Note: $*"; NOTE_LIST="$NOTE_LIST$*$NL"; }

cleanup_lock() {
  if [ -n "$LOCK" ] && [ -d "$LOCK" ]; then rmdir "$LOCK" 2>/dev/null; fi
}

# Exit 1 for --apply / --undo. The last stderr line is the log path.
fail_out() {
  cleanup_lock
  log_line "RESULT: failed: $*"
  printf '%s: %s\n' "$SCRIPT_NAME" "$*" >&2
  if [ -n "$LOG" ] && [ -f "$LOG" ]; then printf '%s\n' "$LOG" >&2
  else printf 'log: none (nothing was written)\n' >&2; fi
  exit 1
}

# Refuse is for checks before the first change.
refuse() {
  say ""
  say "REFUSED: $*"
  if [ "$MODE" = dry ]; then
    printf '%s: a real run would refuse: %s\n' "$SCRIPT_NAME" "$*" >&2
    exit 1
  fi
  if [ "$CHANGED" = 1 ]; then say "Some steps were already done. See the list above."
  else say "Nothing was changed."; fi
  fail_out "refused: $*"
}

manifest() {
  local IFS="$TAB"
  if [ -n "$MANIFEST" ]; then printf '%s\n' "$*" >> "$MANIFEST"; fi
}

short() { # Show a path with ~ for the home folder.
  case "$1" in
    "$HOME") printf '~\n' ;;
    "$HOME/"*) printf '~/%s\n' "${1#"$HOME"/}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

list_lines() { # Print a newline list with a prefix.
  local item
  while IFS= read -r item; do
    if [ -n "$item" ]; then say "$1$item"; fi
  done <<EOF
$2
EOF
}

# shellcheck disable=SC2329  # called by trap
on_signal() {
  say ""
  say "STOPPED by a signal. The run is partly done."
  if [ -n "$BACKUP" ]; then say "To undo: bash $SELF --undo $BACKUP"; fi
  fail_out "stopped by a signal; partly done"
}

# ---------------------------------------------------------------- portable helpers

norm_path() { # Remove ".", ".." and double slashes. No file system access.
  local p=$1 out='' part
  local IFS=/
  set -f
  for part in $p; do
    case "$part" in
      ''|.) ;;
      ..) out=${out%/*} ;;
      *) out="$out/$part" ;;
    esac
  done
  set +f
  if [ -z "$out" ]; then out=/; fi
  printf '%s\n' "$out"
}

link_abs_target() { # One hop. Absolute, normalized.
  local t
  t=$(readlink "$1") || return 1
  case "$t" in
    /*) ;;
    *) t="$(dirname "$1")/$t" ;;
  esac
  norm_path "$t"
}

resolve_full() { # Follow links (max 20 hops).
  local p n=0 t
  p=$(norm_path "$1")
  while [ -L "$p" ] && [ "$n" -lt 20 ]; do
    t=$(link_abs_target "$p") || return 1
    p=$t
    n=$((n + 1))
  done
  printf '%s\n' "$p"
}

in_pocket() {
  case "$1" in
    "$POCKET"|"$POCKET/"*) return 0 ;;
  esac
  return 1
}

# Last guard: these paths are never changed.
assert_safe_target() {
  case "$1" in
    "$HOME/.codex"|"$HOME/.codex/"*|"$HOME/.claude"|"$HOME/.claude/"*|"$HOME/.claude.json"|\
    "$HOME/.local/share/claude"|"$HOME/.local/share/claude/"*|"$HOME/.local/bin/claude"|\
    "$HOME/.config/herdr"|"$HOME/.config/herdr/"*|"$HOME/.local/share/herdr"|"$HOME/.local/share/herdr/"*|\
    "$HOME/.local/state/herdr"|"$HOME/.local/state/herdr/"*|"$HOME/.herdr"|"$HOME/.herdr/"*)
      say "INTERNAL ERROR: the script tried to change $1. It stopped."
      fail_out "internal error: refused to change $1" ;;
  esac
}

exists_any() { [ -e "$1" ] || [ -L "$1" ]; }

sha_of() {
  if command -v shasum > /dev/null 2>&1; then shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'
  else sha256sum "$1" 2>/dev/null | awk '{print $1}'; fi
}

file_size() { wc -c < "$1" 2>/dev/null | tr -d ' '; }

dev_of() { if is_mac; then stat -f %d "$1" 2>/dev/null; else stat -c %d "$1" 2>/dev/null; fi; }

nearest_existing() { # path -> the path itself or its nearest existing parent
  local p
  p=$(norm_path "$1")
  while [ "$p" != / ] && ! [ -e "$p" ]; do p=$(dirname "$p"); done
  printf '%s\n' "$p"
}

reverse_lines() { awk '{ l[NR] = $0 } END { for (i = NR; i > 0; i--) print l[i] }' "$1"; }

# Move a path into the backup at the same HOME-relative place.
# Write the intent to the manifest first, so a stop in the middle can be undone.
move_to_backup() { # kind src extra...
  local kind=$1 src=$2 rel dest
  shift 2
  assert_safe_target "$src"
  case "$src" in "$HOME/"*) ;; *) return 1 ;; esac
  rel=${src#"$HOME"/}
  dest="$BACKUP/home/$rel"
  if exists_any "$dest"; then return 1; fi
  mkdir -p "$(dirname "$dest")" || return 1
  manifest "$kind" "$rel" "$@"
  mv "$src" "$dest"
}

# ---------------------------------------------------------------- processes

ps_all() {
  if is_mac; then ps -axww -o pid=,uid=,command= 2>/dev/null
  else ps -e -ww -o pid=,uid=,args= 2>/dev/null; fi
}

proc_lstart() { # Local start time, the same form the old gateway saved.
  env -u TZ LC_ALL=C ps -o lstart= -p "$1" 2>/dev/null | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

proc_lstart_canon() { # ps-lstart-utc-v1:<ms>, the newer form.
  local s e
  s=$(LC_ALL=C TZ=UTC0 ps -o lstart= -p "$1" 2>/dev/null | tr -s ' ' | sed 's/^ //; s/ $//')
  if [ -z "$s" ]; then return 1; fi
  if is_mac; then e=$(LC_ALL=C TZ=UTC0 date -j -f '%a %b %d %T %Y' "$s" +%s 2>/dev/null) || return 1
  else e=$(LC_ALL=C date -u -d "$s" +%s 2>/dev/null) || return 1; fi
  printf 'ps-lstart-utc-v1:%s000\n' "$e"
}

proc_uid() { ps -o uid= -p "$1" 2>/dev/null | tr -d ' '; }

proc_cmd() { ps -ww -o command= -p "$1" 2>/dev/null; }

# The environment of a process, one entry per line. It is only counted, never
# printed: it can hold secrets. macOS hides the environment of Apple platform
# binaries (/bin/*); codex is not one, so its CODEX_HOME is visible.
proc_env_lines() {
  if is_mac; then ps -E -ww -o command= -p "$1" 2>/dev/null | tr ' ' '\n'
  else tr '\0' '\n' < "/proc/$1/environ" 2>/dev/null; fi
}

proc_env_has() { # pid KEY=VALUE -> 0 on an exact match
  local n
  n=$(proc_env_lines "$1" | grep -c -x -F -- "$2")
  [ "${n:-0}" -gt 0 ]
}

proc_env_any_codex_home() {
  local n
  n=$(proc_env_lines "$1" | grep -c '^CODEX_HOME=')
  [ "${n:-0}" -gt 0 ]
}

# 0 when a pdd-v1 wrapper runs a program inside ~/pocket: an "exec" line or
# the old "for legacy_app in" line names ~/pocket. Prints nothing.
pdd_v1_runs_pocket() {
  local n
  n=$(grep -E '^[[:space:]]*(exec|for legacy_app in)[[:space:]]' "$1" 2>/dev/null \
    | grep -c -F -e "$POCKET/" -e "$POCKET'" -e "$POCKET\"")
  [ "${n:-0}" -gt 0 ]
}

stop_pid() { # pid lstart -> 0 when the process is gone
  local pid=$1 start=$2 n
  if [ "$(proc_lstart "$pid")" != "$start" ]; then return 0; fi
  kill -TERM "$pid" 2>/dev/null
  n=0
  while [ "$n" -lt 50 ]; do
    if [ "$(proc_lstart "$pid")" != "$start" ]; then return 0; fi
    sleep 0.2
    n=$((n + 1))
  done
  if [ "$(proc_lstart "$pid")" != "$start" ]; then return 0; fi
  kill -KILL "$pid" 2>/dev/null
  n=0
  while [ "$n" -lt 15 ]; do
    if [ "$(proc_lstart "$pid")" != "$start" ]; then return 0; fi
    sleep 0.2
    n=$((n + 1))
  done
  return 1
}

run_timeout() { # seconds outfile command...
  local secs=$1 out=$2 pid n=0
  shift 2
  "$@" > "$out" 2> "$out.err" < /dev/null &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$n" -ge $((secs * 5)) ]; then
      kill -TERM "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      return 124
    fi
    sleep 0.2
    n=$((n + 1))
  done
  wait "$pid"
}

# ---------------------------------------------------------------- launchd (macOS)

# launchd has two domains for a user: gui/<uid> (desktop login) and
# user/<uid> (any login, for example SSH). A job can be loaded in either.
LA_DOMAINS=
la_init_domains() {
  local dom
  LA_DOMAINS=
  for dom in "gui/$UID_NUM" "user/$UID_NUM"; do
    if launchctl print "$dom" > /dev/null 2>&1; then LA_DOMAINS="$LA_DOMAINS $dom"; fi
  done
  LA_DOMAINS=${LA_DOMAINS# }
}

la_state_in() { # domain label -> loaded | absent | unknown
  LC_ALL=C launchctl print "$1/$2" > /dev/null 2>&1
  case $? in
    0) echo loaded ;;
    113) echo absent ;;
    *) echo unknown ;;
  esac
}

la_where() { # label -> "loaded:<domain> [<domain>]" | absent | unknown
  local dom st where='' bad=no
  if [ -z "$LA_DOMAINS" ]; then echo unknown; return; fi
  for dom in $LA_DOMAINS; do
    st=$(la_state_in "$dom" "$1")
    case "$st" in
      loaded) where="$where $dom" ;;
      absent) ;;
      *) bad=yes ;;
    esac
  done
  if [ -n "$where" ]; then echo "loaded:${where# }"
  elif [ "$bad" = yes ]; then echo unknown
  else echo absent; fi
}

la_bootout() { # label "domain [domain]" -> 0 when the job is gone from each domain
  local label=$1 dom n
  for dom in $2; do
    launchctl bootout "$dom/$label" > /dev/null 2>&1
    n=0
    while [ "$(la_state_in "$dom" "$label")" != absent ] && [ "$n" -lt 25 ]; do sleep 0.2; n=$((n + 1)); done
    if [ "$(la_state_in "$dom" "$label")" != absent ]; then return 1; fi
  done
  return 0
}

la_mentions_pocket() { # domain label -> 0 when launchd shows a path in ~/pocket. Prints nothing.
  local n
  n=$(LC_ALL=C launchctl print "$1/$2" 2>/dev/null | grep -c -F -- "$POCKET/")
  [ "${n:-0}" -gt 0 ]
}

# The job runs from ~/pocket when Program, ProgramArguments.0 (the program) or
# ProgramArguments.1 (the script it runs) is in ~/pocket. A later argument
# alone (for example a log path) does not count.
plist_points_into_pocket() {
  local f=$1 v n i
  if v=$(plutil -extract Program raw -o - "$f" 2>/dev/null); then
    case "$v" in /*) if in_pocket "$(norm_path "$v")"; then return 0; fi ;; esac
  fi
  n=$(plutil -extract ProgramArguments raw -o - "$f" 2>/dev/null) || return 1
  case "$n" in ''|*[!0-9]*) return 1 ;; esac
  i=0
  while [ "$i" -lt "$n" ] && [ "$i" -lt 2 ]; do
    if v=$(plutil -extract "ProgramArguments.$i" raw -o - "$f" 2>/dev/null); then
      case "$v" in /*) if in_pocket "$(norm_path "$v")"; then return 0; fi ;; esac
    fi
    i=$((i + 1))
  done
  return 1
}

plist_mentions_pocket() { # file -> 0 when any value names ~/pocket. Prints nothing.
  local n
  n=$(plutil -convert xml1 -o - "$1" 2>/dev/null | grep -c -F -- "$POCKET/")
  [ "${n:-0}" -gt 0 ]
}

write_login_items_script() { # file
  cat > "$1" <<'OSA'
on run argv
  set mode to item 1 of argv
  set target to item 2 of argv
  set targetSlash to target & "/"
  tell application "System Events"
    if mode is "delete" then
      delete (every login item whose path is target)
      delete (every login item whose path is targetSlash)
    else if mode is "add" then
      make login item at end with properties {path:target, hidden:false}
    end if
    set n to (count of (every login item whose path is target)) + (count of (every login item whose path is targetSlash))
  end tell
  return n as text
end run
OSA
}

login_items() { # mode path -> prints the count; returns non-zero on error
  local script="$BACKUP/login-items.applescript" out="$BACKUP/login-items.out" rc
  write_login_items_script "$script" || return 1
  run_timeout 20 "$out" osascript "$script" "$1" "$2"
  rc=$?
  if [ "$rc" != 0 ]; then return "$rc"; fi
  tr -d ' \n' < "$out"
}

# ---------------------------------------------------------------- systemd (Linux)

SD_OK=no
sd() {
  env XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$UID_NUM}" \
    DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR:-/run/user/$UID_NUM}/bus}" \
    systemctl --user "$@"
}

sd_paths() { # unit -> HOME-relative paths of its files that exist
  local r
  for r in ".config/systemd/user/$1" ".config/systemd/user/$1.d" \
    ".config/systemd/user/default.target.wants/$1" ".config/systemd/user/timers.target.wants/$1"; do
    if exists_any "$HOME/$r"; then printf '%s\n' "$r"; fi
  done
}

sd_active() { # unit -> ActiveState, or "unknown"
  local s
  if [ "$SD_OK" != yes ]; then echo unknown; return; fi
  s=$(sd show "$1" --property=ActiveState --value 2>/dev/null)
  printf '%s\n' "${s:-unknown}"
}

# ---------------------------------------------------------------- setup

parse_args() {
  local modes=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) MODE=dry; modes=$((modes + 1)) ;;
      --apply) MODE=apply; modes=$((modes + 1)) ;;
      --undo)
        MODE=undo; modes=$((modes + 1))
        if [ $# -lt 2 ] || [ -z "$2" ]; then usage >&2; exit 1; fi
        UNDO_DIR=$2
        shift ;;
      --backup-dir)
        if [ $# -lt 2 ] || [ -z "$2" ]; then usage >&2; exit 1; fi
        BACKUP_ARG=$2
        shift ;;
      -h|--help) usage; exit 0 ;;
      *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
    esac
    shift
  done
  if [ "$modes" -gt 1 ]; then
    echo "Use only one of --dry-run, --apply, --undo." >&2
    exit 1
  fi
}

preflight() {
  UID_NUM=$(id -u)
  USER_NAME=$(id -un)
  case "$OS" in
    Darwin|Linux) ;;
    *) refuse "This script is for macOS and Linux only." ;;
  esac
  if [ "$UID_NUM" = 0 ]; then refuse "Do not run this script as root or with sudo. Run it as the user."; fi
  case "${HOME:-}" in
    /*) ;;
    *) refuse "HOME is not set to a full path." ;;
  esac
  if [ "$HOME" = / ]; then refuse "HOME is /. Run this script as a normal user."; fi
  HOME=$(norm_path "$HOME")
  local real_home=
  if is_mac; then
    real_home=$(dscl . -read "/Users/$USER_NAME" NFSHomeDirectory 2>/dev/null | awk '{print $2}')
  elif command -v getent > /dev/null 2>&1; then
    real_home=$(getent passwd "$USER_NAME" | cut -d: -f6)
  fi
  if [ -n "$real_home" ] && [ "$(norm_path "$real_home")" != "$HOME" ]; then
    refuse "HOME ($HOME) is not the home folder of $USER_NAME ($real_home)."
  fi

  if [ -n "$BACKUP_ARG" ]; then
    case "$BACKUP_ARG" in /*) ;; *) BACKUP_ARG="$(pwd)/$BACKUP_ARG" ;; esac
    BACKUP_ARG=$(norm_path "$BACKUP_ARG")
  fi
  POCKET="$HOME/pocket"
  LBIN="$HOME/.local/bin"
  LA="$HOME/Library/LaunchAgents"
  FISH_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/fish"
  CODEX_WANT="$POCKET/codex/default"
  APP_BUNDLE="$POCKET/PDD Session Links.app"
  REGISTRY="$POCKET/state/registry.json"
}

user_is_refused() {
  local u
  for u in $REFUSE_USERS; do
    if [ "$USER_NAME" = "$u" ] || [ "${USER:-}" = "$u" ]; then return 0; fi
  done
  return 1
}

# --apply: make the backup folder first, so every result has a log.
setup_backup_dir() {
  local d=$BACKUP_ARG
  if [ -z "$d" ]; then d="$HOME/.pdd/migrate/$(date -u +%Y%m%dT%H%M%SZ)"; fi
  case "$d" in /*) ;; *) d="$(pwd)/$d" ;; esac
  d=$(norm_path "$d")
  case "$d" in
    /|"$HOME"|"$POCKET"|"$POCKET/"*|"$HOME/.codex"|"$HOME/.codex/"*) fail_out "refused: the backup folder cannot be $d" ;;
  esac
  if [ -L "$d" ] || { exists_any "$d" && [ ! -d "$d" ]; }; then fail_out "refused: the backup folder $d is not a real folder"; fi
  if [ -d "$d" ]; then
    if [ ! -O "$d" ]; then fail_out "refused: the backup folder $d belongs to another user"; fi
    if [ -f "$d/MANIFEST.tsv" ] && [ -f "$d/.in-progress" ]; then
      RESUME=yes
    else
      case "$(ls -A "$d" 2>/dev/null)" in
        ''|log.txt) ;;
        *) fail_out "refused: the backup folder $d is not empty" ;;
      esac
    fi
  else
    mkdir -p "$d" || fail_out "could not make the backup folder $d"
  fi
  chmod 700 "$d" 2>/dev/null
  BACKUP=$d
  LOG="$d/log.txt"
  MANIFEST="$d/MANIFEST.tsv"
  log_line "---- $SCRIPT_NAME $VERSION --apply $(date -u +%Y-%m-%dT%H:%M:%SZ) user=$USER_NAME os=$OS"
}

take_lock() {
  LOCK="$HOME/.pdd-migrate-r-line.lock"
  if ! mkdir "$LOCK" 2>/dev/null; then
    LOCK=
    refuse "Another run is active. If no other run is active, remove $HOME/.pdd-migrate-r-line.lock and try again."
  fi
  trap 'cleanup_lock' EXIT
  trap 'on_signal' INT TERM HUP
}

check_real_dirs() {
  if [ -L "$POCKET" ]; then refuse "~/pocket is a link, not a real folder. Check it by hand."; fi
  if exists_any "$POCKET" && [ ! -d "$POCKET" ]; then refuse "~/pocket is not a folder. Check it by hand."; fi
  local d
  for d in "$HOME/.local" "$LBIN" "$HOME/Library" "$LA" "$HOME/.config/systemd" "$HOME/.config/systemd/user"; do
    if [ -L "$d" ] || { [ -e "$d" ] && [ ! -d "$d" ]; }; then
      refuse "$(short "$d") is not a real folder."
    fi
  done
}

# ---------------------------------------------------------------- discovery (read only)

discover_launchd() {
  local f label where loaded seen_nop=" "
  la_init_domains
  local plist_labels=" "
  for f in "$LA"/*.plist; do
    if ! exists_any "$f"; then continue; fi
    label=$(plutil -extract Label raw -o - "$f" 2>/dev/null) || label=
    if [ -z "$label" ]; then continue; fi
    if plist_points_into_pocket "$f"; then
      T_PLISTS="$T_PLISTS$label$TAB$f$NL"
      plist_labels="$plist_labels$label "
    elif plist_mentions_pocket "$f"; then
      T_MENTION="$T_MENTION$label ($(short "$f"))$NL"
    fi
  done
  # Loaded jobs with no file that still run from ~/pocket.
  if [ -n "$LA_DOMAINS" ]; then
    loaded=$(launchctl list 2>/dev/null | awk 'NR > 1 {print $3}' | grep -E '^ai\.promptdriven\.' || true)
    for label in $KNOWN_LABELS $loaded; do
      case "$plist_labels" in *" $label "*) continue ;; esac
      case "$seen_nop" in *" $label "*) continue ;; esac
      seen_nop="$seen_nop$label "
      where=$(la_where "$label")
      case "$where" in
        loaded:*)
          where=${where#loaded:}
          if la_mentions_pocket "${where%% *}" "$label"; then T_NOPLIST="$T_NOPLIST$label$TAB$where$NL"; fi ;;
      esac
    done
  fi
}

discover_systemd() {
  local u f seen=" " paths active cand
  SD_OK=no
  if command -v systemctl > /dev/null 2>&1 && sd show-environment > /dev/null 2>&1; then SD_OK=yes; fi
  cand=$KNOWN_UNITS
  for f in "$HOME/.config/systemd/user"/*.service; do
    if [ ! -f "$f" ]; then continue; fi
    if grep -E '^[[:space:]]*ExecStart[[:space:]]*=' "$f" 2>/dev/null | grep -q -F -- "$POCKET/"; then
      u=${f##*/}
      cand="$cand ${u%.service}.timer $u"
    fi
  done
  for u in $cand; do
    case "$seen" in *" $u "*) continue ;; esac
    seen="$seen$u "
    paths=$(sd_paths "$u")
    active=$(sd_active "$u")
    if [ -n "$paths" ] || { [ "$active" != unknown ] && [ "$active" != inactive ]; }; then
      T_UNITS="$T_UNITS$u$TAB$active$NL"
    fi
  done
}

discover() {
  local pid uid cmd start name tgt e n
  T_PLISTS=
  T_MENTION=
  T_NOPLIST=
  T_UNITS=
  if is_mac; then discover_launchd; else discover_systemd; fi

  # One ps snapshot. It is parsed, never printed.
  PS_SNAP=$(ps_all)

  T_GATEWAY=
  T_APP=
  T_APPSRV=
  local appsrv_pids=" "
  T_OTHER_HOME=
  T_FROM_POCKET=
  OTHER_CODEX=0
  local exe rest script
  while read -r pid uid cmd <&3; do
    if [ "$uid" != "$UID_NUM" ]; then continue; fi
    exe=${cmd%% *}
    rest=${cmd#"$exe"}
    rest=${rest# }
    script=${rest%% *}
    # The old gateway: node <~/pocket/...>/src/host/gateway/main.mjs
    case "${exe##*/}:$script" in
      "node:$POCKET/"*"/src/host/gateway/main.mjs")
        start=$(proc_lstart "$pid")
        T_GATEWAY="$T_GATEWAY$pid$TAB$start$NL"
        continue ;;
    esac
    case "$cmd" in
      "$APP_BUNDLE/Contents/MacOS/"*)
        start=$(proc_lstart "$pid")
        T_APP="$T_APP$pid$TAB$start$NL"
        continue ;;
    esac
    # A Codex app-server: the program is codex*, and "app-server" is a word.
    case "${exe##*/}" in codex*) ;; *) continue ;; esac
    case " $cmd " in *" app-server "*) ;; *) continue ;; esac
    if proc_env_has "$pid" "CODEX_HOME=$CODEX_WANT" || proc_env_has "$pid" "CODEX_HOME=$CODEX_WANT/"; then
      start=$(proc_lstart "$pid")
      T_APPSRV="$T_APPSRV$pid$TAB$start${TAB}environment$TAB$exe$NL"
      appsrv_pids="$appsrv_pids$pid "
    fi
  done 3<<EOF
$PS_SNAP
EOF

  # Second proof: the old gateway registry (pid + start time + home).
  local jq_bin=
  REG_CONFIRMED=" "
  if [ -x /usr/bin/jq ]; then jq_bin=/usr/bin/jq; else jq_bin=$(PATH="$USER_PATH" command -v jq 2>/dev/null || true); fi
  if [ -n "$jq_bin" ] && [ -f "$REGISTRY" ] && [ ! -L "$REGISTRY" ]; then
    local rec_pid rec_start rec_home
    while IFS="$TAB" read -r rec_pid rec_start rec_home <&3; do
      case "$rec_pid" in ''|*[!0-9]*) continue ;; esac
      if [ "$rec_home" != "$CODEX_WANT" ]; then continue; fi
      if [ "$(proc_uid "$rec_pid")" != "$UID_NUM" ]; then continue; fi
      start=$(proc_lstart "$rec_pid")
      if [ -z "$start" ]; then continue; fi
      if [ "$rec_start" != "$start" ] && [ "$rec_start" != "$(proc_lstart_canon "$rec_pid")" ]; then continue; fi
      cmd=$(proc_cmd "$rec_pid")
      case " $cmd " in *" app-server "*) ;; *) continue ;; esac
      case "$appsrv_pids" in *" $rec_pid "*) REG_CONFIRMED="$REG_CONFIRMED$rec_pid "; continue ;; esac
      # If the environment names another Codex home, it is not ours.
      if proc_env_any_codex_home "$rec_pid" && ! proc_env_has "$rec_pid" "CODEX_HOME=$CODEX_WANT"; then continue; fi
      T_APPSRV="$T_APPSRV$rec_pid$TAB$start${TAB}registry$TAB${cmd%% *}$NL"
      appsrv_pids="$appsrv_pids$rec_pid "
    done 3<<EOF
$("$jq_bin" -r '(.appServers // {}) | to_entries[] | [(.value.pid|tostring), (.value.start // ""), (.value.codexHome // "")] | @tsv' "$REGISTRY" 2>/dev/null)
EOF
  fi

  # Other processes: count Codex ones, list ones that run from ~/pocket.
  while read -r pid uid cmd <&3; do
    if [ "$uid" != "$UID_NUM" ]; then continue; fi
    case "$appsrv_pids" in *" $pid "*) continue ;; esac
    case "$NL$T_GATEWAY$T_APP" in *"$NL$pid$TAB"*) continue ;; esac
    case "$cmd" in
      *codex*)
        OTHER_CODEX=$((OTHER_CODEX + 1))
        if proc_env_has "$pid" "CODEX_HOME=$CODEX_WANT"; then T_OTHER_HOME="$T_OTHER_HOME$pid$NL"; fi ;;
    esac
    case "$cmd" in
      "$POCKET/"*) e=${cmd%% *}; T_FROM_POCKET="$T_FROM_POCKET$pid (${e##*/})$NL" ;;
    esac
  done 3<<EOF
$PS_SNAP
EOF

  # ~/.local/bin entries. Never the user's own claude.
  T_LINKS=
  T_LBIN_MENTION=
  T_V1=
  V1_KEPT=no
  T_LBIN_KEPT=0
  CODEX_LINK_NOTE=
  OLD_CMD_FOUND=no
  if [ -d "$LBIN" ]; then
    for e in "$LBIN"/* "$LBIN"/.[!.]* "$LBIN"/..?*; do
      if ! exists_any "$e"; then continue; fi
      name=${e##*/}
      if [ "$name" = claude ]; then T_LBIN_KEPT=$((T_LBIN_KEPT + 1)); continue; fi
      if [ -L "$e" ]; then
        tgt=$(link_abs_target "$e") || tgt=
        if [ -n "$tgt" ] && in_pocket "$tgt"; then
          T_LINKS="$T_LINKS$name$TAB$(readlink "$e")$NL"
          case "$name" in pdd|pdw|pdd-v1) OLD_CMD_FOUND=yes ;; esac
          continue
        fi
        if [ "$name" = codex ]; then
          case "$tgt" in "$HOME/.local/share/codex/"*) CODEX_LINK_NOTE="$(short "$tgt")" ;; esac
        fi
      elif [ -f "$e" ]; then
        if [ "$name" = pdd-v1 ]; then
          if pdd_v1_runs_pocket "$e"; then
            T_V1="$T_V1$name$TAB$(sha_of "$e")$NL"
            OLD_CMD_FOUND=yes
            continue
          fi
          V1_KEPT=yes
        fi
        n=$(file_size "$e")
        if [ "${n:-0}" -lt 65536 ] && grep -q -F -- "$POCKET/" "$e" 2>/dev/null; then
          T_LBIN_MENTION="$T_LBIN_MENTION$name$NL"
        fi
      fi
      T_LBIN_KEPT=$((T_LBIN_KEPT + 1))
    done
  fi

  # Herdr. The user's PATH decides which herdr runs today. If that herdr
  # (or, with no herdr on PATH, the only one) lives in ~/pocket, copy it to
  # ~/.local/bin, so the running Herdr server keeps a matching CLI.
  HERDR_SRC=
  HERDR_COPY=no
  local dirs d hp first=
  dirs="$(printf '%s' "$USER_PATH" | tr ':' '\n')"
  while IFS= read -r d; do
    case "$d" in /*) ;; *) continue ;; esac
    d=$(norm_path "$d")
    if [ -x "$d/herdr" ] && [ ! -d "$d/herdr" ]; then
      first=$(resolve_full "$d/herdr") || first=
      break
    fi
  done <<EOF
$dirs
EOF
  if [ -z "$first" ] && exists_any "$POCKET/bin/herdr"; then
    first=$(resolve_full "$POCKET/bin/herdr") || first=
  fi
  if [ -n "$first" ] && in_pocket "$first" && [ -f "$first" ]; then
    HERDR_SRC=$first
    if ! exists_any "$LBIN/herdr"; then
      HERDR_COPY=yes
    else
      case "$NL$T_LINKS" in *"${NL}herdr$TAB"*) HERDR_COPY=yes ;; esac
    fi
  fi
  HERDR_SERVER_IN_POCKET=no
  while read -r pid uid cmd <&3; do
    if [ "$uid" != "$UID_NUM" ]; then continue; fi
    case "$cmd" in "$POCKET/"*herdr*) HERDR_SERVER_IN_POCKET=yes ;; esac
  done 3<<EOF
$PS_SNAP
EOF

  # Tools that the user finds only in ~/pocket today.
  T_ONLY_IN_POCKET=
  local t found
  for t in gh node npm codex; do
    if ! exists_any "$POCKET/bin/$t"; then continue; fi
    found=no
    while IFS= read -r d; do
      case "$d" in /*) ;; *) continue ;; esac
      d=$(norm_path "$d")
      if in_pocket "$d"; then continue; fi
      if [ -x "$d/$t" ] && [ ! -d "$d/$t" ]; then
        hp=$(resolve_full "$d/$t") || hp=
        if [ -n "$hp" ] && ! in_pocket "$hp"; then found=yes; break; fi
      fi
    done <<EOF
$dirs$NL$LBIN$NL/opt/homebrew/bin$NL/usr/local/bin
EOF
    if [ "$found" = no ]; then T_ONLY_IN_POCKET="$T_ONLY_IN_POCKET $t"; fi
  done

  # fish: the conf.d file.
  T_FISH=
  FISH_MODE=
  local fishfile
  for fishfile in "$FISH_DIR/conf.d/pocket.fish" "$HOME/.config/fish/conf.d/pocket.fish"; do
    if exists_any "$fishfile"; then T_FISH=$fishfile; break; fi
  done
  FISH_TWIN=no
  if [ -n "$T_FISH" ]; then
    if [ -L "$T_FISH" ]; then
      FISH_MODE=move
    else
      n=$(grep -c -v -x -F -e "$FISH_OLD1" -e "$FISH_OLD2" -e "$FISH_LOCAL1" -e "$FISH_NEW" -e '' "$T_FISH" 2>/dev/null)
      if [ "${n:-0}" = 0 ]; then FISH_MODE=move; else FISH_MODE=edit; fi
    fi
    if [ "$FISH_MODE" = move ] && [ -d "$LBIN" ]; then
      FISH_TWIN=yes
      local other
      for other in "$FISH_DIR/config.fish" "$FISH_DIR"/conf.d/*.fish "$FISH_DIR/fish_variables"; do
        if [ "$other" = "$T_FISH" ] || [ ! -f "$other" ]; then continue; fi
        if grep -q -F -e '.local/bin' "$other" 2>/dev/null; then FISH_TWIN=no; break; fi
      done
      if exists_any "$FISH_DIR/conf.d/pdd-local-bin.fish"; then FISH_TWIN=no; fi
    fi
  fi

  # zsh, bash and fish profile files: the exact old PATH lines.
  T_PROFILES=
  T_PROFILE_MENTION=
  local zdot="${ZDOTDIR:-$HOME}" seen=" " p kind lines other_lines ln keep
  for p in "$zdot/.zshrc" "$zdot/.zprofile" "$HOME/.zshrc" "$HOME/.zprofile" \
    "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile" "$FISH_DIR/config.fish"; do
    p=$(norm_path "$p")
    case "$seen" in *" $p "*) continue ;; esac
    seen="$seen$p "
    if [ ! -f "$p" ]; then continue; fi
    case "$p" in
      *.fish) kind=fish
        lines=$(grep -n -x -F -e "$FISH_OLD1" -e "$FISH_OLD2" "$p" 2>/dev/null | cut -d: -f1 | tr '\n' ' ') ;;
      *) kind='sh'
        lines=$(grep -n -x -F -e "$SH_OLD1" -e "$SH_OLD2" "$p" 2>/dev/null | cut -d: -f1 | tr '\n' ' ') ;;
    esac
    lines=${lines% }
    if [ -n "$lines" ]; then T_PROFILES="$T_PROFILES$p$TAB$kind$TAB$lines$NL"; fi
    # Other lines that name the old folder: report line numbers only.
    other_lines=$(grep -n -F -e "$POCKET" -e '$HOME/pocket' -e '~/pocket' "$p" 2>/dev/null | cut -d: -f1 | tr '\n' ' ')
    keep=
    for ln in $other_lines; do
      case " $lines " in *" $ln "*) ;; *) keep="$keep $ln" ;; esac
    done
    if [ -n "$keep" ]; then T_PROFILE_MENTION="$T_PROFILE_MENTION$(short "$p") line(s)$keep$NL"; fi
  done
  if [ -n "$T_FISH" ] && [ "$FISH_MODE" = edit ]; then
    lines=$(grep -n -x -F -e "$FISH_OLD1" -e "$FISH_OLD2" "$T_FISH" 2>/dev/null | cut -d: -f1 | tr '\n' ' ')
    lines=${lines% }
    if [ -n "$lines" ]; then T_PROFILES="$T_PROFILES$T_FISH${TAB}fish$TAB$lines$NL"; fi
  fi

  # Earlier unfinished runs (this run continues them) and older backups (list only).
  T_UNFINISHED=
  T_OLD_BACKUPS=
  local b
  for b in "$HOME/.pdd/migrate"/* "$HOME"/pocket-backup-*; do
    if [ ! -d "$b" ] || [ -L "$b" ] || [ "$b" = "$BACKUP" ]; then continue; fi
    if [ -f "$b/.in-progress" ] && [ -f "$b/MANIFEST.tsv" ] && [ ! -f "$b/.undone" ]; then
      T_UNFINISHED="$T_UNFINISHED$b$NL"
    elif [ -f "$b/MANIFEST.tsv" ]; then
      T_OLD_BACKUPS="$T_OLD_BACKUPS$(short "$b")$NL"
    fi
  done
  for b in "$HOME"/pocket-old-* "$HOME"/pdd-before-*; do
    if [ -d "$b" ]; then T_OLD_BACKUPS="$T_OLD_BACKUPS$(short "$b")$NL"; fi
  done
  VOLTA_PDD=no
  if exists_any "$HOME/.volta/bin/pdd"; then VOLTA_PDD=yes; fi

  # Disk space. APFS clones need little new space; otherwise a full copy.
  POCKET_KB=0
  local where_backup
  where_backup=$(nearest_existing "${BACKUP:-${BACKUP_ARG:-$HOME/.pdd/migrate}}")
  FREE_KB=$(df -k "$where_backup" 2>/dev/null | awk 'NR == 2 {print $4}')
  CLONE=no
  SAME_DEV=yes
  if [ -d "$POCKET" ]; then
    POCKET_KB=$(du -sk "$POCKET" 2>/dev/null | awk '{print $1}')
    if [ "$(dev_of "$where_backup")" != "$(dev_of "$POCKET")" ]; then SAME_DEV=no; fi
    if is_mac && [ "$SAME_DEV" = yes ]; then
      local mp
      mp=$(df -P "$POCKET" 2>/dev/null | awk 'NR == 2 {print $6}')
      if mount | grep -F -- " on $mp (" | grep -q '(apfs'; then CLONE=yes; fi
    fi
  fi
  if [ "$CLONE" = yes ]; then NEED_KB=2097152
  elif [ "$SAME_DEV" = yes ]; then NEED_KB=$(( ${POCKET_KB:-0} + 2097152 ))
  else NEED_KB=$(( ${POCKET_KB:-0} * 2 + 2097152 )); fi

  # The old R line, as the installer defines it.
  OLD_LINE=no
  if [ -d "$POCKET" ] || [ -n "$T_PLISTS" ] || [ -n "$T_NOPLIST" ] || [ -n "$T_UNITS" ] \
    || [ -n "$T_APP" ] || [ "$OLD_CMD_FOUND" = yes ]; then
    OLD_LINE=yes
  fi
  # Leftovers that only the old installer makes also count as work to do.
  NOTHING=yes
  if [ "$OLD_LINE" = yes ] || [ -n "$T_APPSRV" ] || [ -n "$T_GATEWAY" ] || [ -n "$T_LINKS" ] \
    || [ -n "$T_V1" ] || [ -n "$T_FISH" ] || [ -n "$T_PROFILES" ] || [ -n "$T_UNFINISHED" ]; then
    NOTHING=no
  fi
}

gb() { awk -v k="${1:-0}" 'BEGIN { if (k < 1048576) printf "%d MB", k / 1024; else printf "%.1f GB", k / 1048576 }'; }

# ---------------------------------------------------------------- steps

step_backup_folder() {
  step "1. Backup folder and free space"
  if [ -d "$POCKET" ]; then
    info "~/pocket uses about $(gb "$POCKET_KB"). Free space: $(gb "$FREE_KB")."
    if [ "$CLONE" = yes ]; then info "The copy uses APFS clones, so it needs little new space. The script asks for $(gb "$NEED_KB") free."
    else info "The copy is a full copy. The script asks for $(gb "$NEED_KB") free."; fi
    if [ "${FREE_KB:-0}" -lt "$NEED_KB" ]; then
      if [ "$MODE" = dry ]; then
        WOULD_REFUSE="not enough free disk space (it needs $(gb "$NEED_KB"), $(gb "$FREE_KB") is free)"
      else
        refuse "Not enough free disk space. It needs $(gb "$NEED_KB"), and $(gb "$FREE_KB") is free."
      fi
    fi
  fi
  if is_mac && [ -z "$LA_DOMAINS" ] && [ -n "$T_PLISTS" ]; then
    if [ "$MODE" = dry ]; then WOULD_REFUSE="launchd is not reachable for this user"
    else refuse "launchd is not reachable for this user, so the old login services cannot be stopped. Log in as this user, then run it again."; fi
  fi
  if ! is_mac && [ "$SD_OK" != yes ] && [ -n "$T_UNITS" ]; then
    if [ "$MODE" = dry ]; then WOULD_REFUSE="systemctl --user is not reachable for this user"
    else refuse "systemctl --user is not reachable, so the old user services cannot be stopped. Log in as this user (or enable lingering), then run it again."; fi
  fi
  local u
  if [ "$MODE" = dry ]; then
    plan "make the backup folder ${BACKUP_ARG:-~/.pdd/migrate/<UTC time>} (mode 700) with MANIFEST.tsv and log.txt"
    while IFS= read -r u; do
      if [ -n "$u" ]; then plan "continue the unfinished run in $(short "$u") (an undo of this run also undoes it)"; fi
    done <<EOF
$T_UNFINISHED
EOF
    return
  fi
  if [ "$RESUME" = yes ]; then
    say "  Resume: an earlier run in this folder stopped. The script continues it."
  else
    : > "$BACKUP/.in-progress"
    manifest BEGIN "$TS" "$USER_NAME" "$SCRIPT_NAME $VERSION"
    cat > "$BACKUP/RESTORE.txt" <<EOF
This folder is a backup of the old Pocket install (the "R line").
It was made by $SCRIPT_NAME $VERSION on $TS for user $USER_NAME.

  pocket/          the old ~/pocket folder (moved here at the end)
  pocket-copy/     a safety copy; it is deleted when the move completes
  home/            old login service or unit files, ~/.local/bin links, fish file
  profiles/        copies of shell files before the edit
  MANIFEST.tsv     each change, in order
  log.txt          the full log

To undo:
  bash $SELF --undo $BACKUP

Keep this folder until the new PDD works for you.
EOF
    ok "made the backup folder $BACKUP"
  fi
  while IFS= read -r u; do
    if [ -z "$u" ]; then continue; fi
    plan "continue the unfinished run in $(short "$u")"
    manifest CONTINUES "$u"
    printf '%s\n' "$BACKUP" > "$u/.continued-in"
    rm -f "$u/.in-progress"
    if [ -d "$u/pocket-copy" ] && [ -d "$POCKET" ]; then rm -rf "$u/pocket-copy"; rm -f "$u/.copy-ok"; fi
    ok "this run continues $(short "$u"); its undo is part of this run's undo"
  done <<EOF
$T_UNFINISHED
EOF
}

SERVICES_OK=yes
step_services_launchd() {
  step "2. Old login services (LaunchAgents) that run from ~/pocket"
  if [ -z "$T_PLISTS" ] && [ -z "$T_NOPLIST" ]; then info "None found."; fi
  local label f where state doms
  while IFS="$TAB" read -r label f <&3; do
    if [ -z "$label" ]; then continue; fi
    where=$(la_where "$label")
    case "$where" in
      loaded:*) state=loaded; doms=${where#loaded:}; plan "stop login service $label (loaded in $doms)" ;;
      absent) state=absent; doms=- ;;
      *) state=unknown; doms=-; plan "stop login service $label (state unknown)" ;;
    esac
    plan "move $(short "$f") to the backup"
    if [ "$MODE" = dry ]; then continue; fi
    if [ "$state" = loaded ]; then
      if ! la_bootout "$label" "$doms"; then
        fail_item "could not stop the login service $label. Its file was kept."
        SERVICES_OK=no
        continue
      fi
      CHANGED=1
    elif [ "$state" = unknown ]; then
      fail_item "could not read the state of $label. Its file was kept."
      SERVICES_OK=no
      continue
    fi
    if move_to_backup PLIST "$f" "$label" "$state" "${doms%% *}"; then
      ok "stopped $label and moved its file to the backup"
    else
      fail_item "stopped $label, but could not move $(short "$f") to the backup"
    fi
  done 3<<EOF
$T_PLISTS
EOF
  while IFS="$TAB" read -r label doms <&3; do
    if [ -z "$label" ]; then continue; fi
    plan "stop login service $label in $doms (it has no file)"
    if [ "$MODE" = dry ]; then continue; fi
    manifest BOOTOUT "$label"
    if la_bootout "$label" "$doms"; then ok "stopped $label"; else fail_item "could not stop $label"; SERVICES_OK=no; fi
  done 3<<EOF
$T_NOPLIST
EOF
  if [ -n "$T_MENTION" ]; then
    info "Kept (they do not run from ~/pocket, but their settings name it):"
    list_lines "    - " "$T_MENTION"
    NOTE_LIST="${NOTE_LIST}Other login services name ~/pocket in their settings. They were kept.$NL"
  fi
}

step_services_systemd() {
  step "2. Old user services (systemd --user) of the old Linux setup"
  if [ -z "$T_UNITS" ]; then info "None found."; return; fi
  local u active rel n moved=no
  while IFS="$TAB" read -r u active <&3; do
    if [ -z "$u" ]; then continue; fi
    case "$active" in
      inactive|failed|unknown) ;;
      *) plan "stop user service $u (now: $active)" ;;
    esac
    while IFS= read -r rel; do
      if [ -n "$rel" ]; then plan "move ~/$rel to the backup"; fi
    done <<EOF
$(sd_paths "$u")
EOF
    if [ "$MODE" = dry ]; then continue; fi
    case "$active" in
      inactive|failed|unknown) ;;
      *)
        sd stop "$u" > /dev/null 2>&1
        n=0
        while [ "$n" -lt 25 ]; do
          case "$(sd_active "$u")" in inactive|failed) break ;; esac
          sleep 0.2
          n=$((n + 1))
        done
        case "$(sd_active "$u")" in
          inactive|failed) CHANGED=1 ;;
          *) fail_item "could not stop the user service $u. Its files were kept."; SERVICES_OK=no; continue ;;
        esac ;;
    esac
    while IFS= read -r rel; do
      if [ -z "$rel" ]; then continue; fi
      if move_to_backup UNIT "$HOME/$rel" "$u" "$active"; then moved=yes; ok "moved ~/$rel to the backup"
      else fail_item "could not move ~/$rel to the backup"; fi
    done <<EOF
$(sd_paths "$u")
EOF
  done 3<<EOF
$T_UNITS
EOF
  if [ "$MODE" != dry ] && [ "$moved" = yes ] && [ "$SD_OK" = yes ]; then
    sd daemon-reload > /dev/null 2>&1 || note "systemctl --user daemon-reload failed. Log out and in again."
  fi
}

step_services() {
  if is_mac; then step_services_launchd; else step_services_systemd; fi
  # The gateway process must be gone after its service stops.
  local pid start n
  while IFS="$TAB" read -r pid start <&3; do
    if [ -z "$pid" ]; then continue; fi
    if [ "$MODE" = dry ]; then
      info "The old gateway runs now (pid $pid). It stops with its service."
      continue
    fi
    n=0
    while [ "$(proc_lstart "$pid")" = "$start" ] && [ "$n" -lt 25 ]; do sleep 0.2; n=$((n + 1)); done
    if [ "$(proc_lstart "$pid")" = "$start" ]; then
      manifest PROC_STOP gateway "$pid"
      if stop_pid "$pid" "$start"; then ok "stopped the old gateway process (pid $pid)"; else fail_item "the old gateway process (pid $pid) still runs"; SERVICES_OK=no; fi
    fi
  done 3<<EOF
$T_GATEWAY
EOF
}

APP_OK=yes
step_session_links() {
  if ! is_mac; then return; fi
  step "3. PDD Session Links app (an app, not a login service)"
  if [ ! -d "$APP_BUNDLE" ] && [ -z "$T_APP" ]; then info "Not found."; return; fi
  local pid start n
  if [ -z "$T_APP" ]; then info "It is not running."; fi
  while IFS="$TAB" read -r pid start <&3; do
    if [ -z "$pid" ]; then continue; fi
    plan "quit PDD Session Links (pid $pid)"
    if [ "$MODE" = dry ]; then continue; fi
    manifest PROC_STOP session-links "$pid"
    if stop_pid "$pid" "$start"; then ok "quit PDD Session Links (pid $pid)"; else fail_item "PDD Session Links (pid $pid) still runs"; APP_OK=no; fi
  done 3<<EOF
$T_APP
EOF
  plan "remove PDD Session Links from Login Items if it is there (macOS can ask once for permission)"
  if [ "$MODE" != dry ]; then
    if [ "${PDD_MOVE_SKIP_LOGIN_ITEMS:-}" = 1 ]; then
      note "Login Items were not checked (PDD_MOVE_SKIP_LOGIN_ITEMS=1)."
    else
      n=$(login_items count "$APP_BUNDLE")
      case "$n" in
        0) info "It is not in Login Items." ;;
        [1-9]*)
          manifest LOGIN_ITEM "$APP_BUNDLE"
          n=$(login_items delete "$APP_BUNDLE")
          if [ "$n" = 0 ]; then ok "removed PDD Session Links from Login Items"; else fail_item "could not remove PDD Session Links from Login Items"; fi ;;
        *) note "Could not read Login Items. Open System Settings > General > Login Items. Remove 'PDD Session Links' if you see it." ;;
      esac
    fi
  fi
  if [ -d "$APP_BUNDLE" ]; then
    plan "unregister the pdw:// link handler of ~/pocket/PDD Session Links.app (lsregister -u)"
    if [ "$MODE" != dry ]; then
      manifest LSREG "$APP_BUNDLE"
      if "$LSREGISTER" -u "$APP_BUNDLE" > /dev/null 2>&1; then ok "unregistered the pdw:// link handler"
      else fail_item "could not unregister the pdw:// link handler"; fi
    fi
  fi
}

APPSRV_OK=yes
step_app_server() {
  step "4. Old Codex app-server (only CODEX_HOME = ~/pocket/codex/default)"
  local pid start ev exe
  if [ -z "$T_APPSRV" ]; then info "None runs."; fi
  while IFS="$TAB" read -r pid start ev exe <&3; do
    if [ -z "$pid" ]; then continue; fi
    case "$REG_CONFIRMED" in *" $pid "*) ev="$ev and the old registry" ;; esac
    plan "stop the old Codex app-server pid $pid ($(short "$exe"), CODEX_HOME=~/pocket/codex/default; proof: $ev)"
    if [ "$MODE" = dry ]; then continue; fi
    manifest PROC_STOP codex-app-server "$pid"
    if stop_pid "$pid" "$start"; then ok "stopped the old Codex app-server (pid $pid)"; else fail_item "the old Codex app-server (pid $pid) still runs"; APPSRV_OK=no; fi
  done 3<<EOF
$T_APPSRV
EOF
  info "Other Codex processes: $OTHER_CODEX. The script does not touch them."
  if [ -n "$T_OTHER_HOME" ]; then
    note "Other Codex processes still use ~/pocket/codex/default (pid $(printf '%s' "$T_OTHER_HOME" | tr '\n' ' ' | sed 's/ $//')). They were kept. Close them when they finish."
  fi
}

COPY_OK=no
step_copy() {
  step "5. Copy ~/pocket to the backup (after the old services stop)"
  if [ ! -d "$POCKET" ]; then
    info "~/pocket does not exist."
    if [ -n "$BACKUP" ] && [ -d "$BACKUP/pocket" ]; then COPY_OK=yes; fi
    return
  fi
  if [ "$CLONE" = yes ]; then plan "copy ~/pocket to the backup as pocket-copy (APFS clone) and check the file count"
  else plan "copy ~/pocket to the backup as pocket-copy (full copy, $(gb "$POCKET_KB")) and check the file count"; fi
  if [ "$MODE" = dry ]; then return; fi
  if [ -f "$BACKUP/.copy-ok" ] && [ -d "$BACKUP/pocket-copy" ]; then
    info "The copy from the earlier run is complete. It is kept."
    COPY_OK=yes
    return
  fi
  # Our own copy from a run that stopped. Remove it and copy again.
  if [ -d "$BACKUP/pocket-copy" ]; then rm -rf "$BACKUP/pocket-copy"; fi
  manifest COPY pocket-copy
  local rc
  if is_mac; then cp -a -c "$POCKET" "$BACKUP/pocket-copy" 2> "$BACKUP/copy-errors.txt"; rc=$?
  else cp -a --reflink=auto "$POCKET" "$BACKUP/pocket-copy" 2> "$BACKUP/copy-errors.txt"; rc=$?; fi
  if [ "$rc" != 0 ]; then
    fail_item "the copy of ~/pocket did not complete (see copy-errors.txt in the backup). ~/pocket was kept."
    return
  fi
  local a b
  a=$(find "$POCKET" 2>/dev/null | wc -l | tr -d ' ')
  b=$(find "$BACKUP/pocket-copy" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$a" != "$b" ]; then
    fail_item "the copy has $b entries, but ~/pocket has $a. A program may still write into ~/pocket. Close it, then run --apply again. ~/pocket was kept."
    return
  fi
  : > "$BACKUP/.copy-ok"
  COPY_OK=yes
  ok "copied ~/pocket ($a files and folders)"
}

step_links() {
  step "6. ~/.local/bin (only entries that point into ~/pocket)"
  local name target sum
  if [ -z "$T_LINKS" ] && [ -z "$T_V1" ]; then info "No entries point into ~/pocket."; fi
  while IFS="$TAB" read -r name target <&3; do
    if [ -z "$name" ]; then continue; fi
    plan "move the link ~/.local/bin/$name (-> $(short "$target")) to the backup"
    if [ "$MODE" = dry ]; then continue; fi
    # Check again: the entry must still be the same link.
    if [ ! -L "$LBIN/$name" ] || [ "$(readlink "$LBIN/$name")" != "$target" ]; then
      fail_item "~/.local/bin/$name changed during the run. It was kept."
      continue
    fi
    if move_to_backup LINK "$LBIN/$name" "$target"; then ok "removed the link ~/.local/bin/$name"; else fail_item "could not move ~/.local/bin/$name"; fi
  done 3<<EOF
$T_LINKS
EOF
  while IFS="$TAB" read -r name sum <&3; do
    if [ -z "$name" ]; then continue; fi
    plan "move ~/.local/bin/$name to the backup (an old wrapper that runs a program in ~/pocket)"
    if [ "$MODE" = dry ]; then continue; fi
    if [ -L "$LBIN/$name" ] || [ ! -f "$LBIN/$name" ] || [ "$(sha_of "$LBIN/$name")" != "$sum" ]; then
      fail_item "~/.local/bin/$name changed during the run. It was kept."
      continue
    fi
    if move_to_backup FILE "$LBIN/$name" "$sum"; then ok "moved ~/.local/bin/$name to the backup"; else fail_item "could not move ~/.local/bin/$name"; fi
  done 3<<EOF
$T_V1
EOF
  if [ "$V1_KEPT" = yes ]; then info "Kept: ~/.local/bin/pdd-v1 (it runs a program outside ~/pocket)."; fi
  if [ "$HERDR_COPY" = yes ]; then
    plan "copy Herdr from $(short "$HERDR_SRC") to ~/.local/bin/herdr (the herdr you run today is in ~/pocket)"
    if [ "$MODE" != dry ]; then
      if exists_any "$LBIN/herdr"; then
        fail_item "~/.local/bin/herdr exists. Herdr was not copied."
      elif mkdir -p "$LBIN" && cp -p "$HERDR_SRC" "$LBIN/herdr"; then
        manifest HERDR_COPY "$LBIN/herdr" "$(sha_of "$LBIN/herdr")"
        ok "copied Herdr to ~/.local/bin/herdr"
      else
        fail_item "could not copy Herdr to ~/.local/bin/herdr"
      fi
    fi
  fi
  info "Kept: $T_LBIN_KEPT other entries in ~/.local/bin."
  if [ -n "$CODEX_LINK_NOTE" ]; then
    info "Kept: ~/.local/bin/codex points to $CODEX_LINK_NOTE (standalone Codex, outside ~/pocket)."
  fi
  if [ -n "$T_LBIN_MENTION" ]; then
    info "Kept: these files name ~/pocket inside. They can stop working after the move:"
    list_lines "    - ~/.local/bin/" "$T_LBIN_MENTION"
  fi
}

edit_profile() { # file kind -> replace the old lines; keep a .bak
  local p=$1 kind=$2 bak tmp after old_a old_b new
  if [ "$kind" = fish ]; then old_a=$FISH_OLD1; old_b=$FISH_OLD2; new=$FISH_NEW
  else old_a=$SH_OLD1; old_b=$SH_OLD2; new=$SH_NEW; fi
  if [ -L "$p" ]; then
    fail_item "$(short "$p") is a link. Edit it by hand: take \$HOME/pocket/bin out of the PATH line."
    return
  fi
  bak="$p.pdd-move-$TS.bak"
  if exists_any "$bak"; then fail_item "$(short "$bak") exists. $(short "$p") was not changed."; return; fi
  if ! cp -p "$p" "$bak"; then fail_item "could not copy $(short "$p") to $(short "$bak")"; return; fi
  mkdir -p "$BACKUP/profiles" && cp -p "$p" "$BACKUP/profiles/$(printf '%s' "${p#"$HOME"/}" | tr '/' '_')"
  tmp=$(mktemp "$BACKUP/profile.XXXXXX") || { fail_item "could not edit $(short "$p")"; return; }
  PDDM_A=$old_a PDDM_B=$old_b PDDM_N=$new awk '
    BEGIN { a = ENVIRON["PDDM_A"]; b = ENVIRON["PDDM_B"]; n = ENVIRON["PDDM_N"] }
    { if ($0 == a || $0 == b) print n; else print }' "$p" > "$tmp"
  if grep -q -x -F -e "$old_a" -e "$old_b" "$tmp"; then
    rm -f "$tmp"
    fail_item "could not edit $(short "$p")"
    return
  fi
  # Write in place: keep the file, its mode and its owner.
  if cat "$tmp" > "$p"; then
    after=$(sha_of "$p")
    manifest PROFILE "$p" "$bak" "$after"
    ok "edited $(short "$p") (copy: $(short "$bak"))"
  else
    fail_item "could not write $(short "$p"). The copy is $(short "$bak")."
  fi
  rm -f "$tmp"
}

step_shell_path() {
  step "7. Shell PATH (fish uses its own file)"
  if [ -z "$T_FISH" ] && [ -z "$T_PROFILES" ]; then info "No old PATH lines found."; fi
  if [ -n "$T_FISH" ] && [ "$FISH_MODE" = move ]; then
    plan "move $(short "$T_FISH") to the backup"
    if [ "$FISH_TWIN" = yes ]; then
      plan "add $(short "$FISH_DIR/conf.d/pdd-local-bin.fish") with '$FISH_NEW' (keeps ~/.local/bin on the fish PATH)"
    fi
    if [ "$MODE" != dry ]; then
      if move_to_backup FISH_MOVE "$T_FISH"; then
        ok "moved $(short "$T_FISH") to the backup"
        if [ "$FISH_TWIN" = yes ]; then
          local twin="$FISH_DIR/conf.d/pdd-local-bin.fish"
          if printf '# Added by %s on %s. It keeps ~/.local/bin on the PATH after the old Pocket file moved.\n%s\n' \
            "$SCRIPT_NAME" "$TS" "$FISH_NEW" > "$twin"; then
            manifest FISH_NEW "$twin" "$(sha_of "$twin")"
            ok "added $(short "$twin")"
          else
            fail_item "could not add $(short "$twin")"
          fi
        fi
      else
        fail_item "could not move $(short "$T_FISH")"
      fi
    fi
  elif [ -n "$T_FISH" ]; then
    info "$(short "$T_FISH") has other lines too. The script edits only the old lines in it."
  fi
  local p kind lines
  while IFS="$TAB" read -r p kind lines <&3; do
    if [ -z "$p" ]; then continue; fi
    plan "edit $(short "$p") line $lines: take \$HOME/pocket/bin out of PATH, keep ~/.local/bin (copy: $(short "$p").pdd-move-$TS.bak)"
    if [ "$MODE" != dry ]; then edit_profile "$p" "$kind"; fi
  done 3<<EOF
$T_PROFILES
EOF
  if [ -n "$T_PROFILE_MENTION" ]; then
    info "Kept: other lines that name ~/pocket (check them by hand):"
    list_lines "    - " "$T_PROFILE_MENTION"
  fi
}

step_final_move() {
  step "8. Move ~/pocket to the backup"
  if [ ! -d "$POCKET" ]; then info "~/pocket does not exist."; return; fi
  plan "move ~/pocket to the backup as pocket (the original files), then delete pocket-copy"
  if [ "$MODE" = dry ]; then return; fi
  if [ "$SERVICES_OK" != yes ] || [ "$APP_OK" != yes ] || [ "$APPSRV_OK" != yes ] || [ "$COPY_OK" != yes ]; then
    fail_item "~/pocket was kept in place, because an earlier step did not finish."
    return
  fi
  if exists_any "$BACKUP/pocket"; then fail_item "the backup already has a pocket folder. ~/pocket was kept."; return; fi
  manifest POCKET_MOVED pocket
  if ! mv "$POCKET" "$BACKUP/pocket"; then
    fail_item "could not move ~/pocket. It was kept. The safety copy is in the backup."
    return
  fi
  ok "moved ~/pocket to the backup"
  if rm -rf "$BACKUP/pocket-copy"; then
    rm -f "$BACKUP/.copy-ok"
    manifest COPY_REMOVED pocket-copy
  else
    note "Could not delete the safety copy pocket-copy in the backup. You can delete it."
  fi
}

summary_common() {
  say "Not touched: ~/.codex, Herdr panes and sessions, your own codex and claude, and all other files in ~/.local/bin."
  if [ -n "$CODEX_LINK_NOTE" ]; then say "Kept ~/.local/bin/codex (standalone Codex from the old installer)"; fi
  if [ -n "$T_OLD_BACKUPS" ]; then say "Older backups (kept):"; list_lines "  - " "$T_OLD_BACKUPS"; fi
  if [ "$VOLTA_PDD" = yes ]; then say "Volta has a 'pdd' command (~/.volta/bin/pdd). It was kept. Check that it is the new PDD."; fi
  if [ -n "$T_ONLY_IN_POCKET" ]; then say "After the move, these commands come from nowhere else:$T_ONLY_IN_POCKET. The new setup must install them."; fi
  if [ "$HERDR_SERVER_IN_POCKET" = yes ]; then say "The Herdr server runs from ~/pocket. It keeps running. Do not stop it until Herdr is installed again."; fi
  if [ -n "$T_FROM_POCKET" ]; then say "Other programs still run from ~/pocket (kept):"; list_lines "  - pid " "$T_FROM_POCKET"; fi
  if [ -n "$NOTE_LIST" ]; then say "Notes:"; list_lines "  - " "$NOTE_LIST"; fi
}

do_apply() {
  if [ "$MODE" = apply ]; then
    setup_backup_dir
    if user_is_refused; then refuse "The user '$USER_NAME' is in PDD_MOVE_REFUSE_USER ($REFUSE_USERS)."; fi
    take_lock
  fi
  check_real_dirs
  if [ "$MODE" = dry ]; then say "$SCRIPT_NAME $VERSION ($OS). DRY RUN: nothing changes. User: $USER_NAME. Home: $HOME."
  else say "$SCRIPT_NAME $VERSION ($OS). APPLY. User: $USER_NAME. Home: $HOME."; fi
  discover
  if [ "$NOTHING" = yes ]; then
    say "Nothing to do. The old R line was not found for this user."
    if [ -n "$T_OLD_BACKUPS" ]; then say "Older backups (kept):"; list_lines "  - " "$T_OLD_BACKUPS"; fi
    if [ "$MODE" = dry ]; then exit 2; fi
    log_line "RESULT: nothing to do"
    cleanup_lock
    exit 0
  fi
  if [ "$OLD_LINE" = yes ]; then say "Found: the old R line."; else say "Found: leftovers of the old R line."; fi
  if [ "$MODE" = dry ] && user_is_refused; then
    WOULD_REFUSE="the user '$USER_NAME' is in PDD_MOVE_REFUSE_USER ($REFUSE_USERS)"
  fi
  step_backup_folder
  step_services
  step_session_links
  step_app_server
  step_copy
  step_links
  step_shell_path
  step_final_move

  say ""
  say "== Summary"
  if [ "$MODE" = dry ]; then
    say "Dry run: $PLANNED planned actions (on stdout). Nothing changed."
    summary_common
    if [ -n "$WOULD_REFUSE" ]; then
      printf '%s: a real run would refuse: %s\n' "$SCRIPT_NAME" "$WOULD_REFUSE" >&2
      exit 1
    fi
    exit 0
  fi
  say "Backup folder: $BACKUP"
  say "Done:"
  if [ -n "$DONE_LIST" ]; then list_lines "  - " "$DONE_LIST"; else say "  - nothing"; fi
  if [ -n "$FAIL_LIST" ]; then say "Not done (the move is only partly done):"; list_lines "  - " "$FAIL_LIST"; fi
  summary_common
  say ""
  if [ -z "$FAIL_LIST" ]; then
    say "Next: open a new terminal window. Check with: type -a pdd (no ~/pocket path)."
  else
    say "Fix the items above, then run --apply again; it continues this run."
  fi
  say "To undo: bash $SELF --undo $BACKUP"
  if [ -n "$FAIL_LIST" ]; then
    fail_out "failed: the move is only partly done; the summary on stdout says what was done and how to undo it"
  fi
  rm -f "$BACKUP/.in-progress"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP/.done"
  log_line "RESULT: done"
  cleanup_lock
  exit 0
}

# ---------------------------------------------------------------- undo

UNDO_START_UNITS=
undo_one() { # dir -> restore it; prints CONTINUES dirs on fd 4
  local b=$1 kind a c d e src dest cur n rev units=no
  BACKUP=$b
  log_line "---- $SCRIPT_NAME $VERSION --undo $(date -u +%Y-%m-%dT%H:%M:%SZ) user=$USER_NAME dir=$b"
  say ""
  say "== Undo $(short "$b")"
  if grep -q "^POCKET_MOVED$TAB" "$b/MANIFEST.tsv" && [ -d "$b/pocket" ] && exists_any "$POCKET"; then
    fail_item "~/pocket exists now. Move it aside first (for example to ~/pocket-new), then run the undo again. $(short "$b") was not restored."
    return
  fi
  rev=$(mktemp "$b/.undo-order.XXXXXX") || { fail_item "could not read the manifest of $(short "$b")"; return; }
  reverse_lines "$b/MANIFEST.tsv" > "$rev"
  while IFS="$TAB" read -r kind a c d e <&3; do
    case "$kind" in
      POCKET_MOVED)
        if [ -d "$b/pocket" ] && ! exists_any "$POCKET"; then
          if mv "$b/pocket" "$POCKET"; then ok "put ~/pocket back"; else fail_item "could not put ~/pocket back"; fi
        fi ;;
      COPY_REMOVED|COPY|BEGIN) ;;
      CONTINUES)
        printf '%s\n' "$a" >&4 ;;
      PROFILE)
        # a = file, c = .bak, d = sha after the edit
        if [ ! -f "$c" ]; then fail_item "the copy $(short "$c") is missing. $(short "$a") was kept."; continue; fi
        cur=$(sha_of "$a")
        if [ "$cur" = "$d" ]; then
          assert_safe_target "$a"
          if cat "$c" > "$a"; then ok "restored $(short "$a") from $(short "$c")"; else fail_item "could not restore $(short "$a")"; fi
        else
          fail_item "$(short "$a") changed after the move. Restore it by hand from $(short "$c")."
        fi ;;
      FISH_NEW|HERDR_COPY)
        # a = file the script made, c = its sha
        if [ -f "$a" ] && [ "$(sha_of "$a")" = "$c" ]; then
          assert_safe_target "$a"
          if rm -f "$a"; then ok "removed $(short "$a")"; else fail_item "could not remove $(short "$a")"; fi
        elif exists_any "$a"; then
          note "$(short "$a") changed after the move. It was kept."
        fi ;;
      FISH_MOVE|LINK|FILE|PLIST|UNIT)
        # a = HOME-relative path
        case "$a" in ''|/*|*..*) fail_item "bad entry in the manifest: $a"; continue ;; esac
        src="$b/home/$a"
        dest="$HOME/$a"
        assert_safe_target "$dest"
        if exists_any "$src"; then
          if exists_any "$dest"; then
            fail_item "$(short "$dest") exists now. The backup copy was kept in $(short "$src")."
            continue
          fi
          mkdir -p "$(dirname "$dest")"
          if mv "$src" "$dest"; then ok "put back $(short "$dest")"; else fail_item "could not put back $(short "$dest")"; continue; fi
        fi
        if [ "$kind" = UNIT ]; then
          units=yes
          if [ "$a" = ".config/systemd/user/$c" ]; then
            case "$d" in active|activating|reloading) UNDO_START_UNITS="$UNDO_START_UNITS $c" ;; esac
          fi
        fi
        if [ "$kind" = PLIST ] && [ "$d" = loaded ] && [ -f "$dest" ] && is_mac; then
          # c = label, e = the launchd domain it was loaded in
          case "$e" in gui/*|user/*) ;; *) e="gui/$UID_NUM" ;; esac
          if [ "$(la_state_in "$e" "$c")" != loaded ]; then
            launchctl bootstrap "$e" "$dest" > /dev/null 2>&1
            n=0
            while [ "$(la_state_in "$e" "$c")" != loaded ] && [ "$n" -lt 25 ]; do sleep 0.2; n=$((n + 1)); done
          fi
          if [ "$(la_state_in "$e" "$c")" = loaded ]; then ok "loaded the login service $c again ($e)"; else fail_item "could not load the login service $c in $e"; fi
        fi ;;
      BOOTOUT)
        note "The login service $a had no file. Run the old setup again if you need it." ;;
      LSREG)
        if [ -d "$a" ] && is_mac; then
          if "$LSREGISTER" -f "$a" > /dev/null 2>&1; then ok "registered the pdw:// link handler again"; else fail_item "could not register the pdw:// link handler"; fi
        fi ;;
      LOGIN_ITEM)
        if [ -d "$a" ] && is_mac; then
          n=$(login_items add "$a")
          case "$n" in [1-9]*) ok "added PDD Session Links to Login Items again" ;; *) fail_item "could not add PDD Session Links to Login Items" ;; esac
        fi ;;
      PROC_STOP)
        case "$a" in
          gateway) info "The old gateway (pid $c) was stopped. It starts again with its service." ;;
          codex-app-server) info "The old Codex app-server (pid $c) was stopped. The old gateway starts a new one." ;;
          session-links) info "PDD Session Links (pid $c) was quit. It opens again with the next pdw:// link." ;;
          *) info "The old $a (pid $c) was stopped." ;;
        esac ;;
      *) ;;
    esac
  done 3< "$rev"
  rm -f "$rev"
  if [ "$units" = yes ] && ! is_mac; then
    SD_OK=no
    if command -v systemctl > /dev/null 2>&1 && sd show-environment > /dev/null 2>&1; then SD_OK=yes; fi
    if [ "$SD_OK" = yes ]; then
      sd daemon-reload > /dev/null 2>&1
      local u
      for u in $UNDO_START_UNITS; do
        if sd start "$u" > /dev/null 2>&1; then ok "started the user service $u again"; else fail_item "could not start the user service $u"; fi
      done
    else
      fail_item "systemctl --user is not reachable. Run: systemctl --user daemon-reload, then start the old services."
    fi
    UNDO_START_UNITS=
  fi
  rm -f "$b/.in-progress"
}

do_undo() {
  local b first_log queue next cont seen=" "
  if user_is_refused; then
    say "REFUSED: the user '$USER_NAME' is in PDD_MOVE_REFUSE_USER ($REFUSE_USERS)."
    fail_out "refused: the user '$USER_NAME' is in PDD_MOVE_REFUSE_USER"
  fi
  case "$UNDO_DIR" in
    /*) ;;
    *) UNDO_DIR="$(pwd)/$UNDO_DIR" ;;
  esac
  b=$(norm_path "$UNDO_DIR")
  if [ -L "$b" ] || [ ! -d "$b" ] || [ ! -O "$b" ] || [ ! -f "$b/MANIFEST.tsv" ] \
    || ! head -1 "$b/MANIFEST.tsv" | grep -q "^BEGIN$TAB"; then
    fail_out "refused: $b is not a backup folder made by this script (no MANIFEST.tsv)"
  fi
  LOG="$b/log.txt"
  first_log=$LOG
  take_lock
  say "$SCRIPT_NAME $VERSION ($OS). UNDO. User: $USER_NAME."
  if grep -q "^POCKET_MOVED$TAB" "$b/MANIFEST.tsv" && [ -d "$b/pocket" ] && exists_any "$POCKET"; then
    refuse "~/pocket exists now. Move it aside first (for example to ~/pocket-new), then run the undo again."
  fi
  queue="$b$NL"
  while [ -n "$queue" ]; do
    next=${queue%%"$NL"*}
    queue=${queue#*"$NL"}
    if [ -z "$next" ]; then continue; fi
    case "$seen" in *" $next "*) continue ;; esac
    seen="$seen$next "
    if [ ! -d "$next" ] || [ ! -f "$next/MANIFEST.tsv" ]; then fail_item "the earlier run $next is missing"; continue; fi
    LOG="$next/log.txt"
    cont=$(mktemp "$next/.continues.XXXXXX") || { fail_item "could not undo $next"; continue; }
    undo_one "$next" 4> "$cont"
    queue="$queue$(cat "$cont")$NL"
    rm -f "$cont"
    if [ -z "$FAIL_LIST" ]; then date -u +%Y-%m-%dT%H:%M:%SZ > "$next/.undone"; fi
  done
  LOG=$first_log
  say ""
  say "== Summary"
  if [ -n "$DONE_LIST" ]; then say "Done:"; list_lines "  - " "$DONE_LIST"; fi
  if [ -n "$FAIL_LIST" ]; then say "Not done:"; list_lines "  - " "$FAIL_LIST"; fi
  if [ -n "$NOTE_LIST" ]; then say "Notes:"; list_lines "  - " "$NOTE_LIST"; fi
  say "The backup folder stays: $b. Delete it when you are sure."
  say "Open a new terminal window to get the old PATH back."
  if [ -n "$FAIL_LIST" ]; then fail_out "failed: the undo is only partly done; see the summary on stdout"; fi
  log_line "RESULT: undone"
  cleanup_lock
  exit 0
}

# ---------------------------------------------------------------- main

main() {
  parse_args "$@"
  preflight
  if [ "$MODE" = undo ]; then do_undo; else do_apply; fi
}

# PDD_MOVE_LIB_ONLY=1 loads the functions for unit tests and runs no mode.
if [ "${PDD_MOVE_LIB_ONLY:-}" != 1 ]; then main "$@"; fi
