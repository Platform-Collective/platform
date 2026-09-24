<!--
// Copyright © 2026 Intabia Fusion.
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License, this file is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import type { IntlString } from '@hcengineering/platform'
  import { translateCB } from '@hcengineering/platform'
  import { themeStore } from '@hcengineering/theme'

  export let label: IntlString
  export let params: Record<string, any> = {}
  export let className: string = 'login-label'
  export let variant: string | undefined = undefined
  // Allow long labels to wrap to multiple lines when true
  export let wrap: boolean = false

  let classes: string = className

  $: {
    const base =
      typeof className === 'string' && className.trim().length > 0 ? className.trim().split(/\s+/)[0] : 'login-label'
    // Build class list: include variant and optional wrap class when requested
    const variantClass = typeof variant === 'string' && variant.trim().length > 0 ? `${base}--${variant}` : ''
    const wrapClass = wrap ? `${base}--wrap` : ''
    classes = [className, variantClass, wrapClass].filter(Boolean).join(' ')
  }

  let _value: string | undefined

  // Reactively translate when label/params/language changes.
  $: if (label !== undefined) {
    translateCB(label, params ?? {}, $themeStore.language, (r) => {
      _value = r
    })
  } else {
    _value = label as string | undefined
  }
</script>

<span class={classes} {...$$restProps}>
  {#if _value !== undefined}
    {_value}
  {:else}
    {label}
  {/if}
</span>

<style lang="scss">
  .login-label {
    color: var(--login-label-color, var(--login-content-color, var(--theme-content-color)));
    display: inline;
    line-height: inherit;
  }
  .login-label--wrap {
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
    text-align: left;
  }
  .login-label--heading {
    color: var(--login-heading-color, inherit);
  }
  .login-label--link {
    color: var(--login-label-link-color, var(--login-content-color, var(--theme-content-color)));
    display: inline;
    line-height: inherit;
  }
  .login-label.caption {
    color: var(--login-caption-color, var(--theme-caption-color));
  }
</style>
