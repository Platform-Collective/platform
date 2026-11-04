// SPDX-License-Identifier: EPL-2.0

import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import path from 'path'
import ts from 'typescript'

// Chile starts daylight saving time at local midnight (2026-09-06 00:00 -> 01:00), so that day has no 00:00.
// Jest sandboxes process.env, so the helpers are run in a child Node process with TZ set for real.
function runInZone (timeZone: string, body: string): any {
  const source = readFileSync(path.join(__dirname, '../calendar-dates.ts'), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 }
  }).outputText
  const script = `const module = { exports: {} }
;(function (exports, module) {\n${compiled}\n})(module.exports, module)
const m = module.exports
process.stdout.write(JSON.stringify((() => {\n${body}\n})()))`
  const output = execFileSync(process.execPath, ['-'], { input: script, env: { ...process.env, TZ: timeZone } })
  return JSON.parse(output.toString())
}

describe('issues grouped by calendar day across a DST change at midnight', () => {
  it('lists a range on every day it covers, including the days after the change', () => {
    const result = runInZone(
      'America/Santiago',
      `const issue = { id: 'range', startDate: new Date(2026, 8, 4, 10).getTime(), dueDate: new Date(2026, 8, 9, 10).getTime() }
      const groups = m.groupIssuesByCalendarDay([issue], m.getCalendarQueryWindow(new Date(2026, 8, 15)))
      const days = []
      for (let day = 3; day <= 10; day++) {
        const date = new Date(2026, 8, day, 12)
        days.push({
          day,
          listed: (groups.get(m.getCalendarDayKey(date)) || []).length,
          expected: m.isIssueOnCalendarDay(issue, date) ? 1 : 0
        })
      }
      return { dstDayStartsAt: new Date(2026, 8, 6).getHours(), days }`
    )
    expect(result.dstDayStartsAt).toBe(1)
    expect(result.days).toEqual(
      [3, 4, 5, 6, 7, 8, 9, 10].map((day) => {
        const expected = day >= 4 && day <= 9 ? 1 : 0
        return { day, listed: expected, expected }
      })
    )
  })
})
