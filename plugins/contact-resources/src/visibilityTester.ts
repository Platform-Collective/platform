//
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2022 Hardcore Engineering Inc.
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
//

import { type Person, type Employee } from '@hcengineering/contact'

export async function canResendInvitation (employee: Employee): Promise<boolean> {
  return !employee.active
}

/**
 * Employees and local persons can both be merged. The merge dialog itself checks
 * whether two global persons may be merged.
 */
export async function canMergePersons (person: Person): Promise<boolean> {
  return true
}
