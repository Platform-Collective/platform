// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

import { loadMetadata } from '@hcengineering/platform'
import workflowRules from '@hcengineering/workflow-rules'

const icons = require('../assets/icons.svg') as string // eslint-disable-line
loadMetadata(workflowRules.icon, {
  WorkflowRule: `${icons}#workflow-rule`
})
