// Generated from prompts/cli/pdd-directory.prompt.md (sha256: a02141327e515cca3833751894481b0c8af2cdd9a099660c31fa39b9bec3f701).
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <inttypes.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int number(const char *text, uintmax_t *value) {
  if (!text[0] || text[0] == '-') return -1;
  char *end;
  errno = 0;
  *value = strtoumax(text, &end, 10);
  return errno || *end ? -1 : 0;
}
static int matches(const struct stat *st, uintmax_t dev, uintmax_t ino) {
  return (uintmax_t)st->st_dev == dev && (uintmax_t)st->st_ino == ino;
}
int main(int argc, char **argv) {
  uintmax_t parent_dev, parent_ino, target_dev = 0, target_ino = 0;
  if (argc != 7 || argv[1][0] != '/' ||
      (strcmp(argv[2], "0") && strcmp(argv[2], "1")) ||
      number(argv[3], &parent_dev) || number(argv[4], &parent_ino)) return 64;
  int expected = strcmp(argv[5], "-") != 0;
  if ((expected && (number(argv[5], &target_dev) || number(argv[6], &target_ino))) ||
      (!expected && strcmp(argv[6], "-"))) return 64;
  umask(0077);
  char *path = strdup(argv[1]);
  if (!path) return 74;
  int flags = O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC;
  int parent = open("/", flags);
  if (parent < 0) return 74;
  char *save, *part = strtok_r(path, "/", &save);
  if (!part) return 64;
  char *next;
  while ((next = strtok_r(NULL, "/", &save))) {
    if (!strcmp(part, ".") || !strcmp(part, "..")) return 64;
    int child = openat(parent, part, flags);
    if (child < 0) return 74;
    close(parent); parent = child; part = next;
  }
  if (!strcmp(part, ".") || !strcmp(part, "..")) return 64;
  struct stat st, before, after;
  if (fstat(parent, &st) || !S_ISDIR(st.st_mode) || !matches(&st, parent_dev, parent_ino)) return 74;
  int exists = fstatat(parent, part, &before, AT_SYMLINK_NOFOLLOW) == 0;
  if (!exists && errno != ENOENT) return 74;
  if (exists && (!S_ISDIR(before.st_mode) || before.st_uid != geteuid())) return 74;
  if (expected && (!exists || !matches(&before, target_dev, target_ino))) return 74;
  int created = 0;
  if (!exists) {
    if (mkdirat(parent, part, 0700)) { if (errno != EEXIST) return 74; }
    else created = 1;
  }
  int directory = openat(parent, part, flags);
  if (directory < 0 || fstat(directory, &st) || !S_ISDIR(st.st_mode) || st.st_uid != geteuid()) return 74;
  if ((exists && (st.st_dev != before.st_dev || st.st_ino != before.st_ino)) ||
      (expected && !matches(&st, target_dev, target_ino))) return 74;
  if ((created || !strcmp(argv[2], "1")) && (st.st_mode & 07777) != 0700 && fchmod(directory, 0700)) return 74;
  if (fstat(directory, &st) || fstatat(parent, part, &after, AT_SYMLINK_NOFOLLOW) ||
      !S_ISDIR(after.st_mode) || after.st_dev != st.st_dev || after.st_ino != st.st_ino ||
      ((created || !strcmp(argv[2], "1")) && (st.st_mode & 07777) != 0700)) return 74;
  printf("%ju %ju\n", (uintmax_t)st.st_dev, (uintmax_t)st.st_ino);
  close(directory); close(parent); free(path);
  return 0;
}
