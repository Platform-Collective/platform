// SPDX-License-Identifier: EPL-2.0

import { CONTENT_NOTICE_KEY, CONTENT_NOTICE_MAP } from '@hcengineering/collaborator-client'
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs'
import { observeContentNotices } from './notices'

describe('observeContentNotices', () => {
  it('delivers a notice received after synchronization', () => {
    const source = new Doc()
    const target = new Doc()
    const callback = jest.fn()
    const stop = observeContentNotices(target, () => true, callback)

    source.getMap(CONTENT_NOTICE_MAP).set(CONTENT_NOTICE_KEY, {
      type: 'document-restored',
      params: { title: 'Snapshot', name: 'Restorer' }
    })
    applyUpdate(target, encodeStateAsUpdate(source))

    expect(callback).toHaveBeenCalledWith({
      type: 'document-restored',
      params: { title: 'Snapshot', name: 'Restorer' }
    })
    stop()
  })

  it('ignores notices present during initial synchronization and stops observing', () => {
    const ydoc = new Doc()
    const callback = jest.fn()
    let synced = false
    const stop = observeContentNotices(ydoc, () => synced, callback)
    const notices = ydoc.getMap(CONTENT_NOTICE_MAP)

    notices.set(CONTENT_NOTICE_KEY, { type: 'initial', params: {} })
    expect(callback).not.toHaveBeenCalled()

    synced = true
    notices.set(CONTENT_NOTICE_KEY, { type: 'latest', params: {} })
    expect(callback).toHaveBeenCalledTimes(1)

    stop()
    notices.set(CONTENT_NOTICE_KEY, { type: 'later', params: {} })
    expect(callback).toHaveBeenCalledTimes(1)
  })
})
