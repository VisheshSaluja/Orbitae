type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const CURRENT_LEVEL: LogLevel = import.meta.env.DEV ? 'debug' : 'warn';

function shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[CURRENT_LEVEL];
}

export const logger = {
    debug: (message: string, ...args: unknown[]) => {
        if (shouldLog('debug')) console.debug(`[Orbitae] ${message}`, ...args);
    },
    info: (message: string, ...args: unknown[]) => {
        if (shouldLog('info')) console.info(`[Orbitae] ${message}`, ...args);
    },
    warn: (message: string, ...args: unknown[]) => {
        if (shouldLog('warn')) console.warn(`[Orbitae] ${message}`, ...args);
    },
    error: (message: string, ...args: unknown[]) => {
        if (shouldLog('error')) console.error(`[Orbitae] ${message}`, ...args);
    },
};
