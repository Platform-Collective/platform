// SPDX-License-Identifier: EPL-2.0

import type { BlobMetadata } from '@hcengineering/core'
import { getFilePreviewProps } from '../file-preview-props'

const hostKeys = ['value', 'name', 'contentType', 'metadata', 'fit', 'setLoading'] as const

function hostProps (): {
  value: string
  name: string | undefined
  contentType: string
  metadata: BlobMetadata | undefined
  fit: boolean
  setLoading: ((loading: boolean) => void) | undefined
} {
  return {
    value: 'host-blob',
    name: 'original.txt',
    contentType: 'text/plain',
    metadata: { originalWidth: 123 },
    fit: false,
    setLoading: (loading: boolean): void => {}
  }
}

describe('FilePreview viewer props contract', () => {
  it('forwards registration configuration with reference identity', () => {
    const worker = (): void => {}
    const configuration = { mode: 'formatted' }
    const result = getFilePreviewProps({ format: 'registered-format', worker, configuration }, {}, hostProps())

    expect(result.format).toBe('registered-format')
    expect(result.worker).toBe(worker)
    expect(result.configuration).toBe(configuration)
  })

  it('lets callers override ordinary registration defaults, including undefined', () => {
    const worker = (): void => {}
    const result = getFilePreviewProps(
      { format: 'default', worker: (): void => {}, option: true },
      { format: 'caller', worker, option: undefined },
      hostProps()
    )

    expect(result.format).toBe('caller')
    expect(result.worker).toBe(worker)
    expect(result).toHaveProperty('option', undefined)
  })

  it.each(hostKeys)('keeps the host %s over both other sources', (key) => {
    const host = hostProps()
    const result = getFilePreviewProps({ [key]: 'registration-spoof' }, { [key]: 'caller-spoof' }, host)

    expect(result[key]).toBe(host[key])
  })

  it.each(hostKeys)('keeps an explicit undefined host %s over both other sources', (key) => {
    const host = Object.assign(hostProps(), { [key]: undefined })
    const result = getFilePreviewProps({ [key]: 'registration-spoof' }, { [key]: 'caller-spoof' }, host)

    expect(result).toHaveProperty(key, undefined)
  })

  it('preserves an absent filename without substituting the blob identifier', () => {
    const host = { ...hostProps(), name: undefined }
    const result = getFilePreviewProps({ name: 'registered.txt' }, { name: 'caller.txt' }, host)

    expect(result.name).toBeUndefined()
    expect(result.value).toBe(host.value)
  })

  it('does not mutate frozen input objects and returns a fresh props object', () => {
    const registration = Object.freeze({ format: 'default', registrationOnly: true })
    const caller = Object.freeze({ format: 'caller', callerOnly: true })
    const host = Object.freeze(hostProps())
    const originalHost = { ...host }
    const result = getFilePreviewProps(registration, caller, host)

    expect(result).not.toBe(registration)
    expect(result).not.toBe(caller)
    expect(result).not.toBe(host)
    expect(registration).toEqual({ format: 'default', registrationOnly: true })
    expect(caller).toEqual({ format: 'caller', callerOnly: true })
    expect(host).toEqual(originalHost)
    expect(result.registrationOnly).toBe(true)
    expect(result.callerOnly).toBe(true)
  })

  it('accepts registrations without optional defaults', () => {
    const host = hostProps()
    const result = getFilePreviewProps(undefined, { format: 'caller' }, host)

    expect(result).toEqual({ format: 'caller', ...host })
  })
})

