type LogMeta = Record<string, unknown>;

function log(level: "INFO" | "WARN" | "ERROR", message: string, meta?: LogMeta): void {
  const timestamp = new Date().toISOString();
  if (meta && Object.keys(meta).length > 0) {
    console.log(`[${timestamp}] [${level}] ${message}`, meta);
    return;
  }

  console.log(`[${timestamp}] [${level}] ${message}`);
}

export const logger = {
  info(message: string, meta?: LogMeta): void {
    log("INFO", message, meta);
  },
  warn(message: string, meta?: LogMeta): void {
    log("WARN", message, meta);
  },
  error(message: string, meta?: LogMeta): void {
    log("ERROR", message, meta);
  }
};
