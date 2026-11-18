// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors

import type { Loader } from '@hcengineering/platform'

export const loadLang: Loader = async (lang) => await import(`../lang/${lang}.json`)
