// SPDX-License-Identifier: EPL-2.0

import type { Loader } from '@hcengineering/platform'

export const loadLang: Loader = async (lang) => await import(`../lang/${lang}.json`)
