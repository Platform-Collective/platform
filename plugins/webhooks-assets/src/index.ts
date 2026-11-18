// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors

import { addStringsLoader } from '@hcengineering/platform'
import { webhooksId } from '@hcengineering/webhooks'
import { loadLang } from './lang'

addStringsLoader(webhooksId, loadLang)
