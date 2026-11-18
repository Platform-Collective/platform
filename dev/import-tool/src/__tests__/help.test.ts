// SPDX-License-Identifier: EPL-2.0

// Help must work without connecting to a workspace or loading import services.
jest.mock('@hcengineering/core', () => ({}))
jest.mock('@hcengineering/importer', () => ({}))
jest.mock('@hcengineering/platform', () => ({}))
jest.mock('@hcengineering/server-client', () => ({}))
jest.mock('js-yaml', () => ({}))
jest.mock('mammoth', () => ({}))
jest.mock('commander', () => {
  const commander = jest.requireActual('commander')
  return { ...commander, program: new commander.Command() }
})

import { Command, CommanderError, program } from 'commander'
import { importTool } from '../index'

describe('import tool help', () => {
  const originalArgv = process.argv

  beforeEach(() => {
    jest.requireMock('commander').program = new Command()
  })

  afterEach(() => {
    process.argv = originalArgv
  })

  it.each([
    ['import-clickup-tasks', /import tasks exported from ClickUp as CSV/],
    ['import-notion-to-teamspace', /import extracted archive exported from Notion/],
    ['import-notion-with-teamspaces', /import extracted archive exported from Notion/]
  ])('describes the input format for %s', (command, description) => {
    let output = ''
    program.exitOverride().configureOutput({
      writeOut: (text) => {
        output += text
      }
    })
    process.argv = ['node', 'import-tool', command, '--help']

    try {
      importTool()
      throw new Error('Expected help to exit')
    } catch (error) {
      expect(error).toBeInstanceOf(CommanderError)
      expect((error as CommanderError).code).toBe('commander.helpDisplayed')
    }

    expect(output).toMatch(description)
    expect(output).toContain('--workspace')
    if (command === 'import-clickup-tasks') {
      expect(output).toContain('<file>')
      expect(output).not.toContain('Notion')
    }
  })
})
