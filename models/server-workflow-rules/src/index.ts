// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

import core from '@hcengineering/core'
import { type Builder } from '@hcengineering/model'
import tracker from '@hcengineering/tracker'
import serverCore from '@hcengineering/server-core'
import serverWorkflowRules from '@hcengineering/server-workflow-rules'

export { serverWorkflowRulesId } from '@hcengineering/server-workflow-rules'

export function createModel (builder: Builder): void {
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverWorkflowRules.trigger.OnWorkflowRuleMirror,
    txMatch: {
      _class: core.class.TxUpdateDoc,
      objectClass: tracker.class.Issue
    }
  })
}
