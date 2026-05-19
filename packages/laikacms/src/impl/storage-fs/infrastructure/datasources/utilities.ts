import { isError } from "effect/Predicate";
import { ErrorCode, ErrorCodeToClassMap, InternalError, LaikaError } from "laikacms/core";

// Common system errors#
// This is a list of system errors commonly-encountered when writing a Node.js program. For a comprehensive list, see the errno(3) man page.

// EACCES (Permission denied): An attempt was made to access a file in a way forbidden by its file access permissions.

// EADDRINUSE (Address already in use): An attempt to bind a server (net, http, or https) to a local address failed due to another server on the local system already occupying that address.

// ECONNREFUSED (Connection refused): No connection could be made because the target machine actively refused it. This usually results from trying to connect to a service that is inactive on the foreign host.

// ECONNRESET (Connection reset by peer): A connection was forcibly closed by a peer. This normally results from a loss of the connection on the remote socket due to a timeout or reboot. Commonly encountered via the http and net modules.

// EEXIST (File exists): An existing file was the target of an operation that required that the target not exist.

// EISDIR (Is a directory): An operation expected a file, but the given pathname was a directory.

// EMFILE (Too many open files in system): Maximum number of file descriptors allowable on the system has been reached, and requests for another descriptor cannot be fulfilled until at least one has been closed. This is encountered when opening many files at once in parallel, especially on systems (in particular, macOS) where there is a low file descriptor limit for processes. To remedy a low limit, run ulimit -n 2048 in the same shell that will run the Node.js process.

// ENOENT (No such file or directory): Commonly raised by fs operations to indicate that a component of the specified pathname does not exist. No entity (file or directory) could be found by the given path.

// ENOTDIR (Not a directory): A component of the given pathname existed, but was not a directory as expected. Commonly raised by fs.readdir.

// ENOTEMPTY (Directory not empty): A directory with entries was the target of an operation that requires an empty directory, usually fs.unlink.

// ENOTFOUND (DNS lookup failed): Indicates a DNS failure of either EAI_NODATA or EAI_NONAME. This is not a standard POSIX error.

// EPERM (Operation not permitted): An attempt was made to perform an operation that requires elevated privileges.

// EPIPE (Broken pipe): A write on a pipe, socket, or FIFO for which there is no process to read the data. Commonly encountered at the net and http layers, indicative that the remote side of the stream being written to has been closed.

// ETIMEDOUT (Operation timed out): A connect or send request failed because the connected party did not properly respond after a period of time. Usually encountered by http or net. Often a sign that a socket.end() was not properly called.

const systemErrors = {
  EACCESS: {
    publicMessage: 'Permission denied',
    laikaCode: 'forbidden',
  },
  EADDRINUSE: {
    laikaCode: 'conflict',
    publicMessage: 'Address already in use',
  },
  ECONNREFUSED: {
    publicMessage: 'Connection refused',
    laikaCode: 'bad_request',
  },
  ECONNRESET: {
    publicMessage: 'Connection reset by peer',
    laikaCode: 'bad_request',
  },
  EEXIST: {
    publicMessage: 'File exists',
    laikaCode: 'conflict',
  },
  EISDIR: {
    publicMessage: 'Is a directory',
    laikaCode: 'conflict',
  },
  EMFILE: {
    publicMessage: 'Too many open files in system',
    laikaCode: 'service_unavailable',
  },
  ENOENT: {
    publicMessage: 'No such file or directory',
    laikaCode: 'not_found',
  },
  ENOTDIR: {
    publicMessage: 'Not a directory',
    laikaCode: 'bad_request',
  },
  ENOTEMPTY: {
    publicMessage: 'Directory not empty',
    laikaCode: 'conflict',
  },
  ENOTFOUND: {
    publicMessage: 'DNS lookup failed',
    laikaCode: 'not_found',
  },
  EPERM: {
    publicMessage: 'Operation not permitted',
    laikaCode: 'forbidden',
  },
  EPIPE: {
    publicMessage: 'Broken pipe',
    laikaCode: 'bad_request',
  },
  ETIMEDOUT: {
    publicMessage: 'Operation timed out',
    laikaCode: 'gateway_timeout',
  },
} as const satisfies Record<string, { publicMessage: string, laikaCode: ErrorCode }>

export const mapFsErrorToLaikaError = (error: unknown): LaikaError => {
  if (isError(error)) {
    if (error instanceof LaikaError) return error;
    if ('code' in error && typeof error.code === 'string') {
      if (error.code in systemErrors) {
        const { publicMessage: description, laikaCode } = systemErrors[error.code as keyof typeof systemErrors];
        const ErrorClass = ErrorCodeToClassMap[laikaCode];
        return new ErrorClass(description, { cause: error });
      }
    }
  }
  return new InternalError(`An unexpected error occurred while accessing the file system.`, { cause: error });
};
