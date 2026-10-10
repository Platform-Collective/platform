<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import { errorLabel } from '../errors'

  export let error: unknown
</script>

<span class="error-color"><Label label={errorLabel(error)} /></span>
