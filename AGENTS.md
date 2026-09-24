# Foundation Platform - AI Agent Instructions

TypeScript/Svelte 4 monorepo using Rush.js (pnpm 10.15.1), Node >=20 <25, Webpack 5, Electron, Jest.

## Interaction preferences

Respond to user using Russian language, all comments should be in English.

## Code Style

**TypeScript**: Strict types, interfaces over types, avoid `any`, export types separately
**Svelte**: Script/style/markup order, reactive `$:`, stores for state, small focused components
**Naming**: Files `kebab-case`, Components `PascalCase`, functions `camelCase`, constants `UPPER_SNAKE_CASE`

## Structure

- `models/*` - Shared types/models
  - If add resources like component: '' as AnyComponent, ensure is it added into one of api package/resources package or model package. It should be defined only once. It could be IntlString as well or any other '' as Ref<something> declaration.
- `server-*` - Server packages
- `plugins/*` - Client plugins
- `packages/*` - Reusable utilities
- Projects 2-3 levels deep, each with `package.json`

## Rush Commands

```bash
rush install         # Install deps
rush build           # Build all
rush build --to PKG  # Build specific
rush add -p PKG      # Add dependency
```

## Docker Build Workflow

**IMPORTANT**: After making changes to service code (in `services/`, `pods/`, etc.), you must rebuild Docker images:

**Note**: If you're running the UI via `rush dev` (dev-server), you don't need to restart the `front` Docker container. Changes will be picked up automatically by the dev server.

```bash
# Build Docker images for specific service
rush docker:build --to @hcengineering/pod-ai-bot
rush docker:build --to @hcengineering/love-agent

# Restart Docker containers to use new images
docker compose -f dev/docker-compose.yaml restart aibot
docker compose -f dev/docker-compose.yaml restart love-agent
```

**Workflow for service changes:**
1. Make code changes to service
2. Run `rush build --to <package>` (builds TypeScript)
3. Never Run `rushx format` in the package directory (format & lint) - MAY CAUSE FILE CORRUPTIONS. Lets user do it.
4. Run `diagnostics` to check for errors
5. Run `rush docker:build --to <package>` (builds Docker image)
6. Restart the Docker container

Example for ai-bot service:
```bash
# After editing services/ai-bot/pod-ai-bot/src/workspace/love.ts
cd services/ai-bot/pod-ai-bot
diagnostics path: "services/ai-bot/pod-ai-bot/src/workspace/love.ts"
cd ../../..
rush docker:build --to @hcengineering/pod-ai-bot
docker compose -f dev/docker-compose.yaml restart aibot
```

## Error Checking

**IMPORTANT**: Use `diagnostics` tool to check for TypeScript/Svelte errors, NOT `rush build`:

- ✅ `diagnostics()` - Check all files for errors/warnings (fast, uses language server)
- ✅ `diagnostics({ path: "plugins/tracker-resources/src/utils.ts" })` - Check specific file
- ❌ `rush build` - Don't use for error checking (runs full transpilation, slower)

`rush build` performs transpilation which may succeed even with type errors. Always use `diagnostics` to verify code correctness.

### Validation in Modified Projects

After making changes, always validate the affected packages to ensure diagnostics are accurate:

```bash
# Navigate to each modified package and run:
cd <modified-package-directory>
rushx build
rushx _phase:validate

# Examples:
cd plugins/love-resources
rushx build
rushx _phase:validate

cd models/love
rushx build
rushx _phase:validate

cd server-plugins/love-resources
rushx build
rushx _phase:validate
```

This ensures that the language server has the correct build artifacts and validation passes for the specific packages you modified.

## Formatting and Linting

**AI AGENTS: DO NOT run formatting commands automatically.** Formatting can corrupt or erase files. Let the user handle formatting.

This ensures code style consistency and catches linting errors before commit.

### ⚠️ CRITICAL: Formatting Safety Rules

**NEVER run formatting commands in parallel or concurrently.** The formatter can corrupt or completely erase file contents when run simultaneously on multiple packages.

Rules:
- ❌ **DO NOT** run `rushx format` commands
- ❌ **DO NOT** use `--force` flag with formatting - it can cause content loss
- ✅ **DO** run formatting sequentially, one package at a time
- ✅ **DO** verify file contents after formatting with `git diff` or `git status`
- ✅ **DO** restore files immediately with `git checkout -- <file>` if content is lost

