<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type Notification, NotificationToast } from '@hcengineering/ui'

  export let notification: Notification
  export let onRemove: () => void
</script>

<NotificationToast title={notification.title} severity={notification.severity} onClose={onRemove} />
