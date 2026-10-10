import { defineConfig } from 'eslint/config'
import typescriptEslint from '@typescript-eslint/eslint-plugin'
import typescriptParser from '@typescript-eslint/parser'
import love from 'eslint-config-love'
import importPlugin from 'eslint-plugin-import'
import secureCoding from 'eslint-plugin-secure-coding'
import svelte from 'eslint-plugin-svelte'
import legacyCompatibilityRuleList from '../legacy-compatibility-rules.json' with { type: 'json' }

const LEGACY_COMPATIBILITY_RULES = Object.fromEntries(
  legacyCompatibilityRuleList.map((rule) => [rule, 'off'])
)

export default defineConfig([
  {
    ignores: ['**/*.json', '**/node_modules/**', '**/.eslintrc.js']
  },
  {
    files: ['**/*.{js,cjs,mjs,ts,cts,mts}'],
    extends: [love, secureCoding.configs.recommended],
    rules: {
      ...LEGACY_COMPATIBILITY_RULES,
      '@typescript-eslint/consistent-type-exports': 'off',
      'svelte/no-at-html-tags': 'error'
    }
  },
  ...svelte.configs.recommended,
  {
    files: ['**/*.svelte'],
    extends: [secureCoding.configs.recommended],
    languageOptions: {
      parserOptions: {
        parser: typescriptParser,
        projectService: true,
        extraFileExtensions: ['.svelte']
      }
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
      import: importPlugin
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { varsIgnorePattern: '^\\$\\$(Props|Events|Slots)$' }],
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/promise-function-async': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      'import/first': 'warn',
      'import/no-duplicates': 'warn',
      'import/no-mutable-exports': 'off',
      'import/no-unresolved': 'warn',
      'no-multiple-empty-lines': 'warn',
      'no-undef-init': 'off',
      'no-use-before-define': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/strict-boolean-expressions': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/no-use-before-define': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn'
    }
  }
])
