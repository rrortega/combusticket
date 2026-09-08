import { ENV } from '../config/env.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITIES: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function formatPrefix(level: LogLevel, category?: string): string {
  const ts = new Date().toISOString();
  const lvl = level.toUpperCase().padEnd(5);
  const cat = category ? ` [${category}]` : '';
  return `[${ts}] [${lvl}]${cat}`;
}

export class Logger {
  public static isDebugEnabled(): boolean {
    return ENV.DEBUG || ENV.LOG_LEVEL === 'debug';
  }

  public static debug(category: string, message: string, ...args: any[]): void {
    if (this.isDebugEnabled()) {
      console.log(`${formatPrefix('debug', category)} ${message}`, ...args);
    }
  }

  public static info(category: string, message: string, ...args: any[]): void {
    console.log(`${formatPrefix('info', category)} ${message}`, ...args);
  }

  public static warn(category: string, message: string, ...args: any[]): void {
    console.warn(`${formatPrefix('warn', category)} ${message}`, ...args);
  }

  public static error(category: string, message: string, ...args: any[]): void {
    console.error(`${formatPrefix('error', category)} ${message}`, ...args);
  }

  public static step(category: string, stepNum: string | number, message: string, ...args: any[]): void {
    console.log(`${formatPrefix('info', category)} ➡️ [Step ${stepNum}] ${message}`, ...args);
  }
}
