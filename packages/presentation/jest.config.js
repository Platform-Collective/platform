const SVELTE_MOCKS_PATH = '<rootDir>/src/__mocks__'

module.exports = {
  projects: [
    // default configuration for most tests (node environment)
    {
      displayName: 'node',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
      testPathIgnorePatterns: ['.*drawing\\.test\\.ts$', '.*markup-images\\.test\\.ts$', '.*html-image-viewer\\.test\\.ts$']
    },
    // Mount the production markup viewers, including their recursive Svelte node tree.
    {
      displayName: 'markup',
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      testMatch: ['**/markup-images.test.ts', '**/html-image-viewer.test.ts'],
      transform: {
        '^.+\\.ts$': 'ts-jest',
        '^.+\\.(svelte|js)$': '<rootDir>/src/__tests__/svelte-transformer.cjs'
      },
      transformIgnorePatterns: ['/node_modules/(?!svelte/|zeed-dom/|\\.pnpm/(svelte|zeed-dom)@)'],
      moduleNameMapper: {
        // These viewers use only text-core exports, without the editor's Tiptap schema.
        '^@hcengineering/text$': '<rootDir>/../../foundations/core/packages/text-core/src/index.ts',
        '^@hcengineering/text-(core|html|markdown)$': '<rootDir>/../../foundations/core/packages/text-$1/src/index.ts',
        // Unrelated leaf nodes are outside this test; keep the recursive image tree real.
        '/(CodeBlockNode|ObjectNode|MarkdownNode|Mark)\\.svelte$': '<rootDir>/src/__tests__/EmptyNode.svelte'
      }
    },
    // configuration for drawing tests (jsdom environment)
    {
      displayName: 'jsdom',
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      testMatch: ['**/drawing.test.ts'],
      moduleNameMapper: {
        '^@hcengineering/platform-rig/profiles/ui/svelte$': `${SVELTE_MOCKS_PATH}/svelte-runtime.ts`,
        '^svelte/store$': `${SVELTE_MOCKS_PATH}/svelte-store.ts`,
        '^svelte/transition$': `${SVELTE_MOCKS_PATH}/svelte-transition.ts`,
        '^svelte/animate$': `${SVELTE_MOCKS_PATH}/svelte-animate.ts`,
        '^svelte$': `${SVELTE_MOCKS_PATH}/svelte.ts`,
        '\\.svelte$': `${SVELTE_MOCKS_PATH}/svelte-component.ts`
      },
      // setup files to run before tests
      setupFilesAfterEnv: [`${SVELTE_MOCKS_PATH}/setup.ts`],
      // allow transformation of ES modules in case we encounter them
      transformIgnorePatterns: [
        'node_modules/(?!(svelte|@sveltejs|@testing-library)/)'
      ]
    }
  ]
}
