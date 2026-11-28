<!--
  SPDX-License-Identifier: EPL-2.0

  Copyright © 2026 Platform Collective Contributors

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
-->
<script lang="ts">
  // Placeholder shell for the Webhooks settings tab. PR 1 lands only
  // the model, authorization middleware, and the registration plumbing
  // that puts this tab in Settings. The management UI (list, create,
  // edit, test, delivery history) ships in a follow-up PR alongside
  // the delivery service.
  //
  // See docs/webhooks/DESIGN.md for the full user-facing surface this
  // tab is expected to grow into.
</script>

<div class="webhooks-settings-shell">
  <h2>Webhooks</h2>
  <p>
    This workspace manages outbound webhook subscriptions here. The
    management surface ships in a follow-up PR; the plugin descriptor,
    model, and authorization middleware land first so the server-side
    rules can be reviewed in isolation.
  </p>
  <p class="dim">
    See the design document for the planned surface: list, create,
    edit, test send, rotate secret, delivery history.
  </p>
</div>

<style lang="scss">
  .webhooks-settings-shell {
    padding: 2rem;
    max-width: 42rem;

    h2 {
      font-size: 1.25rem;
      font-weight: 500;
      margin: 0 0 1rem;
    }

    p {
      line-height: 1.5;
      margin: 0 0 0.75rem;
    }

    .dim {
      opacity: 0.7;
    }
  }
</style>
