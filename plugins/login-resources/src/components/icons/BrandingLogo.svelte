<!--
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
<script lang="ts">
  import { getMetadata } from '@hcengineering/platform'
  import { themeStore } from '@hcengineering/ui'
  import login from '../../plugin'

  // 'large' above the login card, 'small' in the onboarding header
  export let size: 'large' | 'small' = 'large'

  const logo = getMetadata(login.metadata.LoginLogo)

  $: src = $themeStore.dark ? (logo?.dark ?? logo?.light) : logo?.light
</script>

{#if src !== undefined}
  <img class="branding-logo {size}" {src} alt={logo?.alt ?? ''} />
{/if}

<style lang="scss">
  .branding-logo {
    display: block;
    width: auto;
    max-width: 100%;
    object-fit: contain;
    user-select: none;
    pointer-events: none;

    &.large {
      height: 2.25rem;
    }
    &.small {
      height: 1.5rem;
    }
  }
</style>
