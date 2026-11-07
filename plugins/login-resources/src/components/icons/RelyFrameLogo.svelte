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
  import { themeStore } from '@hcengineering/ui'

  import logoWhite from '../../../img/relyframe-wordmark-white.png'
  import logoBlack from '../../../img/relyframe-wordmark-black.png'

  $: src = $themeStore.dark ? logoWhite : logoBlack
</script>

<img class="relyframe-logo" {src} alt="RelyFrame" />

<style lang="scss">
  .relyframe-logo {
    display: block;
    height: 2.25rem;
    width: auto;
    user-select: none;
    pointer-events: none;
  }
</style>
