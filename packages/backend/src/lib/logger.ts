export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return "";
  return ` ${JSON.stringify(meta, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  )}`;
}

export function createLogger(level: LogLevel, scope = "chronoflow"): Logger {
  const threshold = LEVELS[level];

  const emit = (levelName: Exclude<LogLevel, "silent">, stream: NodeJS.WriteStream) => {
    return (message: string, meta?: Record<string, unknown>) => {
      if (LEVELS[levelName] < threshold) return;
      const timestamp = new Date().toISOString();
      stream.write(
        `${timestamp} ${levelName.toUpperCase().padEnd(5)} [${scope}] ${message}${formatMeta(meta)}\n`,
      );
    };
  };

  const logger: Logger = {
    debug: emit("debug", process.stdout),
    info: emit("info", process.stdout),
    warn: emit("warn", process.stderr),
    error: emit("error", process.stderr),
    child: (childScope: string) => createLogger(level, `${scope}:${childScope}`),
  };

  return logger;
}
