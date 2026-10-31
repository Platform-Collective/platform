// SPDX-License-Identifier: EPL-2.0
import { test as base, expect } from '@playwright/test'
import type { Locator, Page, Request, TestInfo } from '@playwright/test'
import { connect, NodeWebSocketFactory } from '@hcengineering/api-client'
import type { PlatformClient } from '@hcengineering/api-client'
import core, { generateId } from '@hcengineering/core'
import type { AttachedDoc, Class, Doc, Ref } from '@hcengineering/core'
import tracker, { TimeReportDayType } from '@hcengineering/tracker'
import type { Issue, Project } from '@hcengineering/tracker'
import view from '@hcengineering/view'
import type { ViewletDescriptor } from '@hcengineering/view'
import task from '@hcengineering/task'
import activity from '@hcengineering/activity'
import notification from '@hcengineering/notification'
import workbench from '@hcengineering/workbench'
import { writeFile } from 'node:fs/promises'
import { LoginPage } from '../model/login-page'
import { SelectWorkspacePage } from '../model/select-workspace-page'
import { isTask1Accepted, NAVIGATOR_GAP_REASON, resolveIssueViewlets } from './contracts'
import type { MobileStepResult } from './contracts'

export type { MobileStepResult } from './contracts'

export interface MobileSurvey {
  client: PlatformClient
  project: Project
  issue: Issue
  viewlets: ReturnType<typeof resolveIssueViewlets>
  root: string
  steps: MobileStepResult[]
  behaviorStarted: boolean
  failures: string[]
  phase: (name: string) => void
  step: (name: string, action: () => Promise<void>, recovery?: () => Promise<void>) => Promise<void>
}

interface MobileFixtures {
  survey: MobileSurvey
}

function required (name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') throw new Error(`Missing required environment variable: ${name}`)
  return value
}

class NavigatorGapError extends Error {
  constructor (readonly target: Locator) {
    super(NAVIGATOR_GAP_REASON)
    this.name = 'NavigatorGapError'
  }
}

class BrowserSessionError extends Error {
  constructor () {
    super('Browser returned to login while loading the authenticated workbench; check account-service cookies')
    this.name = 'BrowserSessionError'
  }
}

interface MobileSessionOptions {
  browserName: 'chromium' | 'firefox' | 'webkit'
  baseURL: string
  workspace: string
  user: string
  password: string
  phase?: (name: string) => void
}

const AUTH_COOKIE = 'account-metadata-Token'
const browserSessions = new WeakMap<Page, MobileBrowserSession>()

/** Test-only WebKit workaround for local stacks that set Domain=localhost. */
export class MobileBrowserSession {
  readonly summary = { logins: 0, restores: 0, restoreFailed: 0, uiRelogins: 0 }
  private cookieAuth: { url: string, token: string } | undefined

  constructor (
    private readonly page: Page,
    private readonly options: MobileSessionOptions
  ) {
    if (options.browserName === 'webkit') browserSessions.set(page, this)
  }

  async login (): Promise<void> {
    const { page, options } = this
    const pending: Array<Promise<void>> = []
    const onRequest = (request: Request): void => {
      if (request.method() !== 'PUT' || !new URL(request.url()).pathname.endsWith('/cookie')) return
      pending.push(
        (async () => {
          const auth = (await request.allHeaders()).authorization
          if (auth?.startsWith('Bearer ')) {
            this.cookieAuth = { url: new URL(request.url()).origin, token: auth.slice(7) }
          }
        })().catch(() => {
          // A missing token is reported by restore(), without exposing request headers.
        })
      )
    }
    if (options.browserName === 'webkit') page.on('request', onRequest)
    try {
      options.phase?.('authenticate in browser')
      await page.goto(`${options.baseURL.replace(/\/$/, '')}/login/login`)
      await new LoginPage(page).login(options.user, options.password)
      options.phase?.('select workspace')
      await new SelectWorkspacePage(page).selectWorkspace(options.workspace)
      await page.waitForURL((url) => url.pathname.startsWith(`/workbench/${encodeURIComponent(options.workspace)}/`))
      options.phase?.('authenticated workbench readiness')
      await workbenchReady(page)
      await Promise.all(pending)
      this.summary.logins++
      if (options.browserName === 'webkit') {
        options.phase?.('restore WebKit browser authentication')
        await this.restore()
      }
    } finally {
      page.off('request', onRequest)
    }
  }

