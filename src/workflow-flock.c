// Generated from prompts/cli/workflow-claims.prompt.md (sha256: 616ba04d175a6bf7ae835b9406ff158d80028ae7ee39d96a92b0339088e8a78e).
#define _POSIX_C_SOURCE 200809L
#include <sys/file.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
/* Portable Mac/Linux helper: never replace or unlink the stable inode. */
int main(int argc, char **argv) {
  if (argc < 3 || (strcmp(argv[1], "hold") && strcmp(argv[1], "exec"))) return 64;
  int fd = open(argv[2], O_RDWR | O_CREAT | O_NOFOLLOW, 0600);
  if (fd < 0) return 70;
  struct stat st;
  if (fstat(fd, &st) || !S_ISREG(st.st_mode) || st.st_nlink != 1) return 70;
  if (flock(fd, LOCK_EX | LOCK_NB)) return errno == EWOULDBLOCK || errno == EAGAIN ? 75 : 70;
  if (!strcmp(argv[1], "exec")) {
    if (argc < 5 || strcmp(argv[3], "--")) return 64;
    /* open deliberately leaves FD_CLOEXEC clear. The same lock crosses exec. */
    execvp(argv[4], &argv[4]);
    return 71;
  }
  if (write(STDOUT_FILENO, "held\n", 5) != 5) return 70;
  char c;
  while (read(STDIN_FILENO, &c, 1) > 0) {}
  close(fd);
  return 0;
}
