// SPDX-License-Identifier: EPL-2.0
import { resolve } from 'node:path'
import { componentRuntime, type ComponentConstructor } from './svelte-component'

describe('CheckBox accessibility', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('exposes the localized label as the input accessible name', async () => {
    const runtime = componentRuntime()
    const labels: Record<string, string> = {
      'view:string.Archive': 'Archive',
      'view:string.UnArchive': 'Unarchive'
    }
    runtime.modules.set('@hcengineering/platform', {
      translateCB: (
        label: string,
        _params: Record<string, unknown>,
        _language: string | undefined,
        resolve: (value: string) => void
      ) => {
        resolve(labels[label] ?? label)
      }
    })
    runtime.modules.set('@hcengineering/theme', {
      themeStore: {
        subscribe: (run: (value: { language: string }) => void) => {
          run({ language: 'en' })
          return () => {}
        }
      }
    })

    const CheckBox = runtime.load(resolve(__dirname, '../components/CheckBox.svelte')).default as ComponentConstructor
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = new CheckBox({ target, props: { label: 'view:string.Archive' } })
    await runtime.tick()

    try {
      expect(target.querySelector('input')?.getAttribute('aria-label')).toBe('Archive')
      component.$set({ label: 'view:string.UnArchive' })
      await runtime.tick()
      expect(target.querySelector('input')?.getAttribute('aria-label')).toBe('Unarchive')
    } finally {
      component.$destroy()
    }
  })
})
