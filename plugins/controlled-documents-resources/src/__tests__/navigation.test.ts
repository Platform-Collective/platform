// SPDX-License-Identifier: EPL-2.0

import documents, { documentsId } from '@hcengineering/controlled-documents'
import { getClient } from '@hcengineering/presentation'
import { getPanelURI, type Location } from '@hcengineering/ui'
import { accessDeniedStore } from '@hcengineering/view-resources'
import { resolveLocation } from '../navigation'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/ui', () => ({ getPanelURI: jest.fn() }))
jest.mock('@hcengineering/view-resources', () => ({ accessDeniedStore: { set: jest.fn() } }))

describe('resolveLocation', () => {
  const findOne = jest.fn()
  const classHierarchyMixin = jest.fn()
  const doc = { _id: 'document-id', _class: documents.class.ControlledDocument }
  const projectDoc = { _id: 'project-document-id', _class: documents.class.ProjectDocument }

  function location (...path: string[]): Location {
    return { path: ['workbench', 'workspace', documentsId, ...path] }
  }

  beforeEach(() => {
    jest.resetAllMocks()
    jest.mocked(getClient).mockReturnValue({
      findOne,
      getHierarchy: () => ({ classHierarchyMixin })
    } as unknown as ReturnType<typeof getClient>)
    jest.mocked(getPanelURI).mockReturnValue('document-panel')
  })

  it.each(['categories', 'library', 'templates', 'my-documents', 'space-browser'])(
    'leaves the %s navigator route unresolved without looking up a document',
    async (route) => {
      for (const loc of [location(route), location(route, 'all')]) {
        const original = { path: [...loc.path] }

        expect(await resolveLocation(loc)).toBeUndefined()
        expect(loc).toEqual(original)
      }
      expect(findOne).not.toHaveBeenCalled()
      expect(getClient).not.toHaveBeenCalled()
      expect(accessDeniedStore.set).not.toHaveBeenCalled()
    }
  )

  it('ignores other applications and the application root', async () => {
    expect(await resolveLocation({ path: ['workbench', 'workspace', 'other-app', 'document-id'] })).toBeUndefined()
    expect(await resolveLocation(location())).toBeUndefined()
    expect(findOne).not.toHaveBeenCalled()
    expect(accessDeniedStore.set).not.toHaveBeenCalled()
  })

  it.each(['document-id', 'document-title---document-id', 'title---with---document-id', 'categories---document-id'])(
    'resolves the document link %s',
    async (link) => {
      findOne.mockResolvedValue(doc)

      expect(await resolveLocation(location(link))).toEqual({
        loc: { path: ['workbench', 'workspace'], fragment: 'document-panel' },
        defaultLocation: { path: ['workbench', 'workspace', documentsId, 'library'], fragment: 'document-panel' }
      })
      expect(findOne).toHaveBeenCalledWith(documents.class.ControlledDocument, { _id: doc._id }, { showArchived: true })
      expect(getPanelURI).toHaveBeenCalledWith(expect.anything(), doc._id, doc._class, 'content')
      expect(accessDeniedStore.set).not.toHaveBeenCalled()
    }
  )

  it.each(['document-id', 'document-title---document-id'])('resolves the project document link %s', async (link) => {
    findOne.mockResolvedValueOnce(doc).mockResolvedValueOnce(projectDoc)

    expect(await resolveLocation(location(link, 'project-id'))).toEqual({
      loc: { path: ['workbench', 'workspace'], fragment: 'document-panel' },
      defaultLocation: { path: ['workbench', 'workspace', documentsId, 'library'], fragment: 'document-panel' }
    })
    expect(findOne).toHaveBeenNthCalledWith(
      2,
      documents.class.ProjectDocument,
      { document: doc._id, project: 'project-id' },
      { showArchived: true }
    )
    expect(getPanelURI).toHaveBeenCalledWith(expect.anything(), projectDoc._id, projectDoc._class, 'content')
    expect(accessDeniedStore.set).not.toHaveBeenCalled()
  })

  it('still denies access for a missing document', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await resolveLocation(location('missing-document'))).toBeUndefined()
      expect(accessDeniedStore.set).toHaveBeenCalledWith(true)
      expect(error).toHaveBeenCalledWith('Could not find document missing-document.')
    } finally {
      error.mockRestore()
    }
  })
})
