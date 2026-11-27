# Releasing npm packages

The [Publish npm workflow](../.github/workflows/publish-npm.yml) releases the Rush projects marked
`shouldPublish: true` under `@hcengineering/*`, excluding manifests with `private: true`, and publishes them to npm as
`@platformcollective/*`. Both scopes and the baseline version are set in
[`common/config/npm-publish.json`](../common/config/npm-publish.json).
This workflow is the sole automated npm publishing path; the main CI workflow handles other release artifacts.
The legacy local `bump.js --publish` option remains available but bypasses this workflow's gates.

## Package names

Packages keep their `@hcengineering/*` names in this repository, so upstream sync and imports are unchanged. Packing
renames each package to `@platformcollective/*` and turns dependencies on other published packages, including peer
dependencies, into npm aliases that keep their source names, for example
`"@hcengineering/core": "npm:@platformcollective/core@^0.7.433"`. The published code, which imports
`@hcengineering/*`, therefore resolves to the `@platformcollective/*` packages. Packing fails if a published package has
a runtime or peer dependency on an `@hcengineering/*` package that is not published, since consumers would otherwise
install the upstream package of that name. Development dependencies are not aliased.

## Access and environment protection

Before merging the workflow, a repository administrator must create the `npm-publish` GitHub environment, configure
required maintainer reviewers, and add a `v*` tag deployment rule. GitHub can auto-create a missing environment without
protection; referencing it in YAML does not enable reviews. The build job checks these settings across all deployment
rule pages before building and fails if the environment is missing or unprotected. Protect release tags as well.

The owner of the `@platformcollective` npm organization must enable one of these access options for every package
being released:

- Give a named Platform Collective maintainer package/team write access in the `@platformcollective` npm organization.
  That maintainer can configure an appropriately scoped publishing token as the `npm-publish` environment's
  `NPM_TOKEN` secret, subject to npm's current publishing and 2FA policy.
- Configure [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) for GitHub organization
  `Platform-Collective`, repository `platform`, workflow filename `publish-npm.yml`, and environment `npm-publish`.
  In that trusted publisher's **Allowed actions**, enable direct `npm publish`, since this workflow publishes
  immediately rather than using `npm stage publish`. OIDC needs no `NPM_TOKEN`; npm tries OIDC before token fallback.
  A new trusted publisher configuration expires unless its first publish succeeds within 2 days; delete and recreate
  it if it expires (see the linked npm documentation).

No `@platformcollective/*` package exists on npm before the first release, and OIDC alone cannot create a package.
The first release therefore needs an authorized maintainer's publishing token in the environment's `NPM_TOKEN` secret.
Trusted publishers can be configured for each package once it exists. The same applies to any package added later.

## Release steps

1. Choose one unused stable `major.minor.patch` version for all packages, greater than `baselineVersion` in
   `common/config/npm-publish.json` (currently `0.7.432`, the latest `s0.7.432` release) and not lower than any package's current registry `latest`
   under `@platformcollective`. Prerelease/build suffixes are rejected. The workflow checks both with
   `safe-publish.js --check-version` before building; a version equal to the highest registry `latest` is accepted so
   a partially published release can be resumed.
2. From the repository root, run `node common/scripts/bump.js <version>` to update package versions and internal
   dependency ranges together. Review and commit that release change separately before tagging.
3. In a clean checkout, run the following checks with Node from `.nvmrc` and npm >=11.5.1:

   ```bash
   node common/scripts/install-run-rush.js install
   node common/scripts/bump.js --check <version>
   node common/scripts/safe-publish.js --check-version <version>
   node common/scripts/install-run-rush.js build
   node common/scripts/install-run-rush.js validate
   node common/scripts/safe-publish.js --check-types
   ```

4. Push the `v<version>` tag at the reviewed release commit and approve the `npm-publish` environment deployment.
   Manual retries must select that tag as the workflow ref; branch and suffixed tag refs fail before environment approval.
   The build job repeats install, version, build, validation and pack checks without OIDC or publishing secrets.
   It passes checked tarballs as an artifact to the protected publishing job, which publishes with provenance and
   package scripts disabled. Neither job restores dependency caches; both allow 60 minutes.

Validation emits the TypeScript declarations; building alone does not. The pack check verifies top-level `types` and
nested `exports` types entries against npm's packed file list (`--check-types` uses `npm pack --dry-run --json --ignore-scripts`).
Packing removes `workspace:` dependency prefixes, including peer dependency prefixes, and renames packages and
dependencies as described in [Package names](#package-names). It sets repository metadata to the GitHub publishing repository for provenance, then restores the
manifests. The build checks the actual tarballs passed to publishing.

All registry/version checks complete before any publish; downgrades and registry errors abort that preflight. Packages
are published in internal dependency order. Already published matching versions are skipped on retries. A publish-time
failure stops dependent packages, can still leave a partial release, and prints the command that resumes it.
`safe-publish.js` has no publishing dry-run mode: use `--check-types` for the non-publishing pack check.
