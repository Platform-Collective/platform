// SPDX-License-Identifier: EPL-2.0

import type { MeasureContext } from '@hcengineering/core'
import puppeteer from 'puppeteer'

import { print } from '../print'
import type { ExportKind } from '../print'

jest.mock('puppeteer', () => ({ __esModule: true, default: { launch: jest.fn() } }), { virtual: true })
jest.mock('../config', () => ({ __esModule: true, default: { PuppeteerArgs: [] } }))

describe('print browser lifecycle', () => {
  const bytes = new Uint8Array([1, 2, 3])
  const page = {
    on: jest.fn().mockReturnThis(),
    setViewport: jest.fn(),
    goto: jest.fn(),
    waitForNetworkIdle: jest.fn(),
    emulateMediaType: jest.fn(),
    evaluate: jest.fn(),
    pdf: jest.fn(),
    screenshot: jest.fn()
  }
  const browser = { newPage: jest.fn(), close: jest.fn() }
  const ctx = {
    info: jest.fn(),
    warn: jest.fn(),
    with: async (_name: string, _attrs: object, action: () => Promise<Uint8Array>) => await action()
  } as unknown as MeasureContext

  beforeEach(() => {
    jest.resetAllMocks()
    jest.mocked(puppeteer).launch.mockResolvedValue(browser as unknown as Awaited<ReturnType<typeof puppeteer.launch>>)
    browser.newPage.mockResolvedValue(page)
    browser.close.mockResolvedValue(undefined)
    page.on.mockReturnThis()
    page.evaluate.mockResolvedValueOnce(undefined).mockResolvedValueOnce('header').mockResolvedValueOnce('footer')
    page.pdf.mockResolvedValue(bytes)
    page.screenshot.mockResolvedValue(bytes)
  })

  it.each<ExportKind>(['pdf', 'png', 'jpeg', 'webp'])('returns %s bytes and closes the browser', async (kind) => {
    await expect(print(ctx, 'https://example.com', { kind })).resolves.toEqual(Buffer.from(bytes))
    expect(browser.close).toHaveBeenCalledTimes(1)
  })

  it.each(['newPage', 'setViewport', 'goto', 'waitForNetworkIdle', 'emulateMediaType', 'evaluate', 'pdf'] as const)(
    'closes the browser when %s fails',
    async (method) => {
      const error = new Error(`${method} failed`)
      const operation = method === 'newPage' ? browser.newPage : page[method]
      operation.mockReset().mockRejectedValue(error)

      await expect(print(ctx, 'https://example.com')).rejects.toBe(error)
      expect(browser.close).toHaveBeenCalledTimes(1)
    }
  )

  it('closes the browser when a screenshot fails', async () => {
    const error = new Error('screenshot failed')
    page.screenshot.mockRejectedValue(error)

    await expect(print(ctx, 'https://example.com', { kind: 'png' })).rejects.toBe(error)
    expect(browser.close).toHaveBeenCalledTimes(1)
  })

  it('preserves the unlimited PDF timeout and layout options', async () => {
    await print(ctx, 'https://example.com', { orientation: 'landscape' })

    expect(page.pdf).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 0,
        format: 'A4',
        landscape: true,
        headerTemplate: 'header',
        footerTemplate: 'footer',
        displayHeaderFooter: true
      })
    )
  })

  it('preserves the print error when browser shutdown also fails', async () => {
    const error = new Error('pdf failed')
    const closeError = new Error('close failed')
    page.pdf.mockRejectedValue(error)
    browser.close.mockRejectedValue(closeError)

    await expect(print(ctx, 'https://example.com')).rejects.toBe(error)
    expect(browser.close).toHaveBeenCalledTimes(1)
    expect(ctx.warn).toHaveBeenCalledWith('browser.close', { message: closeError.message })
  })

  it('propagates browser shutdown failures after successful printing', async () => {
    const error = new Error('close failed')
    browser.close.mockRejectedValue(error)

    await expect(print(ctx, 'https://example.com')).rejects.toBe(error)
    expect(browser.close).toHaveBeenCalledTimes(1)
  })

  it('awaits browser shutdown before completing', async () => {
    let release!: () => void
    let markClosing!: () => void
    const closing = new Promise<void>((resolve) => {
      markClosing = resolve
    })
    browser.close.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve
        markClosing()
      })
    })
    const completed = jest.fn()
    const result = print(ctx, 'https://example.com').then(completed)
    await closing
    expect(browser.close).toHaveBeenCalledTimes(1)
    expect(completed).not.toHaveBeenCalled()
    release()
    await result
    expect(completed).toHaveBeenCalledWith(Buffer.from(bytes))
  })

  it('propagates launch failures without trying to close an uncreated browser', async () => {
    const error = new Error('launch failed')
    jest.mocked(puppeteer).launch.mockRejectedValue(error)

    await expect(print(ctx, 'https://example.com')).rejects.toBe(error)
    expect(browser.close).not.toHaveBeenCalled()
  })
})
