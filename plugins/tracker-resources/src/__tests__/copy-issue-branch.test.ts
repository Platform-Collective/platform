// SPDX-License-Identifier: EPL-2.0

import type { Issue } from '@hcengineering/tracker'
import { copyTextToClipboard } from '@hcengineering/presentation'
import { addNotification } from '@hcengineering/ui'
import { copyIssueBranch } from '../copy-issue-branch'

jest.mock('@hcengineering/platform', () => ({ translate: jest.fn(async () => 'Copied') }), { virtual: true })
jest.mock('@hcengineering/presentation', () => ({ copyTextToClipboard: jest.fn() }), { virtual: true })
jest.mock('@hcengineering/ui', () => ({ addNotification: jest.fn() }), { virtual: true })
jest.mock('@hcengineering/view', () => ({ __esModule: true, default: { string: { Copied: 'view:string:Copied' } } }), {
  virtual: true
})
jest.mock('@hcengineering/view-resources', () => ({ SimpleNotification: 'SimpleNotification' }), { virtual: true })

describe('copyIssueBranch', () => {
  beforeEach(() => jest.clearAllMocks())

  it('copies the generated name and then shows a success notification without changing the issue', async () => {
    const issue = Object.freeze({ identifier: 'TSK-123', title: 'Fix login redirect', status: 'open' }) as Issue
    let finishCopy: (() => void) | undefined
    jest.mocked(copyTextToClipboard).mockImplementationOnce(
      async () => { await new Promise<void>((resolve) => {
          finishCopy = resolve
        }); }
    )

    const result = copyIssueBranch(issue)
    expect(copyTextToClipboard).toHaveBeenCalledWith('tsk-123-fix-login-redirect')
    expect(addNotification).not.toHaveBeenCalled()
    finishCopy?.()
    await result

    expect(addNotification).toHaveBeenCalledWith('Copied', 'tsk-123-fix-login-redirect', 'SimpleNotification')
    expect(issue.status).toBe('open')
  })

  it('does nothing for an empty selection', async () => {
    await copyIssueBranch([])
    await copyIssueBranch(undefined)
    expect(copyTextToClipboard).not.toHaveBeenCalled()
    expect(addNotification).not.toHaveBeenCalled()
  })

  it('handles clipboard failures without reporting success', async () => {
    const error = new Error('Clipboard permission denied')
    jest.mocked(copyTextToClipboard).mockRejectedValueOnce(error)
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const issue = { identifier: 'TSK-123', title: 'Fix login redirect' }
      await copyIssueBranch(issue as Issue)
      expect(addNotification).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith('Failed to copy Git branch name', error)
    } finally {
      log.mockRestore()
    }
  })
})
