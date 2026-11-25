# Releasing npm packages

The [Publish npm workflow](../.github/workflows/publish-npm.yml) releases the Rush projects marked
`shouldPublish: true` under `@hcengineering/*`, excluding manifests with `private: true`.
This workflow is the sole automated npm publishing path; the main CI workflow handles other release artifacts.
The legacy local `bump.js --publish` option remains available but bypasses this workflow's gates.

## Access and environment protection

Before merging the workflow, a repository administrator must create the `npm-publish` GitHub environment, configure
required maintainer reviewers, and add a `v*` tag deployment rule. GitHub can auto-create a missing environment without
protection; referencing it in YAML does not enable reviews. The build job checks these settings across all deployment
rule pages before building and fails if the environment is missing or unprotected. Protect release tags as well.

The npm scope owner must enable one of these access options for every package being released:

- Add a named Platform Collective maintainer to the `@hcengineering` npm organization with package/team write access.
  That maintainer can configure an appropriately scoped publishing token as the `npm-publish` environment's
  `NPM_TOKEN` secret, subject to npm's current publishing and 2FA policy.
- Configure [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) for GitHub organization
  `Platform-Collective`, repository `platform`, workflow filename `publish-npm.yml`, and environment `npm-publish`.
  In that trusted publisher's **Allowed actions**, enable direct `npm publish`, since this workflow publishes
  immediately rather than using `npm stage publish`. OIDC needs no `NPM_TOKEN`; npm tries OIDC before token fallback.
  A new trusted publisher configuration expires unless its first publish succeeds within 2 days; delete and recreate
  it if it expires (see the linked npm documentation).

`@hcengineering/gantt` does not yet exist on npm and remains in the release set. Its first publication requires an
authorized scope maintainer's publishing token in the environment's `NPM_TOKEN` secret, or an initial manual publish
before configuring its trusted publisher. Configure this before the first release: OIDC alone cannot create the package.

## Release steps

1. Choose one unused stable `major.minor.patch` version for all packages, greater than the published baseline
   `0.7.423` and every package's current registry `latest`. Prerelease/build suffixes are rejected.
2. From the repository root, run `node common/scripts/bump.js <version>` to update package versions and internal
   dependency ranges together. Review and commit that release change separately before tagging.
3. In a clean checkout, run the following checks with Node from `.nvmrc` and npm >=11.5.1:

   ```bash
   node common/scripts/install-run-rush.js install
   node common/scripts/bump.js --check <version>
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
Packing removes `workspace:` dependency prefixes, including peer dependency prefixes, without changing package names or
introducing aliases. It sets repository metadata to the GitHub publishing repository for provenance, then restores the
manifests. The build checks the actual tarballs passed to publishing.

All registry/version checks complete before any publish; downgrades and registry errors abort that preflight. Packages
are published in internal dependency order. Already published matching versions are skipped on retries. A publish-time
failure stops dependent packages, can still leave a partial release, and prints the command that resumes it.
`safe-publish.js` has no publishing dry-run mode: use `--check-types` for the non-publishing pack check.
