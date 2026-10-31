// SPDX-License-Identifier: EPL-2.0
//
// `.svelte` stand-in for Jest: resource packages imported for their helpers (diffview-resources' parseDiff) also
// import their components, which the ts-jest runtime cannot compile. The tests never render them.

const component = {}
export default component
