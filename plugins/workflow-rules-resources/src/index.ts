// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

import { type Resources } from '@hcengineering/platform'

import WorkflowRulesPanel from './components/WorkflowRulesPanel.svelte'
import EditWorkflowRule from './components/EditWorkflowRule.svelte'
import PairProjectEditor from './components/PairProjectEditor.svelte'

export default async (): Promise<Resources> => ({
  component: {
    WorkflowRulesPanel,
    EditWorkflowRule,
    PairProjectEditor
  }
})
