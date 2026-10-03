//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

/**
 * What a card of the board shows, derived from the field list of the view (the columns of the saved view).
 * The title, the identifier and the status marker are always shown, the rest follows the list. The same list
 * drives the columns of the table, so a field is switched on and off in one place for both layouts.
 */

/** Fields of an issue the cards know how to show as a chip, besides the custom fields. */
export const BUILTIN_CARD_CHIPS = ['subIssues', 'priority', 'component', 'milestone', 'dueDate'] as const

export type BuiltinCardChip = (typeof BUILTIN_CARD_CHIPS)[number]

export type CardChip = { kind: 'builtin', id: BuiltinCardChip } | { kind: 'custom', fieldKey: string }

export interface CardFieldPlan {
  // The assignee avatar
  assignee: boolean
  // Chips in the order of the field list
  chips: CardChip[]
  labels: boolean
  estimation: boolean
  attachments: boolean
  comments: boolean
}

/** What of the field list of a view the plan reads: a key, or a column with the key and the props of its presenter. */
export type CardFieldKey = string | { key: string, props?: Record<string, any> }

function builtinChip (key: string): BuiltinCardChip | undefined {
  return (BUILTIN_CARD_CHIPS as readonly string[]).includes(key) ? (key as BuiltinCardChip) : undefined
}

/** Key of the custom field a column of the field list stands for. */
export function customFieldKeyOf (item: CardFieldKey): string | undefined {
  if (typeof item === 'string') return undefined
  const fieldKey = item.props?.fieldKey
  return typeof fieldKey === 'string' && fieldKey !== '' ? fieldKey : undefined
}

export function planCardFields (config: readonly CardFieldKey[]): CardFieldPlan {
  const plan: CardFieldPlan = {
    assignee: false,
    chips: [],
    labels: false,
    estimation: false,
    attachments: false,
    comments: false
  }
  const seen = new Set<string>()
  for (const item of config) {
    const fieldKey = customFieldKeyOf(item)
    if (fieldKey !== undefined) {
      if (!seen.has(`c:${fieldKey}`)) {
        seen.add(`c:${fieldKey}`)
        plan.chips.push({ kind: 'custom', fieldKey })
      }
      continue
    }
    const key = typeof item === 'string' ? item : item.key
    switch (key) {
      case 'assignee':
        plan.assignee = true
        break
      case 'labels':
        plan.labels = true
        break
      case 'estimation':
        plan.estimation = true
        break
      case 'attachments':
        plan.attachments = true
        break
      case 'comments':
        plan.comments = true
        break
      default: {
        const id = builtinChip(key)
        if (id !== undefined && !seen.has(`b:${id}`)) {
          seen.add(`b:${id}`)
          plan.chips.push({ kind: 'builtin', id })
        }
      }
    }
  }
  return plan
}

export interface CardFooterFacts {
  // Time reported on the issue and its sub-issues
  reportedTime: number
  // Estimation of the sub-issues
  childEstimation: number
  comments: number
  // Comments of the parent issue, shown on a sub-issue
  parentComments: number
  attachments: number
}

/** Whether the footer of a card (estimation, attachments, comments) has anything to show. */
export function hasCardFooter (plan: CardFieldPlan, facts: CardFooterFacts): boolean {
  if (plan.estimation && (facts.reportedTime > 0 || facts.childEstimation > 0)) return true
  if (plan.comments && (facts.comments > 0 || facts.parentComments > 0)) return true
  return plan.attachments && facts.attachments > 0
}
