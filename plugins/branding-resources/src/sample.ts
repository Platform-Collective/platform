// SPDX-License-Identifier: EPL-2.0

import {
  type FieldValues,
  type PresetTemplateType,
  type TemplateType,
  TEMPLATE_TYPES,
  isPresetTemplateType
} from '@hcengineering/branding'
import { getEmbeddedLabel, type IntlString } from '@hcengineering/platform'

import branding from './plugin'

export const TEMPLATE_TYPE_LABELS: Record<PresetTemplateType, IntlString> = {
  letterhead: branding.string.TypeLetterhead,
  notice: branding.string.TypeNotice,
  handbook: branding.string.TypeHandbook,
  report: branding.string.TypeReport,
  proposal: branding.string.TypeProposal,
  memo: branding.string.TypeMemo,
  presentation: branding.string.TypePresentation,
  other: branding.string.TypeOther
}

/**
 * Label of a preset type, or the custom type name as typed.
 */
export function templateTypeLabel (type: TemplateType): IntlString {
  return isPresetTemplateType(type) ? TEMPLATE_TYPE_LABELS[type] : getEmbeddedLabel(type)
}

/**
 * Preset types first, then custom types used by existing templates.
 */
export function collectTemplateTypes (templates: Array<{ templateType?: string }>): TemplateType[] {
  const custom = new Set<string>()
  for (const t of templates) {
    const type = t.templateType ?? 'report'
    if (!isPresetTemplateType(type) && type !== 'letter' && type.trim() !== '') custom.add(type)
  }
  return [...TEMPLATE_TYPES, ...Array.from(custom).sort((a, b) => a.localeCompare(b))]
}


/**
 * Placeholder values shown while designing, so pages look like a real deliverable.
 */
export const SAMPLE_VALUES: FieldValues = {
  title: 'Quarterly Business Review',
  identifier: 'DOC-1042',
  version: '1.2',
  status: 'Approved',
  author: 'Alex Morgan',
  modifiedBy: 'Sam Lee',
  createdOn: 'March 3, 2026',
  modifiedOn: 'March 18, 2026',
  space: 'Strategy',
  className: 'Document',
  workspace: 'Acme Corporation',
  printedBy: 'Alex Morgan',
  printDate: 'March 20, 2026'
}

export function sampleValue (key: string): string {
  return SAMPLE_VALUES[key] ?? (key.startsWith('attr:') ? key.slice(5) : '')
}

export function sampleValuesFor (keys: string[]): FieldValues {
  return Object.fromEntries(keys.map((k) => [k, sampleValue(k)]))
}

/**
 * Representative document body, one string per sample page, covering every element the
 * typography settings style. Headings carry no manual numbers so automatic numbering shows.
 */
export const SAMPLE_CONTENT_PAGES: string[] = [
  `<h1>Executive summary</h1>
<p>This quarter the business grew faster than planned while keeping costs under control. Revenue increased by
<strong>18%</strong> compared to the previous quarter, driven by new customers in the enterprise segment and
higher retention across existing accounts. See the <a href="#sample">detailed figures</a> below.</p>
<p>The sections that follow describe results by region, the main risks for the coming quarter and the actions
proposed to address them.</p>
<h2>Highlights</h2>
<ul>
  <li>Three new enterprise customers signed multi-year agreements</li>
  <li>Customer churn decreased from 4.1% to 2.7%</li>
  <li>Average delivery time reduced by two days</li>
</ul>
<h3>Key figures</h3>
<table>
  <thead><tr><th>Metric</th><th>Q1</th><th>Q2</th><th>Change</th></tr></thead>
  <tbody>
    <tr><td>Revenue</td><td>$4.2M</td><td>$4.9M</td><td>+18%</td></tr>
    <tr><td>Active customers</td><td>312</td><td>347</td><td>+11%</td></tr>
    <tr><td>Net promoter score</td><td>41</td><td>47</td><td>+6</td></tr>
  </tbody>
</table>
<blockquote><p>“The new onboarding process made the difference for our team.” — Customer feedback</p></blockquote>`,
  `<h1>Results by region</h1>
<p>All regions met their targets. Growth was strongest in the north, where the partner programme launched in
January started to deliver qualified leads.</p>
<h2>North</h2>
<p>Revenue grew by 24%. The partner programme contributed eleven new opportunities, four of which closed during
the quarter.</p>
<ol>
  <li>Expand the partner programme to two more countries</li>
  <li>Hire a dedicated partner manager</li>
</ol>
<h2>South</h2>
<p>Revenue grew by 9%. Longer sales cycles in the public sector delayed two large contracts to the next quarter.</p>
<h4>Assumptions</h4>
<p>Figures are reported in US dollars using average exchange rates for the period. Configuration values such as
<code>forecast.horizon = 4</code> were kept unchanged.</p>
<pre><code>forecast:
  horizon: 4
  confidence: 0.9</code></pre>
<hr/>
<h5>Notes</h5>
<p>Detailed regional reports are available on request.</p>
<h6>Confidential</h6>
<p>This document is intended for internal use only.</p>`
]
