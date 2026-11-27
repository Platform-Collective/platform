// SPDX-License-Identifier: EPL-2.0
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileString } from 'sass'
import { componentRuntime, type ComponentConstructor } from './svelte-component'

describe('ShowMore', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('keeps the expanded content and toggle in one positioned container', async () => {
    const runtime = componentRuntime()
    const source = resolve(__dirname, '../components/ShowMore.svelte')
    const label = runtime.evaluate(
      '<script>export let label;</script>{label}',
      resolve(__dirname, 'show-more-label.svelte')
    ).default
    runtime.modules.set(resolve(__dirname, '../components/Label.svelte'), { default: label })
    runtime.modules.set(resolve(__dirname, '../plugin'), {
      default: { string: { ShowLess: 'Show less', ShowMore: 'Show more' } }
    })
    runtime.modules.set(resolve(__dirname, '../resize'), { resizeObserver: () => ({ destroy: () => {} }) })

    const ShowMore = runtime.load(source).default as ComponentConstructor
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = new ShowMore({ target, props: { bigger: true } })
    await runtime.tick()

    try {
      const container = target.querySelector('.showMore-container')
      expect(container).not.toBeNull()
      expect(container?.classList.contains('relative')).toBe(true)

      const style = readFileSync(source, 'utf8').match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1]
      expect(style).toBeDefined()
      const css = compileString(style ?? '').css
      expect(css).toMatch(/\.showMore-container\s*\{[^}]*display:\s*flow-root;/)

      const toggle = target.querySelector<HTMLElement>('.showMore')
      const content = target.querySelector('.showMore-content')
      expect(toggle).not.toBeNull()
      expect(content?.classList.contains('crop')).toBe(true)

      toggle?.click()
      await runtime.tick()
      expect(content?.classList.contains('full')).toBe(true)
      expect(content?.classList.contains('crop')).toBe(false)

      toggle?.click()
      await runtime.tick()
      expect(content?.classList.contains('crop')).toBe(true)
      expect(content?.classList.contains('full')).toBe(false)
    } finally {
      component.$destroy()
    }
  })
})
