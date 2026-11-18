/** @jest-environment jsdom */
// SPDX-License-Identifier: EPL-2.0
import { resolve } from 'node:path'
import { componentRuntime, type ComponentConstructor } from './svelte-component'

describe('RelationsPopup menu events', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('forwards a close event from the relation menu', async () => {
    const runtime = componentRuntime()
    const source = resolve(__dirname, '../components/RelationsPopup.svelte')
    const menu = runtime.evaluate(
      `<script>
        import { createEventDispatcher } from 'svelte'
        export let actions
        const dispatch = createEventDispatcher()
      </script>
      <button on:click={() => dispatch('close')}>Close relations</button>`,
      resolve(__dirname, 'relations-menu.svelte')
    ).default
    runtime.modules.set('@hcengineering/core', {})
    runtime.modules.set('@hcengineering/platform', { getResource: jest.fn() })
    runtime.modules.set('@hcengineering/presentation', {
      getClient: () => ({}),
      createQuery: () => ({ query: () => {} }),
      ObjectSearchPopup: {}
    })
    runtime.modules.set('@hcengineering/ui', { Menu: menu, closePopup: jest.fn(), showPopup: jest.fn() })
    runtime.modules.set('@hcengineering/tracker', {})
    runtime.modules.set('@hcengineering/activity', { default: {} })
    runtime.modules.set(resolve(source, '../../issues'), { updateIssueRelation: jest.fn() })
    runtime.modules.set(resolve(source, '../../plugin'), {
      default: {
        icon: { Issue: '' },
        string: {
          AddBlockedBy: 'Add blocked by',
          AddIsBlocking: 'Add is blocking',
          AddRelatedIssue: 'Add related issue',
          RemoveRelation: 'Remove relation',
          BlockedBySearchPlaceholder: 'Blocked by',
          IsBlockingSearchPlaceholder: 'Is blocking',
          RelatedIssueSearchPlaceholder: 'Related issue'
        }
      }
    })

    const Relations = runtime.load(source).default as ComponentConstructor
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = new Relations({
      target,
      props: { value: { _id: 'issue', _class: 'Issue', blockedBy: [{ _id: 'other', _class: 'Issue' }] } }
    })
    const closed = jest.fn()
    component.$on('close', closed)
    try {
      await runtime.tick()
      target.querySelector('button')?.click()
      await runtime.tick()
      expect(closed).toHaveBeenCalledTimes(1)
    } finally {
      component.$destroy()
    }
  })
})