If you see files becoming empty or losing content after formatting, immediately restore them:
```bash
git checkout -- <affected-files>
```

## Changelog generation

When generating changelogs (the "All commits" lists), follow these rules:

- Exclude commits whose subject contains `Merge remote-tracking` (filter them out).
- Strip `Signed-off-by:` footers from commit messages (remove the footer content and any lines that are only `Signed-off-by:`).
- Recommended pipeline (example):

```bash
git log --pretty=format:'- %h %s' <range> | grep -v -F 'Merge remote-tracking' | sed -E 's/\s*Signed-off-by:.*$//'
```

- Note: `git log --no-merges` removes all merge commits; use it only if you intentionally want to omit all merges.

Apply these filters when updating `changelog.md` or generating release notes so the generated logs exclude noisy merge-tracking commits and signed-off-by lines.

## Patterns

- Always handle errors (proper Error subclasses, catch promises)
- Use async/await, Promise.all() for parallel ops
- Svelte stores for shared state, separate business logic
- JSDoc public APIs, tests alongside code
- Check with `diagnostics` before making changes; do not commit locally — use diffs for review and let maintainers handle commits

## Debugging Workflow

When debugging issues:

1. **Add comprehensive logging first** - use `console.log` with structured objects showing state, parameters, IDs
2. **Test and analyze logs** - let user run the app and provide actual console output
3. **Propose options before applying fixes or workarounds** - when you identify multiple possible approaches (including quick or temporary workarounds), outline each option clearly (pros, cons, risks, and how invasive the change is) and ask the user which variant to proceed with. Do not implement non-trivial temporary workarounds without explicit approval.
4. **Identify root cause** from logs - trace the flow, compare expected vs actual values
5. **Fix the issue** based on findings
6. **Remove all logging** after fix is confirmed - keep production code clean

Logging format:

```typescript
console.log('[ComponentName.methodName] Description', {
  key1: value1,
  key2: value2,
  objectId: object?._id // Use optional chaining for safety
})
```

## Avoid

❌ `any` without reason
❌ `console.log()` in production
❌ Mixed concerns
❌ Circular deps
❌ Ignoring TS errors
❌ Using `rush build` to check for errors
❌ Running formatting in parallel (causes content loss!)
❌ Using `--force` flag with formatter

❌ **Git policy**: do NOT make commits, resets, reverts, or switch branches. Use git only for read-only operations (diff, status, log).

## When Coding

- Infer location from context (models/server/plugins/packages)
- Match existing patterns in codebase
- Include proper imports/types
- When adding a new `IntlString` key, add corresponding entries to the component language files under `component-assets/lang` for every supported locale (at minimum include the English entry) and update translations as needed; ensure you run `diagnostics()`. Do not commit changes locally — prepare a diff for review and let maintainers perform commits. !!! If diagnostics are not disappearing for fixed items, stop and inform user to reload language servers or wait for build. Wait for continue request from user.
- Add error handling
- Use existing utils first
- When fixing bugs:
  - Read existing code thoroughly before changing
  - Use logging to understand actual runtime behavior
  - Trace data flow through components
  - Verify assumptions with logs before implementing fixes
  - Remove debug code when done

## Navigation & Selection Architecture

The app uses a provider-based selection/focus system:

- `focusStore` - global focus state
- `selectionStore` - global selection state
- `ListSelectionProvider` - manages list navigation, delegates to view-specific handlers
- `SelectDirection` - `'vertical'` (up/down) or `'horizontal'` (left/right in tables, first/last in lists)

Key principles:

- Navigation uses **actual displayed order** (from `getLimited()`) not projection order
- Focus changes propagate through `updateFocus()`
- Selection follows focus via provider delegation
- Scroll happens automatically via `scrollIntoView()` on navigation

## License

For every new files please add a 2026 Intabia Fusion license header like this:

```ts
/**
  Copyright © 2026 Intabia Fusion.

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
  
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  
  See the License for the specific language governing permissions and
  limitations under the License.
*/
```

For Svelte files (`.svelte`) use an HTML comment wrapper and prefix each line with `//` (to avoid interfering with markup and ensure clear in-file commenting). Example Svelte header:

```svelte
<!--
// Copyright © 2026 Intabia Fusion.
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
```