  private async restore (): Promise<void> {
    const context = this.page.context()
    const auth = this.cookieAuth
    const urls = auth === undefined ? [this.options.baseURL] : [auth.url, this.options.baseURL]
    const hasCookie = async (): Promise<boolean> =>
      (await context.cookies(urls)).some((cookie) => cookie.name === AUTH_COOKIE && cookie.value !== '')
    if (await hasCookie()) return
    if (auth !== undefined) {
      await context.addCookies([{ name: AUTH_COOKIE, value: auth.token, url: auth.url, httpOnly: true }])
      if (await hasCookie()) {
        this.summary.restores++
        return
      }
    }
    this.summary.restoreFailed++
  }

  async relogin (url: string): Promise<void> {
    if (this.options.browserName !== 'webkit') throw new BrowserSessionError()
    this.summary.uiRelogins++
    await this.login()
    await this.page.goto(url)
    await workbenchReady(this.page)
  }

  dispose (): void {
    browserSessions.delete(this.page)
  }
}

async function ensureSession (page: Page, url: string): Promise<void> {
  try {
    await workbenchReady(page)
  } catch (error) {
    const session = browserSessions.get(page)
    if (!(error instanceof BrowserSessionError) || session === undefined) throw error
    await session.relogin(url)
  }
}

/** Confirm actual hit interception, rather than interpreting a phone timeout as a product bug. */
async function navigatorIntercepts (locator: Locator): Promise<boolean> {
  try {
    if ((await locator.count()) !== 1 || !(await locator.isVisible()) || !(await locator.isEnabled())) return false
    return await locator.evaluate((element) => {
      if (element.closest('.antiPanel-navigator') !== null) return false
      const box = element.getBoundingClientRect()
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      if (box.width <= 0 || box.height <= 0 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false
      const hit = document.elementFromPoint(x, y)
      return (
        document.querySelector('.antiPanel-navigator.fly') !== null &&
        hit?.closest('.antiPanel-navigator.fly, .workbench-container > .cover.shown') != null
      )
    })
  } catch {
    // A detached target or closed page is not evidence of a navigator gap.
    return false
  }
}

/** Use real touch on the phone projects; desktop keeps its normal input mode. */
export async function activate (page: Page, locator: Locator, info: TestInfo = base.info()): Promise<void> {
  await expect(locator).toHaveCount(1)
  const touch = info.project.use.hasTouch === true || info.project.use.isMobile === true
  try {
    if (touch) await locator.tap()
    else await locator.click()
  } catch (error) {
    if (touch && (await navigatorIntercepts(locator))) throw new NavigatorGapError(locator)
    throw error
  }
}

/** A URL and absence of overlays can both match before the authenticated app mounts. */
export async function workbenchReady (page: Page): Promise<void> {
  const menu = page.locator('button[id="app-workbench:string:ShowMenu"], button[id="app-workbench:string:HideMenu"]')
  const login = page.locator('input[name="email"]')
  await expect(menu.or(login)).toBeVisible()
  if (await login.isVisible()) throw new BrowserSessionError()
  await expect(page.getByTestId('contentPanel')).toBeVisible()
}

/** Wait for the shell before deciding whether its navigator needs opening. */
export async function openNavigator (page: Page): Promise<void> {
  await workbenchReady(page)
  const show = page.locator('button[id="app-workbench:string:ShowMenu"]')
  if (await show.isVisible()) await activate(page, show)
  await expect(page.locator('.antiPanel-navigator:not(.second)')).toBeVisible()
}

/** End each independent path at a fresh page, without carrying a panel or child popup. */
export async function resetOverlays (page: Page, url: string): Promise<void> {
  await page.goto(url)
  await ensureSession(page, url)
  await expect(page.locator('.popupPanel, form[id="tracker:string:NewIssue"], .selectPopup')).toHaveCount(0)
}

/** Separate named editor scopes even when the product lacks accessible editor names. */
export function issueEditors (page: Page): { description: Locator, comment: Locator } {
  const panel = page.locator('.popupPanel')
  return {
    description: panel
      .getByRole('textbox', { name: /description/i })
      .or(panel.locator('.textInput [contenteditable="true"]')),
    comment: panel
      .getByRole('textbox', { name: /comment|message/i })
      .or(panel.locator('.text-input [contenteditable="true"]'))
  }
}

/** Capture only the fixture view; mask actor identities in its activity and avatars. */
export async function capture (page: Page, info: TestInfo, name: string): Promise<void> {
  const create = page.locator('form[id="tracker:string:NewIssue"]')
  const panel = page.locator('.popupPanel')
  const target = (await create.isVisible())
    ? create
    : (await panel.isVisible())
      ? panel
      : page.getByTestId('contentPanel')
  await expect(target).toHaveCount(1)
  await target.screenshot({
    path: info.outputPath(`${name}.png`),
    mask: [page.locator('.activityMessage, .avatar')]
  })
}

async function seed (
  client: PlatformClient,
  owned: Set<Ref<Doc>>,
  projects: Set<Ref<Project>>
): Promise<{
  project: Project
  issue: Issue
  viewlets: ReturnType<typeof resolveIssueViewlets>
}> {
  const modelViewlets = await client.findAll(view.class.Viewlet, { attachTo: tracker.class.Issue })
  // Registered by models/tracker/src/viewlets.ts. Resolve concrete Viewlets from model data.
  const boardDescriptor = await client.findOne(view.class.ViewletDescriptor, {
    _id: 'tracker:viewlet:Kanban' as Ref<ViewletDescriptor>
  })
  if (boardDescriptor === undefined) throw new Error('Tracker Kanban descriptor is missing')
  const viewlets = resolveIssueViewlets(modelViewlets, tracker.class.Issue, view.viewlet.List, boardDescriptor._id)
  const sourceIssue = await client.findOne(tracker.class.Issue, {})
  if (sourceIssue === undefined) throw new Error('An existing sanity Issue is required for status/kind setup')
  const sourceProject = await client.findOne(tracker.class.Project, { _id: sourceIssue.space })
  if (sourceProject === undefined) throw new Error('Sanity project is missing')
  const projectType = await client.findOne(task.class.ProjectType, { _id: sourceProject.type })
  if (projectType === undefined) throw new Error('Sanity project type is missing')
  const descriptors = new Map(
    client
      .getModel()
      .findAllSync(task.class.TaskTypeDescriptor, {})
      .map((item) => [item._id, item])
  )
  const kind = client
    .getModel()
    .findAllSync(task.class.TaskType, { parent: projectType._id })
    .find(
      (item) =>
        (descriptors.get(item.descriptor)?.allowCreate ?? false) &&
        client.getHierarchy().isDerived(item.targetClass, tracker.class.Issue)
    )
  const status = kind?.statuses[0]
  if (kind === undefined || status === undefined) {
    throw new Error('Project type needs a creatable Issue kind and status')
  }
  const account = await client.getAccount()
  const projectId = generateId<Project>()
  const issueId = generateId<Issue>()
  const identifier = `M${projectId.slice(-10).toUpperCase()}`
  // Track fixture IDs before the first write so a lost response cannot escape cleanup.
  owned.add(projectId)
  projects.add(projectId)
  owned.add(issueId)
  await client.createDoc(
    tracker.class.Project,
    core.space.Space,
    {
      name: `Mobile acceptance ${projectId}`,
      description: 'Synthetic mobile acceptance fixture',
      private: true,
      autoJoin: false,
      archived: false,
      members: [account.uuid],
      owners: [account.uuid],
      type: sourceProject.type,
      identifier,
      sequence: 1,
      defaultIssueStatus: status,
      defaultTimeReportDay: TimeReportDayType.PreviousWorkDay
    },
    projectId
  )
  await client.createMixin(projectId, tracker.class.Project, core.space.Space, projectType.targetClass, {})
  await client.addCollection(
    tracker.class.Issue,
    projectId,
    tracker.ids.NoParent,
    tracker.class.Issue,
    'subIssues',
    {
      title: 'Synthetic mobile acceptance issue',
      identifier: `${identifier}-1`,
      number: 1,
      kind: kind._id,
      status,
      rank: sourceIssue.rank,
      description: null,
      priority: 0,
      assignee: null,
      dueDate: null,
      startDate: null,
      component: null,
      milestone: null,
      parents: [],
      childInfo: [],
      estimation: 0,
      remainingTime: 0,
      reportedTime: 0,
      reports: 0,
      subIssues: 0,
      labels: 0,
      comments: 0,
      attachments: 0
    },
    issueId
  )
  const project = await client.findOne(tracker.class.Project, { _id: projectId })
  const issue = await client.findOne(tracker.class.Issue, { _id: issueId })
  if (project === undefined || issue === undefined) throw new Error('Fixture readback failed')
  return { project, issue, viewlets }
}

/** Sweep only this run's IDs and private project, including asynchronous trigger children. */
async function cleanup (
  client: PlatformClient,
  owned: Set<Ref<Doc>>,
  projects: Set<Ref<Project>>,
  workspaceRoot: string
): Promise<{
  outcome: 'ok' | 'failed'
  remaining: string[]
  errors: string[]
}> {
  const errors: string[] = []
  const found = new Map<Ref<Doc>, Doc>()
  const locationTokens = new Set<string>([...owned])
  for (const id of projects) locationTokens.add(`M${id.slice(-10).toUpperCase()}`)
  const collect = (docs: Doc[]): void => {
    for (const doc of docs) {
      found.set(doc._id, doc)
      owned.add(doc._id)
      locationTokens.add(doc._id)
      if ('identifier' in doc && typeof doc.identifier === 'string') locationTokens.add(doc.identifier)
    }
  }
  const discover = async (): Promise<void> => {
    const rootClasses: Array<Ref<Class<Doc>>> = [tracker.class.Project, tracker.class.Issue]
    for (const cls of rootClasses) {
      collect(await client.findAll(cls, { _id: { $in: [...owned] } }))
    }
    // The only project written by this test has a tracked fixture ID. Include generated UI IDs.
    collect(await client.findAll(tracker.class.Issue, { space: { $in: [...projects] } }))
    for (let depth = 0; depth < 8; depth++) {
      const count = owned.size
      for (const cls of [activity.class.ActivityMessage, activity.class.Reaction, core.class.Collaborator]) {
        collect(await client.findAll(cls, { attachedTo: { $in: [...owned] } }))
      }
      collect(await client.findAll(activity.class.ActivityReference, { srcDocId: { $in: [...owned] } }))
      collect(await client.findAll(activity.class.UserMentionInfo, { attachedTo: { $in: [...owned] } }))
      for (const cls of [notification.class.InboxNotification, notification.class.DocNotifyContext]) {
        collect(await client.findAll(cls, { objectId: { $in: [...owned] } }))
      }
      if (count === owned.size) return
    }
    throw new Error('Cleanup descendant limit reached')
  }
  for (let pass = 0; pass < 3; pass++) {
    found.clear()
    try {
      await discover()
    } catch {
      errors.push('Cleanup discovery failed')
    }
    // Remove descendants before Issue and Project roots. Retry after triggers settle.
    const depth = (doc: Doc): number => {
      const seen = new Set<Ref<Doc>>()
      let current = doc
      while ('attachedTo' in current && !seen.has(current._id)) {
        seen.add(current._id)
        const parent = found.get((current as AttachedDoc).attachedTo)
        if (parent === undefined) break
        current = parent
      }
      return seen.size
    }
    const docs = [...found.values()].sort(
      (a, b) =>
        Number(a._class === tracker.class.Project) - Number(b._class === tracker.class.Project) ||
        Number(a._class === tracker.class.Issue) - Number(b._class === tracker.class.Issue) ||
        depth(b) - depth(a)
    )
    for (const doc of docs) {
      try {
        if ('attachedTo' in doc && 'collection' in doc) {
          const child = doc as AttachedDoc
          await client.removeCollection(
            child._class,
            child.space,
            child._id,
            child.attachedTo,
            child.attachedToClass,
            child.collection
          )
        } else await client.removeDoc(doc._class, doc.space, doc._id)
      } catch {
        errors.push('Cleanup deletion failed')
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  found.clear()
  try {
    await discover()
  } catch {
    errors.push('Cleanup verification failed')
  }
  // Opening a fixture can persist a WorkbenchTab outside its project. Preserve other tabs.
  try {
    const account = await client.getAccount()
    for (const tab of await client.findAll(workbench.class.WorkbenchTab, { attachedTo: account.uuid })) {
      if (![...locationTokens].some((id) => decodeURIComponent(tab.location).includes(id))) continue
      await client.updateDoc(tab._class, tab.space, tab._id, {
        location: `${workspaceRoot}/tracker/all-issues`,
        name: 'All issues'
      })
    }
    const tabs = await client.findAll(workbench.class.WorkbenchTab, { attachedTo: account.uuid })
    if (tabs.some((tab) => [...locationTokens].some((id) => decodeURIComponent(tab.location).includes(id)))) {
      errors.push('Stale fixture tab remains')
    }
  } catch {
    errors.push('Cleanup tab verification failed')
  }
  return { outcome: errors.length === 0 && found.size === 0 ? 'ok' : 'failed', remaining: [...found.keys()], errors }
}

export const test = base.extend<MobileFixtures>({
  survey: async ({ page, baseURL, browserName }, use, info) => {
    info.setTimeout(240_000)
    const owned = new Set<Ref<Doc>>()
    const projects = new Set<Ref<Project>>()
    const steps: MobileStepResult[] = []
    const failures: string[] = []
    let client: PlatformClient | undefined
    let survey: MobileSurvey | undefined
    let tracing = false
    let setupPhase = 'authenticate in browser'
    let setupFailure: { phase: string, reason: string } | undefined
    // Before the fixture client connects there are no synthetic writes to clean up.
    let cleanupResult: Awaited<ReturnType<typeof cleanup>> = {
      outcome: 'ok',
      remaining: [],
      errors: []
    }
    const workspace = required('PLATFORM_WS')
    if (baseURL === undefined) throw new Error('An explicit target URL is required')
    const root = `${baseURL.replace(/\/$/, '')}/workbench/${encodeURIComponent(workspace)}`
    const session = new MobileBrowserSession(page, {
      browserName,
      baseURL,
      workspace,
      user: required('PLATFORM_USER'),
      password: required('MOBILE_PWA_PASSWORD'),
      phase: (name) => {
        setupPhase = name
      }
    })
    try {
      // Use the sanity authentication page objects with explicit credentials for the target application.
      await page.addInitScript(() => {
        localStorage.setItem('#platform.testing.enabled', 'true')
        localStorage.setItem('#platform.lazy.loading', 'false')
        localStorage.setItem('#platform.notification.timeout', '0')
      })
      await session.login()
      setupPhase = 'verify persistent browser authentication'
      const authenticatedURL = page.url()
      await page.reload()
      await ensureSession(page, authenticatedURL)
      setupPhase = 'authenticate fixture client'
      client = await connect(baseURL, {
        email: required('PLATFORM_USER'),
        password: required('MOBILE_PWA_PASSWORD'),
        workspace,
        socketFactory: NodeWebSocketFactory,
        connectionTimeout: 20_000
      })
      setupPhase = 'seed and read back fixture/model viewlets'
      const fixtures = await seed(client, owned, projects)
      await page.context().tracing.start({ snapshots: false, screenshots: false, sources: false })
      tracing = true
      let phase = 'setup'
      survey = {
        ...fixtures,
        client,
        root,
        steps,
        behaviorStarted: false,
        failures,
        phase (name) {
          phase = name
        },
        async step (name, action, recovery) {
          const result: MobileStepResult = { name, outcome: 'not-tested', cleanup: 'failed' }
          steps.push(result)
          phase = 'reset and authenticated workbench readiness'
          try {
            await action()
            result.outcome = 'ui'
          } catch (error) {
            const knownGap = error instanceof NavigatorGapError && ['iphone-15', 'pixel-7'].includes(info.project.name)
            result.failure = {
              kind: 'harness',
              phase,
              reason:
                error instanceof BrowserSessionError
                  ? error.message
                  : error instanceof Error && error.name === 'TimeoutError'
                    ? 'Action timed out; no product cause established'
                    : 'Action or assertion failed; no product cause established'
            }
            if (knownGap) {
              const screenshot = `${name.replace(/[^a-z]+/g, '-')}-navigator-gap`
              try {
                // Crop to the synthetic/static control, never the home list or private navigator entries.
                await error.target.screenshot({
                  path: info.outputPath(`${screenshot}.png`),
                  mask: [page.locator('.antiPanel-navigator, .activityMessage, .avatar')]
                })
                result.gapEvidence = `${screenshot}.png`
                result.failure = { kind: 'known-product-gap', phase, reason: NAVIGATOR_GAP_REASON }
              } catch {
                result.failure.reason = 'Navigator obstruction observed, but required masked evidence capture failed'
              }
            }
            if (result.failure.kind === 'harness') failures.push(name)
            if (recovery !== undefined) {
              try {
                await recovery()
                result.outcome = 'url-recovery'
              } catch {
                /* Remains untested. */
              }
            }
          }
        }
      }
      await use(survey)
    } catch (error) {
      if (survey === undefined) {
        setupFailure = {
          phase: setupPhase,
          reason: error instanceof BrowserSessionError ? error.message : 'Setup failed before behavioral acceptance'
        }
      }
      throw error
    } finally {
      session.dispose()
      if (client !== undefined) {
        // Leave the fixture page before deleting data, so its queries cannot create more activity.
        try {
          await page.goto('about:blank')
        } catch {
          failures.push('leave fixture page')
        }
        cleanupResult = await cleanup(client, owned, projects, `/workbench/${encodeURIComponent(workspace)}`)
        try {
          await client.close()
        } catch {
          cleanupResult.outcome = 'failed'
          cleanupResult.errors.push('Client close failed')
        }
      }
      for (const step of steps) step.cleanup = cleanupResult.outcome
      if (tracing) await page.context().tracing.stop({ path: info.outputPath('trace.zip') })
      await writeFile(
        info.outputPath('mobile-result.json'),
        JSON.stringify(
          {
            schemaVersion: 2,
            project: info.project.name,
            test: info.title,
            target: process.env.MOBILE_PWA_TARGET,
            adapter: process.env.MOBILE_PWA_ADAPTER,
            baselineCommit: process.env.PC_DEVELOP_COMMIT,
            candidateCommit: process.env.MOBILE_PWA_COMMIT,
            behaviorStarted: survey?.behaviorStarted ?? false,
            input: {
              mode: info.project.use.hasTouch === true || info.project.use.isMobile === true ? 'touch' : 'mouse',
              hasTouch: info.project.use.hasTouch === true,
              isMobile: info.project.use.isMobile === true
            },
            session: { workaround: browserName === 'webkit' ? 'webkit-url-cookie' : 'none', ...session.summary },
            ...(setupFailure !== undefined ? { setupFailure } : {}),
            failures,
            steps,
            cleanup: cleanupResult
          },
          null,
          2
        )
      )
      expect(cleanupResult, 'Fixture cleanup is a separate acceptance requirement').toMatchObject({
        outcome: 'ok',
        remaining: [],
        errors: []
      })
      if (survey !== undefined && info.status === 'passed') {
        expect(
          isTask1Accepted(info.project.name, steps),
          'Task 1 requires UI evidence or confirmed phone gaps, plus verified cleanup'
        ).toBe(true)
      }
    }
  }
})
export { expect } from '@playwright/test'
