// SPDX-License-Identifier: EPL-2.0
import { integrationCardStateOf } from '../integration-card'

describe('integrationCardStateOf', () => {
  it('is idle without an integration to show', () => {
    expect(integrationCardStateOf({ hasUser: false, answered: false, loadFailed: false })).toEqual({
      isLoading: false,
      hasError: false
    })
  })

  it('is loading until the query answers', () => {
    expect(integrationCardStateOf({ hasUser: true, answered: false, loadFailed: false })).toEqual({
      isLoading: true,
      hasError: false
    })
  })

  it('shows the error instead of loading when the probe lookup failed', () => {
    expect(integrationCardStateOf({ hasUser: true, answered: false, loadFailed: true })).toEqual({
      isLoading: false,
      hasError: true
    })
  })

  it('ignores a failed probe once the live query has answered', () => {
    expect(integrationCardStateOf({ hasUser: true, answered: true, loadFailed: true })).toEqual({
      isLoading: false,
      hasError: false
    })
  })

  it('is loaded and healthy once answered', () => {
    expect(integrationCardStateOf({ hasUser: true, answered: true, loadFailed: false })).toEqual({
      isLoading: false,
      hasError: false
    })
  })

  it('shows the error the integration itself carries', () => {
    expect(
      integrationCardStateOf({ hasUser: true, answered: true, loadFailed: false, integrationError: 'revoked' })
    ).toEqual({ isLoading: false, hasError: true })
  })
})
