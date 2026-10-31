// SPDX-License-Identifier: EPL-2.0
import type { WorkspaceInfoWithStatus, WorkspaceUuid } from '@hcengineering/core'
import { DAY_MS, workspaceWorkerState } from '../workspace-state'

const now = Date.parse('2026-10-09T00:00:00.000Z')

function info (overrides: Partial<WorkspaceInfoWithStatus> = {}): WorkspaceInfoWithStatus {
  return {
    uuid: 'ws-1' as WorkspaceUuid,
    name: 'ws',
    url: 'ws',
    createdOn: 0,
    versionMajor: 0,
    versionMinor: 7,
    versionPatch: 0,
    mode: 'active',
    processingAttemps: 0,
    lastVisit: now - DAY_MS,
    ...overrides
  }
}

describe('workspaceWorkerState', () => {
  it('connects an active, recently visited workspace', () => {
    expect(workspaceWorkerState(info(), 3, now)).toBe('connect')
  })

  it('skips a missing, disabled, deleting or archived workspace', () => {
    expect(workspaceWorkerState(undefined, 3, now)).toBe('skip')
    expect(workspaceWorkerState(info({ uuid: undefined as unknown as WorkspaceUuid }), 3, now)).toBe('skip')
    expect(workspaceWorkerState(info({ isDisabled: true }), 3, now)).toBe('skip')
    expect(workspaceWorkerState(info({ mode: 'deleting' }), 3, now)).toBe('skip')
    expect(workspaceWorkerState(info({ mode: 'archived' }), 3, now)).toBe('skip')
  })

  it('waits while the workspace is not active (upgrade, creation, restore)', () => {
    expect(workspaceWorkerState(info({ mode: 'upgrading' }), 3, now)).toBe('wait')
    expect(workspaceWorkerState(info({ mode: 'restoring' }), 3, now)).toBe('wait')
  })

  it('is inactive when nobody visited within the interval; 0 turns the check off', () => {
    expect(workspaceWorkerState(info({ lastVisit: now - 4 * DAY_MS }), 3, now)).toBe('inactive')
    expect(workspaceWorkerState(info({ lastVisit: undefined }), 3, now)).toBe('inactive')
    expect(workspaceWorkerState(info({ lastVisit: now - 400 * DAY_MS }), 0, now)).toBe('connect')
  })
})
