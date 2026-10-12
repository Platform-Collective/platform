import { defineConfig } from 'eslint/config'
import love from 'eslint-config-love'
import secureCoding from 'eslint-plugin-secure-coding'
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
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/promise-function-async': 'off'
    }
  }
])
