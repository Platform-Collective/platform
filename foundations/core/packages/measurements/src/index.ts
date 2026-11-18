export * from './context'
export * from './metrics'
export {
  logReplacer,
  redactUrl,
  safeHttpLogFormat,
  safeLogStringify,
  sanitizeForLog,
  sanitizeLogFields
} from './log-redaction'
export type * from './types'

/**
 * Return a current performance timestamp
 */
export const platformNow: () => number = () => performance.now()

/**
 * Return a diff with previous performance snapshot with 2 digits after . max.
 */
export const platformNowDiff = (old: number): number => Math.round((performance.now() - old) * 100) / 100
