// Generated from prompts/cli/update-lock.prompt.md (sha256: b5ceabddd881784082c6ba881a599fd3509aa9757802b5ff0fde10f6c42595cb).
// A persistent inode and a kernel-held lock; --exec deliberately keeps its fd.
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/select.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#ifdef __linux__
#include <sys/syscall.h>
#include <signal.h>
#endif

int main(int argc, char **argv) {
  if (argc < 3) return 64;
#ifdef __linux__
  if (!strcmp(argv[1], "--terminate")) {
    if (argc != 4) return 64;
    char *end; long pid = strtol(argv[2], &end, 10);
    if (*end || pid <= 1) return 64;
    int pfd = syscall(SYS_pidfd_open, pid, 0);
    if (pfd < 0) return errno == ESRCH ? 0 : 74;
    char path[64], line[4096]; snprintf(path, sizeof(path), "/proc/%ld/stat", pid);
    FILE *f = fopen(path, "r");
    if (!f || !fgets(line, sizeof(line), f)) return 74;
    fclose(f);
    char *rest = strrchr(line, ')'); if (!rest) return 74;
    char *save, *part = strtok_r(rest + 2, " ", &save);
    for (int i = 0; i < 19 && part; i++) part = strtok_r(NULL, " ", &save);
    if (!part || strcmp(part, argv[3])) return 73;
    return syscall(SYS_pidfd_send_signal, pfd, SIGKILL, NULL, 0) ? 74 : 0;
  }
#endif
  int fd = open(argv[2], O_RDWR | O_CREAT | O_NOFOLLOW, 0600);
  struct stat st;
  if (fd < 0 || fstat(fd, &st) || !S_ISREG(st.st_mode) || st.st_uid != getuid()) return 74;
  int busy = flock(fd, LOCK_EX | LOCK_NB);
  if (busy && errno != EWOULDBLOCK && errno != EAGAIN) return 74;
  if (!strcmp(argv[1], "--hold")) {
    if (busy) {
      puts("WAIT"); fflush(stdout);
      // Poll stdin as well: a dead/cancelled requester must not leave a waiter.
      while (flock(fd, LOCK_EX | LOCK_NB)) {
        if (errno != EWOULDBLOCK && errno != EAGAIN) return 74;
        fd_set r; FD_ZERO(&r); FD_SET(STDIN_FILENO, &r);
        struct timeval t = {0, 50000};
        if (select(1, &r, NULL, NULL, &t) > 0) return 0;
      }
    }
    puts("LOCKED"); fflush(stdout);
    char b; while (read(STDIN_FILENO, &b, 1) < 0 && errno == EINTR) {}
    return 0;
  }
  if (strcmp(argv[1], "--exec") && strcmp(argv[1], "--try-exec")) return 64;
  if (argc < 5 || strcmp(argv[3], "--")) return 64;
  if (busy && !strcmp(argv[1], "--try-exec")) return 73;
  if (busy && flock(fd, LOCK_EX)) return 74;
  if (fcntl(fd, F_SETFD, 0)) return 74;
  execvp(argv[4], argv + 4);
  return 126;
}
