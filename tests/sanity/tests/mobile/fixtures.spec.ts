// SPDX-License-Identifier: EPL-2.0
import { test, expect } from '@playwright/test'
import type { Locator, Page, TestInfo } from '@playwright/test'
import type { PlatformClient } from '@hcengineering/api-client'
import core from '@hcengineering/core'
import type { Doc, Ref } from '@hcengineering/core'
import tracker from '@hcengineering/tracker'
import type { Project } from '@hcengineering/tracker'
import task from '@hcengineering/task'
import view from '@hcengineering/view'
import workbench from '@hcengineering/workbench'
import { readFile } from 'node:fs/promises'
import { cleanup, NavigatorGapError, runSurveyStep, seed } from './fixtures'
import { isSurveyComplete, NAVIGATOR_GAP_REASON } from './contracts'
import type { MobileStepResult } from './contracts'

function step (name = 'portrait: list'): MobileStepResult {
  return { name, outcome: 'not-tested', cleanup: 'failed' }
}

test('step results retain assertion messages and stacks after recovery', async ({ browserName: _browserName }, info) => {
  const page: Partial<Page> = {}
  const result = step()
  const error = new Error('Expected fixture Issue in locator .tracker-card')
  await runSurveyStep(page as Page, info, result, () => 'verify Board', async () => { throw error }, async () => {})
  expect(result).toMatchObject({
    outcome: 'url-recovery',
    failure: { kind: 'harness', phase: 'verify Board', reason: error.message, stack: error.stack }
  })
})

test('known gaps annotate the report and preserve the navigator in evidence', async ({ browserName: _browserName }, info) => {
  const captures: Array<{ scope: string, mask: unknown[] }> = []
  const locator = (scope: string): Locator => ({
    screenshot: async (options: { mask: unknown[] }) => { captures.push({ scope, mask: options.mask }); return Buffer.alloc(0) }
  }) as unknown as Locator
  const page = { locator: (selector: string) => selector, getByTestId: locator } as unknown as Page
  const phoneInfo = { ...info, outputPath: (...segments: string[]) => info.outputPath(...segments), project: { ...info.project, name: 'pixel-7', use: { hasTouch: true } }, annotations: [] } as unknown as TestInfo
  const result = step()
  await runSurveyStep(page, phoneInfo, result, () => 'activate List', async () => {
    throw new NavigatorGapError(locator('target'))
  })
  expect.soft(phoneInfo.annotations).toContainEqual({ type: 'known-product-gap', description: `${result.name}: ${NAVIGATOR_GAP_REASON}` })
  expect(captures).toEqual([{ scope: 'contentPanel', mask: ['.antiPanel-navigator > *, .activityMessage, .avatar'] }])
})

