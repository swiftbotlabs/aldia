"""Reads one key from a secrets file inside the process. Errors name the key only: a value can never reach a traceback,
because the file's contents are never part of an exception or a formatted message."""
import os
import stat


class EnvFileError(RuntimeError):
    pass


def read_env(path, key):
    try:
        st = os.lstat(path)
        if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode) or st.st_mode & 0o077:
            raise EnvFileError(f"{key}: the file holding it must be a regular 0600 file")
        with open(path) as f:
            for line in f:
                if line.startswith(key + "="):
                    value = line[len(key) + 1:].strip()
                    if value:
                        return value
    except EnvFileError:
        raise
    except Exception:
        # `from None` drops the original exception, whose text could quote the file
        raise EnvFileError(f"{key}: could not be read") from None
    raise EnvFileError(f"{key}: not found")
