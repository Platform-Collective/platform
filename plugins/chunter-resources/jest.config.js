module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  // Exercise the real Svelte stores, which ship as ESM, in Jest's CommonJS runtime.
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: { allowJs: true } }]
  },
  transformIgnorePatterns: ['/node_modules/(?!svelte/|\\.pnpm/svelte@)']
}