test('phone gaps are annotated and their evidence retains the overlay footprint', async ({ page }, info) => {
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1">
    <main data-id="contentPanel" style="position:fixed;inset:0;background:white">
      <button id="target" style="position:absolute;left:20px;top:20px;width:80px;height:44px">View</button>
    </main>
    <nav class="antiPanel-navigator fly" style="position:fixed;inset:0 20% 0 0;background:blue;z-index:10">
      <div>Private navigator entry</div>
    </nav>`)
  page.setDefaultTimeout(300)
  const phoneInfo = { ...info, outputPath: (...segments: string[]) => info.outputPath(...segments), project: { ...info.project, name: 'pixel-7', use: { hasTouch: true } }, annotations: [] } as unknown as TestInfo
  const target = page.locator('#target')
  const result = step()
  await runSurveyStep(page, phoneInfo, result, () => 'activate List', async () => {
    throw new NavigatorGapError(target)
  })
  expect(result.failure?.kind).toBe('known-product-gap')
  expect.soft(phoneInfo.annotations).toContainEqual({ type: 'known-product-gap', description: `${result.name}: ${NAVIGATOR_GAP_REASON}` })
  const expected = await page.getByTestId('contentPanel').screenshot({
    mask: [page.locator('.antiPanel-navigator > *, .activityMessage, .avatar')]
  })
  expect(await readFile(info.outputPath(result.gapEvidence ?? 'missing.png'))).toEqual(expected)
})

test('acceptance rejects missing coverage including an entirely blocked phone run', () => {
  for (const project of ['chromium', 'iphone-15', 'pixel-7']) {
    const orientations = project === 'chromium' ? ['desktop'] : ['portrait', 'landscape']
    const steps: MobileStepResult[] = orientations.flatMap((orientation) =>
      ['list', 'board', 'create', 'separate editors'].map((name) => ({ name: `${orientation}: ${name}`, outcome: 'ui', cleanup: 'ok' }))
    )
    expect(isSurveyComplete(project, steps)).toBe(true)
    expect(isSurveyComplete(project, steps.slice(1))).toBe(false)
    const blocked = (item: MobileStepResult): MobileStepResult => ({
      ...item, outcome: 'not-tested',
      failure: { kind: 'known-product-gap', phase: 'activate view', reason: NAVIGATOR_GAP_REASON },
      gapEvidence: `${item.name.replace(/[^a-z]+/g, '-')}-navigator-gap.png`
    })
    expect(isSurveyComplete(project, steps.map(blocked))).toBe(false)
    expect(isSurveyComplete(project, [blocked(steps[0]), ...steps.slice(1)])).toBe(false)
    expect(isSurveyComplete(project, steps.map((item) => ({ ...item, outcome: 'url-recovery' })))).toBe(false)
  }
})

interface FixtureDocument {
  _id: string
  _class: string
  [key: string]: unknown
}

function fixtureClient (collisions = 0): { client: PlatformClient, documents: FixtureDocument[], attempts: string[], issueQueries: unknown[] } {
  const documents: FixtureDocument[] = [
    { _id: 'orphan', _class: tracker.class.Issue, space: 'deleted-project' },
    { _id: tracker.project.DefaultProject, _class: tracker.class.Project, type: 'project-type' },
    { _id: 'source', _class: tracker.class.Issue, space: tracker.project.DefaultProject, rank: 'rank' },
    { _id: 'project-type', _class: task.class.ProjectType, targetClass: 'project-mixin' },
    { _id: 'tracker:viewlet:Kanban', _class: view.class.ViewletDescriptor }
  ]
  const attempts: string[] = []
  const issueQueries: unknown[] = []
  const createDoc = async (cls: string, space: string, data: Record<string, unknown>, id: string): Promise<void> => {
    documents.push({ ...data, _id: id, _class: cls, space })
  }
  const client = {
    findAll: async (cls: string) => cls === view.class.Viewlet
      ? [view.viewlet.List, 'tracker:viewlet:Kanban'].map((descriptor, index) => ({ _id: `viewlet-${index}`, attachTo: tracker.class.Issue, descriptor }))
      : [],
    findOne: async (cls: string, query: Record<string, unknown>) => {
      if (cls === tracker.class.Project && typeof query.identifier === 'string') {
        attempts.push(query.identifier)
        if (collisions-- > 0) return { _id: 'collision' }
      }
      if (cls === tracker.class.Issue) issueQueries.push(query)
      return documents.find((doc) => doc._class === cls && Object.entries(query).every(([key, value]) => doc[key] === value))
    },
    getModel: () => ({ findAllSync: (cls: string) => cls === task.class.TaskTypeDescriptor
      ? [{ _id: 'descriptor', allowCreate: true }]
      : [{ _id: 'kind', descriptor: 'descriptor', targetClass: tracker.class.Issue, statuses: ['status'] }] }),
    getHierarchy: () => ({ isDerived: () => true }),
    getAccount: async () => ({ uuid: 'account' }),
    createDoc,
    createMixin: async () => {},
    addCollection: async (cls: string, space: string, parent: string, parentClass: string, collection: string, data: Record<string, unknown>, id: string) => {
      await createDoc(cls, space, data, id)
    }
  } as unknown as PlatformClient
  return { client, documents, attempts, issueQueries }
}

test('seeding ignores orphan fixtures and uses the default sanity project', async () => {
  const { client, issueQueries } = fixtureClient()
  const { project } = await seed(client, new Set<Ref<Doc>>(), new Set<Ref<Project>>())
  expect(issueQueries[0]).toEqual({ space: tracker.project.DefaultProject })
  expect(project.identifier).toMatch(/^M[A-F0-9]{4}$/)
})

test('project identifier collisions retry with a short identifier', async () => {
  const { client, attempts, documents } = fixtureClient(1)
  documents.shift()
  const { project } = await seed(client, new Set<Ref<Doc>>(), new Set<Ref<Project>>())
  expect(attempts).toHaveLength(2)
  expect(new Set(attempts).size).toBe(2)
  expect(attempts.every((identifier) => /^M[A-F0-9]{4}$/.test(identifier))).toBe(true)
  expect(project.identifier).toBe(attempts[1])
})

test('cleanup deletes only fixture tabs and preserves unrelated tabs', async () => {
  const tabs = [
    { _id: 'fixture-tab', _class: workbench.class.WorkbenchTab, space: core.space.Workspace, location: '/workbench/synthetic/tracker/fixture-project/issues' },
    { _id: 'other-tab', _class: workbench.class.WorkbenchTab, space: core.space.Workspace, location: '/workbench/synthetic/tracker/all-issues' }
  ]
  const changes: string[] = []
  const client = {
    getAccount: async () => ({ uuid: 'account' }),
    findAll: async (cls: string) => cls === workbench.class.WorkbenchTab ? [...tabs] : [],
    removeDoc: async (cls: string, space: string, id: string) => { changes.push(id); tabs.splice(tabs.findIndex((tab) => tab._id === id), 1) },
    updateDoc: async (cls: string, space: string, id: string, data: object) => { Object.assign(tabs.find((tab) => tab._id === id) ?? {}, data) }
  } as unknown as PlatformClient
  const result = await cleanup(client, new Set(['fixture-project' as Ref<Doc>]), new Set())
  expect(result.outcome).toBe('ok')
  expect(changes).toEqual(['fixture-tab'])
  expect(tabs.map((tab) => tab._id)).toEqual(['other-tab'])
})
