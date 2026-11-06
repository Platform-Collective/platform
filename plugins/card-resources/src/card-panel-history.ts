// SPDX-License-Identifier: EPL-2.0

export interface PanelLocation {
  fragment: string
  _id: string
  _class: string
}

export function getPanelLocation (fragment: string | undefined, component: unknown): PanelLocation | undefined {
  if (fragment === undefined || fragment === '') return

  try {
    const [panelComponent, _id, _class] = decodeURIComponent(fragment).split('|')
    if (panelComponent !== component || _id === undefined || _class === undefined) return

    return { fragment, _id, _class }
  } catch {
    return undefined
  }
}

export class PanelHistory {
  private current: string | undefined
  private readonly items: string[] = []

  update (fragment: string | undefined): void {
    if (fragment === this.current) return

    if (fragment === undefined) {
      this.current = undefined
      this.items.length = 0
      return
    }

    if (fragment === this.items[this.items.length - 1]) {
      this.items.pop()
      this.current = fragment
      return
    }

    if (this.current !== undefined) {
      this.items.push(this.current)
    }
    this.current = fragment
  }

  back (): string | undefined {
    const fragment = this.items.pop()
    this.current = fragment
    return fragment
  }
}

export const cardPanelHistory = new PanelHistory()
