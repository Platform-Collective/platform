// SPDX-License-Identifier: EPL-2.0

import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import Plyr from 'plyr'
import { compileString } from 'sass'
import { compile } from 'svelte/compiler'

describe.each([
  ['Video', resolve(__dirname, '../components/Video.svelte')],
  ['HlsVideo', resolve(__dirname, '../../../hls/src/components/HlsVideo.svelte')]
])('%s portrait controls', (_component, filename) => {
  let player: Plyr | undefined
  const textTrackDescriptor = Object.getOwnPropertyDescriptor(window, 'TextTrack')

  beforeAll(() => {
    jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    Object.defineProperty(window, 'TextTrack', { configurable: true, value: jest.fn() })
  })

  afterEach(() => {
    player?.destroy()
    player = undefined
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  afterAll(() => {
    jest.restoreAllMocks()
    if (textTrackDescriptor === undefined) {
      Reflect.deleteProperty(window, 'TextTrack')
    } else {
      Object.defineProperty(window, 'TextTrack', textTrackDescriptor)
    }
  })

  it('renders the visible controls after the video despite Plyr DOM order', () => {
    const source = readFileSync(filename, 'utf8')
    const style = source.match(/<style lang="scss">([\s\S]*?)<\/style>/)?.[1]
    if (style === undefined) {
      throw new Error(`Missing component styles: ${filename}`)
    }

    // Compile the component overrides and load the actual Plyr stylesheet separately.
    const css = compileString(style.replace("@import 'plyr/dist/plyr.css';", '')).css
    const compiledCss = compile(`<video class="portrait"></video><style>${css}</style>`, { generate: 'dom' }).css?.code
    if (compiledCss === undefined) {
      throw new Error(`Failed to compile component styles: ${filename}`)
    }
    const plyrCss = readFileSync(resolve(dirname(require.resolve('plyr')), 'plyr.css'), 'utf8')
    document.head.innerHTML = `<style>${plyrCss}\n${compiledCss}</style>`
    document.body.innerHTML = '<video class="portrait"></video>'
    const video = document.querySelector('video')
    if (video === null) {
      throw new Error('Missing video fixture')
    }
    player = new Plyr(video, { loadSprite: false })

    const controls = document.querySelector('.plyr__controls')
    const wrapper = document.querySelector('.plyr__video-wrapper')
    const container = document.querySelector('.plyr')
    if (controls === null || wrapper === null || container === null) {
      throw new Error('Plyr did not create the expected player markup')
    }

    expect(controls.compareDocumentPosition(wrapper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(getComputedStyle(container).display).toBe('flex')
    expect(getComputedStyle(container).flexDirection).toBe('column')
    expect(getComputedStyle(controls).position).toBe('static')
    expect(Number(getComputedStyle(controls).order)).toBeGreaterThan(Number(getComputedStyle(wrapper).order))
    expect(getComputedStyle(controls).opacity).toBe('1')
  })
})
