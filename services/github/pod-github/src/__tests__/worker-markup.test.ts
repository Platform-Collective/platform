// SPDX-License-Identifier: EPL-2.0

import contact from '@hcengineering/contact'
import { MarkupMarkType, MarkupNodeType, markupToJSON, type MarkupNode } from '@hcengineering/text'
import type { IntegrationContainer } from '../types'

jest.mock('@octokit/webhooks-types', () => ({}), { virtual: true })
jest.mock('octokit', () => ({}))
jest.mock('../config', () => ({ default: {} }))
jest.mock('../platform', () => ({}))
jest.mock('../client', () => ({}))
jest.mock('../collaborator', () => ({}))
jest.mock('../notifications', () => ({}))
jest.mock('../sync/users', () => ({}))
jest.mock('@hcengineering/server-client', () => ({}))
jest.mock('@hcengineering/server-guest-resources', () => ({
  getPublicLinkUrl: () => 'https://front.example/guest/workspace-url'
}))

import { GithubWorker } from '../worker'

const PERSON_URL = 'https://front.example/workbench/workspace-url/contact/'
const KNOWN_ID = '63204fc031b9728f9e6b2e1a'
const UNKNOWN_ID = '63204fc031b9728f9e6b2e1b'
const LABEL = 'Linked Person'

function setup (findAll: jest.Mock): { worker: GithubWorker, warn: jest.Mock } {
  const warn = jest.fn()
  const worker: GithubWorker = Object.assign(Object.create(GithubWorker.prototype), {
    _client: { findAll },
    ctx: { warn, error: jest.fn(), info: jest.fn() },
    workspace: { uuid: 'workspace-uuid', url: 'workspace-url' },
    branding: { front: 'https://front.example' }
  })
  return { worker, warn }
}

function firstInline (markup: string): MarkupNode | undefined {
  return markupToJSON(markup).content?.[0].content?.[0]
}

async function getMarkup (worker: GithubWorker, id: string): Promise<string> {
  return await worker.getMarkup({} as unknown as IntegrationContainer, `[${LABEL}](${PERSON_URL}${id})`)
}

describe('GithubWorker.getMarkup contact links', () => {
  it('looks up the ids as Persons in one query and keeps unknown ids as links', async () => {
    const findAll = jest.fn().mockResolvedValue([{ _id: KNOWN_ID }])
    const { worker } = setup(findAll)

    const markup = await worker.getMarkup(
      {} as unknown as IntegrationContainer,
      `[${LABEL}](${PERSON_URL}${KNOWN_ID}) [${LABEL}](${PERSON_URL}${UNKNOWN_ID})`
    )

    expect(findAll).toHaveBeenCalledTimes(1)
    expect(findAll).toHaveBeenCalledWith(
      contact.class.Person,
      { _id: { $in: [KNOWN_ID, UNKNOWN_ID] } },
      { projection: { _id: 1 } }
    )
    const nodes = markupToJSON(markup).content?.[0].content?.filter((it) => it.text !== ' ')
    expect(nodes?.[0]).toMatchObject({
      type: MarkupNodeType.reference,
      attrs: { id: KNOWN_ID, objectclass: contact.class.Person, label: LABEL }
    })
    expect(nodes?.[1]).toMatchObject({
      type: MarkupNodeType.text,
      marks: [{ type: MarkupMarkType.link, attrs: { href: `${PERSON_URL}${UNKNOWN_ID}` } }]
    })
  })

  it('keeps the link and logs without content when the lookup fails', async () => {
    const findAll = jest.fn().mockRejectedValue(new Error(`lookup failed for ${KNOWN_ID}`))
    const { worker, warn } = setup(findAll)

    const markup = await getMarkup(worker, KNOWN_ID)

    expect(firstInline(markup)).toMatchObject({
      type: MarkupNodeType.text,
      text: LABEL,
      marks: [{ type: MarkupMarkType.link, attrs: { href: `${PERSON_URL}${KNOWN_ID}` } }]
    })
    expect(warn).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(warn.mock.calls[0])
    expect(logged).not.toContain(KNOWN_ID)
    expect(logged).not.toContain(LABEL)
  })

  it('does not query for ids with control characters', async () => {
    const findAll = jest.fn().mockResolvedValue([])
    const { worker } = setup(findAll)

    const markup = await getMarkup(worker, '%00')

    expect(findAll).not.toHaveBeenCalled()
    expect(firstInline(markup)).toMatchObject({ type: MarkupNodeType.text, marks: [{ type: MarkupMarkType.link }] })
  })
})
