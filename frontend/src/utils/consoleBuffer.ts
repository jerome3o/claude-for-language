/**
 * Console log buffer for debugging and bug reports
 * Captures last ~200 console logs and persists them to localStorage
 */

const BUFFER_SIZE = 200;
const STORAGE_KEY = 'console-log-buffer';

export interface LogEntry {
  timestamp: string;
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  args: unknown[];
}

class ConsoleBuffer {
  private buffer: LogEntry[] = [];
  private originalConsole: {
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
    info: typeof console.info;
    debug: typeof console.debug;
  };

  constructor() {
    // Store original console methods
    this.originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
      debug: console.debug,
    };

    // Load existing buffer from localStorage
    this.loadFromStorage();

    // Intercept console methods
    this.interceptConsole();
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.buffer = JSON.parse(stored);
        // Keep only last BUFFER_SIZE entries
        if (this.buffer.length > BUFFER_SIZE) {
          this.buffer = this.buffer.slice(-BUFFER_SIZE);
        }
      }
    } catch {
      // Ignore errors loading from storage
      this.buffer = [];
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.buffer));
    } catch {
      // Ignore errors saving to storage
    }
  }

  private addEntry(level: LogEntry['level'], args: unknown[]) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      args: this.serializeArgs(args),
    };

    this.buffer.push(entry);

    // Keep buffer size under limit
    if (this.buffer.length > BUFFER_SIZE) {
      this.buffer.shift();
    }

    // Persist to storage
    this.saveToStorage();
  }

  private serializeArgs(args: unknown[]): unknown[] {
    return args.map(arg => {
      try {
        // Handle various types
        if (arg === null || arg === undefined) return arg;
        if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') {
          return arg;
        }
        if (arg instanceof Error) {
          return {
            name: arg.name,
            message: arg.message,
            stack: arg.stack,
          };
        }
        // For objects, create a shallow serializable copy
        if (typeof arg === 'object') {
          // Limit object size to prevent storage issues
          const str = JSON.stringify(arg);
          if (str.length > 1000) {
            return `[Object: ${str.substring(0, 100)}...]`;
          }
          return JSON.parse(str);
        }
        return String(arg);
      } catch {
        return '[Unserializable]';
      }
    });
  }

  private interceptConsole() {
    console.log = (...args: unknown[]) => {
      this.addEntry('log', args);
      this.originalConsole.log(...args);
    };

    console.warn = (...args: unknown[]) => {
      this.addEntry('warn', args);
      this.originalConsole.warn(...args);
    };

    console.error = (...args: unknown[]) => {
      this.addEntry('error', args);
      this.originalConsole.error(...args);
    };

    console.info = (...args: unknown[]) => {
      this.addEntry('info', args);
      this.originalConsole.info(...args);
    };

    console.debug = (...args: unknown[]) => {
      this.addEntry('debug', args);
      this.originalConsole.debug(...args);
    };
  }

  /**
   * Get all buffered logs
   */
  public getLogs(): LogEntry[] {
    return [...this.buffer];
  }

  /**
   * Get logs formatted as a string for bug reports
   */
  public getLogsAsString(): string {
    return this.buffer.map(entry => {
      const timestamp = new Date(entry.timestamp).toLocaleTimeString();
      const level = entry.level.toUpperCase().padEnd(5);
      const argsStr = entry.args.map(arg => {
        if (typeof arg === 'object') {
          return JSON.stringify(arg);
        }
        return String(arg);
      }).join(' ');
      return `[${timestamp}] ${level} ${argsStr}`;
    }).join('\n');
  }

  /**
   * Clear all buffered logs
   */
  public clear() {
    this.buffer = [];
    this.saveToStorage();
  }
}

// Create singleton instance
let bufferInstance: ConsoleBuffer | null = null;

/**
 * Initialize the console buffer (call this early in app initialization)
 */
export function initConsoleBuffer(): void {
  if (!bufferInstance) {
    bufferInstance = new ConsoleBuffer();
  }
}

/**
 * Get the console buffer instance
 */
export function getConsoleBuffer(): ConsoleBuffer | null {
  return bufferInstance;
}
