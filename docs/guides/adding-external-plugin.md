# Adding an external plugin

The built-in plugin lists remain unchanged. Register additional plugins only in these extension files:

| File | Registrations |
| --- | --- |
| `models/all/src/extra.ts` | Model builders, plugin configuration, and migrations |
| `server/server-pipeline/src/extra.ts` | Server resources and server-side string loaders |
| `dev/prod/src/extra.ts` | Web assets, string loaders, and client resources |
| `desktop/src/ui/extra.ts` | Desktop assets, string loaders, and client resources |

The extension files contain no plugin registrations by default, so a build without additional plugins is unchanged. The same server extension is used by the server pipeline and the standalone tool. Only the files needed by a plugin have to be changed.

## Package setup

Add every new workspace package to `rush.json` with its `packageName` and `projectFolder`; the extension files do not replace these entries. Also declare each imported package as a dependency of the consuming project:

- `models/all/package.json` for model packages.
- `server/server-pipeline/package.json` for server plugin and resource packages.
- `dev/prod/package.json` for web plugin, resource, and asset packages.
- `desktop/package.json` for desktop plugin, resource, and asset packages.

Run `rush update` after changing dependencies. Use static module names in imports so Webpack and esbuild can include the packages in their bundles.

## Minimal example

The following snippets register a fictional `hello` plugin. They are examples only; no such package is shipped by this repository.

### Model and migrations

Add the model builder in `models/all/src/extra.ts`. The optional third tuple element accepts the same plugin configuration as a built-in builder. Add a migration operation only when the plugin provides one.

```ts
import { createModel, helloId, helloOperation } from '@example/model-hello'

extraModelBuilders.push([createModel, helloId])
extraMigrateOperations.push(['hello', helloOperation])
```

Extra builders and migrations run after the built-in entries.

### Server resources

Register server resources in `registerExtraServerPlugins` in `server/server-pipeline/src/extra.ts`:

```ts
import { addLocation } from '@hcengineering/platform'
import { serverHelloId } from '@example/server-hello'

addLocation(serverHelloId, () => import('@example/server-hello-resources'))
```

If server code needs plugin translations, register its string loader in `registerExtraServerStringLoaders` in the same file.

### Web and desktop

Import assets at module scope and register translations and resources in `configureExtraWebPlugins` in `dev/prod/src/extra.ts`:

```ts
import { addLocation, addStringsLoader } from '@hcengineering/platform'
import { helloId } from '@example/hello'
import '@example/hello-assets'
import * as HelloLang from '@example/hello-assets/lang'

addStringsLoader(helloId, HelloLang.loadLang)
addLocation(helloId, () => import('@example/hello-resources'))
```

For the desktop application, add the same registrations to `configureExtraDesktopPlugins` in `desktop/src/ui/extra.ts`. Keep the asset imports at module scope in both files.
