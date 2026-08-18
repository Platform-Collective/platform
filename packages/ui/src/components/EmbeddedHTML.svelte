<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
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
  import EmbeddedPDF from './EmbeddedPDF.svelte'

  export let src: string
  export let name: string
  export let fit: boolean = false
  export let css: string | undefined = undefined
  export let token: string | undefined = undefined
</script>

<!-- css is injected into the iframe document by EmbeddedPDF (DOCX-to-HTML preview). -->
<EmbeddedPDF {src} {name} {fit} {css} {token} />
