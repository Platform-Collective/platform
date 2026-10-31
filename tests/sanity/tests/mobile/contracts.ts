// SPDX-License-Identifier: EPL-2.0
import type { Ref, Class, Doc } from '@hcengineering/core'
import type { Viewlet, ViewletDescriptor } from '@hcengineering/view'

export interface MobileStepResult {
  name: string
  outcome: 'ui' | 'url-recovery' | 'not-tested'
  cleanup: 'ok' | 'failed'
  failure?: {
    kind: 'harness' | 'known-product-gap'
    phase: string
    reason: string
  }
  gapEvidence?: string
}

export const NAVIGATOR_GAP_REASON =
  'Floating navigator intercepts the target control (plan Tasks 2c/3); downstream Create/Kanban behavior is untested'

/** Only a measured phone navigator obstruction qualifies as a known product gap. */
export function isKnownPhoneGap (project: string, step: MobileStepResult): boolean {
  return (
    ['iphone-15', 'pixel-7'].includes(project) &&
    /^(portrait|landscape): (list|board|create|separate editors)$/.test(step.name) &&
    ['not-tested', 'url-recovery'].includes(step.outcome) &&
    step.cleanup === 'ok' &&
    step.failure?.kind === 'known-product-gap' &&
    step.failure.phase !== '' &&
    step.failure.reason === NAVIGATOR_GAP_REASON &&
    /^[a-z-]+-navigator-gap\.png$/.test(step.gapEvidence ?? '')
  )
}

/** Desktop stays strict; phone gaps describe missing coverage, never UI success. */
export function isTask1Accepted (project: string, steps: MobileStepResult[]): boolean {
  const orientations = ['iphone-15', 'pixel-7'].includes(project) ? ['portrait', 'landscape'] : ['desktop']
  const expected = orientations.flatMap((orientation) =>
    ['list', 'board', 'create', 'separate editors'].map((name) => `${orientation}: ${name}`)
  )
  return (
    steps.length === expected.length &&
    expected.every((name) => steps.filter((step) => step.name === name).length === 1) &&
    steps.every(
      (step) =>
        (step.outcome === 'ui' && step.cleanup === 'ok' && step.failure === undefined) || isKnownPhoneGap(project, step)
    )
  )
}

/** Resolve concrete model viewlets, excluding secondary Issue variants. */
export function resolveIssueViewlets (
  viewlets: Array<Pick<Viewlet, '_id' | 'attachTo' | 'descriptor' | 'variant'>>,
  issueClass: Ref<Class<Doc>>,
  listDescriptor: Ref<ViewletDescriptor>,
  boardDescriptor: Ref<ViewletDescriptor>
): { list: Ref<Viewlet>, board: Ref<Viewlet> } {
  const resolve = (descriptor: Ref<ViewletDescriptor>): Ref<Viewlet> => {
    const matches = viewlets.filter(
      (viewlet) => viewlet.attachTo === issueClass && viewlet.descriptor === descriptor && viewlet.variant === undefined
    )
    if (matches.length !== 1) throw new Error('Expected exactly one primary Issue viewlet per descriptor')
    return matches[0]._id
  }
  return { list: resolve(listDescriptor), board: resolve(boardDescriptor) }
}

/** Recovery is useful diagnostic evidence, but cannot pass touch acceptance. */
export function isUiSuccess (steps: MobileStepResult[]): boolean {
  return (
    steps.length > 0 &&
    steps.every((step) => step.outcome === 'ui' && step.cleanup === 'ok' && step.failure === undefined)
  )
}
