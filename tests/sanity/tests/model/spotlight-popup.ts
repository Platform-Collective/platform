import { type Locator, type Page, expect } from '@playwright/test'
import { CommonPage } from './common-page'
import { StatusBar } from './statusbar'

const RETRY_OPTIONS = { intervals: [1000, 1500, 2500], timeout: 60_000 }

export class SpotlightPopup extends CommonPage {
  readonly page: Page
  readonly statusbar: StatusBar

  constructor (page: Page) {
    super(page)
    this.page = page
    this.statusbar = new StatusBar(page)
  }

  popup = (): Locator => this.page.locator('div.popup')
  input = (): Locator => this.popup().locator('input')
  searchResult = (search: string): Locator => this.popup().locator('div.list-item', { hasText: search })

  async open (): Promise<void> {
    const visible = await this.popup().isVisible()
    if (visible) {
      await this.close()
    }
    await this.statusbar.clickButtonSearch()
    await expect(this.popup()).toBeVisible()
  }

  async close (): Promise<void> {
    await this.page.keyboard.press('Escape')
    await expect(this.popup()).not.toBeVisible()
  }

  async fillSearchInput (search: string): Promise<void> {
    await this.input().fill(search)
    await expect(this.input()).toHaveValue(search)
    await this.page.waitForTimeout(500)
  }

  async checkSearchResult (search: string, count: number, timeout?: number): Promise<void> {
    await expect(this.searchResult(search)).toHaveCount(count, { timeout })
  }

  /** Repeats the search so each attempt can observe newly indexed data. */
  async searchAndCheck (query: string, result: string, count: number): Promise<void> {
    await expect(async () => {
      await this.open()
      try {
        await this.fillSearchInput(query)
        await this.checkSearchResult(result, count, 3000)
      } finally {
        await this.close()
      }
    }).toPass(RETRY_OPTIONS)
  }
}
