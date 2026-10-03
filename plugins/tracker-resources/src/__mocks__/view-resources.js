//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

const path = require('path')

// Jest stand-in for @hcengineering/view-resources: only the pure filter grammar, without the svelte components.
// The path is built at run time so that the type checkers do not pull view-resources sources into this package.
module.exports = { filterGrammar: require(path.resolve(__dirname, '../../../view-resources/src/filter/grammar')) }
