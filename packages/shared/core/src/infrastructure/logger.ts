/**
 * Logger interface for internal error logging
 * Implementations should handle logging to appropriate destinations
 * (console, file, external service, etc.)
 */
export interface Logger {
  error(message: string, error?: unknown): void;
  warn(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
}

/**
 * No-op logger that does nothing
 * Useful for testing or when logging is not needed
 */
export class NoOpLogger implements Logger {
  error(_message: string, _error?: unknown): void {}
  warn(_message: string, _data?: unknown): void {}
  info(_message: string, _data?: unknown): void {}
  debug(_message: string, _data?: unknown): void {}
}

/**
 * Console logger that logs to console
 * Default implementation for development
 */
export class ConsoleLogger implements Logger {
  error(message: string, error?: unknown): void {
    console.error(message, error);
  }
  
  warn(message: string, data?: unknown): void {
    console.warn(message, data);
  }
  
  info(message: string, data?: unknown): void {
    console.info(message, data);
  }
  
  debug(message: string, data?: unknown): void {
    console.debug(message, data);
  }
}
