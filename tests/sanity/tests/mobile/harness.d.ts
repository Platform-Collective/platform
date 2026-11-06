// SPDX-License-Identifier: EPL-2.0
declare module '*.svelte' {
  import type { ComponentType } from 'svelte'
  const component: ComponentType
  export default component
}
