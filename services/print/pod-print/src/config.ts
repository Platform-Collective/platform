//
// Copyright © 2024 Hardcore Engineering Inc.
//

import { config as dotenvConfig } from 'dotenv'

dotenvConfig()

export interface Config {
  Port: number
  Secret: string
  AccountsUrl: string
  FrontUrl: string
  AllowedHostnames: string[]
  PuppeteerArgs: string[]
  GotenbergUrl: string
  PrintConcurrency: number
  PrintTimeoutMs: number
  PageInitTimeoutMs: number
  BrowserMaxPages: number
}

const parseNumber = (str: string | undefined): number | undefined => (str !== undefined ? Number(str) : undefined)

const parsePositiveInteger = (str: string | undefined, defaultValue: number): number => {
  const value = parseNumber(str) ?? defaultValue
  if (!Number.isInteger(value) || value <= 0) {
    throw Error(`Invalid positive integer config value: ${str}`)
  }
  return value
}

const parseNonNegativeInteger = (str: string | undefined, defaultValue: number): number => {
  const value = parseNumber(str) ?? defaultValue
  if (!Number.isInteger(value) || value < 0) {
    throw Error(`Invalid non-negative integer config value: ${str}`)
  }
  return value
}

const config: Config = (() => {
  const allowedHostnames = process.env.ALLOWED_HOSTNAMES
  const puppeteerArgs = process.env.PUPPETEER_ARGS ?? ''

  const params: Partial<Config> = {
    Port: parseNumber(process.env.PORT) ?? 4005,
    Secret: process.env.SECRET,
    AccountsUrl: process.env.ACCOUNTS_URL,
    FrontUrl: process.env.FRONT_URL,
    AllowedHostnames: allowedHostnames == null ? [] : allowedHostnames.split(','),
    PuppeteerArgs: puppeteerArgs.split(','),
    GotenbergUrl: process.env.GOTENBERG_URL ?? '',
    PrintConcurrency: parsePositiveInteger(process.env.PRINT_CONCURRENCY, 1),
    // Hard limit for one print job (navigation, rendering, pdf/screenshot)
    PrintTimeoutMs: parsePositiveInteger(process.env.PRINT_TIMEOUT_MS, 120000),
    // Limit for creating or closing a browser context/page in the shared browser
    PageInitTimeoutMs: parsePositiveInteger(process.env.PRINT_PAGE_INIT_TIMEOUT_MS, 5000),
    // Restart the shared browser after this many pages to cap memory growth (0 disables)
    BrowserMaxPages: parseNonNegativeInteger(process.env.PRINT_BROWSER_MAX_PAGES, 100)
  }

  const missingEnv = (Object.keys(params) as Array<keyof Config>).filter((key) => params[key] === undefined)

  if (missingEnv.length > 0) {
    throw Error(`Missing config for attributes: ${missingEnv.join(', ')}`)
  }

  return params as Config
})()

export default config
