// SPDX-License-Identifier: EPL-2.0

import { registerMermaidIconPacks } from './mermaid-icon-packs'

describe('registerMermaidIconPacks', () => {
  it('registers bundled icon packs only once', async () => {
    const registerIconPacks = jest.fn()
    const mermaid = { registerIconPacks }

    registerMermaidIconPacks(mermaid)
    registerMermaidIconPacks(mermaid)

    expect(registerIconPacks).toHaveBeenCalledTimes(1)
    expect(registerIconPacks).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'logos', loader: expect.any(Function) }),
      expect.objectContaining({ name: 'mdi', loader: expect.any(Function) })
    ])

    const iconPacks = registerIconPacks.mock.calls[0][0]

    await expect(iconPacks[0].loader()).resolves.toMatchObject({ prefix: 'logos' })
    await expect(iconPacks[1].loader()).resolves.toMatchObject({ prefix: 'mdi' })
  })
})
