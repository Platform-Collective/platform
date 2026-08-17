//
// Copyright © 2025 Hardcore Engineering Inc.
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

import {
  type Account,
  type AttachedData,
  type AttachedDoc,
  type Class,
  type Data,
  type Doc,
  type DocumentUpdate,
  type DocumentQuery,
  type DomainParams,
  type DomainRequestOptions,
  type DomainResult,
  type FindOptions,
  type FindPageOptions,
  type FindPageResult,
  type FulltextStorage,
  type Hierarchy,
  type IterateOptions,
  type Mixin,
  type MixinData,
  type MixinUpdate,
  type ModelDb,
  type OperationDomain,
  type PersonId,
  type PersonUuid,
  type Ref,
  type SocialIdType,
  type Space,
  type Storage,
  type Timestamp,
  type TxResult,
  type WithLookup
} from '@hcengineering/core'

export interface RestClient extends Storage, FulltextStorage {
  getAccount: () => Promise<Account>

  findOne: <T extends Doc>(
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: FindOptions<T>
  ) => Promise<WithLookup<T> | undefined>

  findAllPage: <T extends Doc>(
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options: FindPageOptions<T>
  ) => Promise<FindPageResult<T>>

  iterateAll: <T extends Doc>(
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: IterateOptions<T>
  ) => AsyncIterable<WithLookup<T>>

  getModel: () => Promise<{ hierarchy: Hierarchy, model: ModelDb }>

  domainRequest: <T>(
    domain: OperationDomain,
    params: DomainParams,
    options?: DomainRequestOptions
  ) => Promise<DomainResult<T>>

  ensurePerson: (
    socialType: SocialIdType,
    socialValue: string,
    firstName: string,
    lastName: string,
    options?: EnsurePersonOptions
  ) => Promise<{ uuid: PersonUuid, socialId: PersonId, localPerson: string }>

  createDoc: <T extends Doc>(
    _class: Ref<Class<T>>,
    space: Ref<Space>,
    attributes: Data<T>,
    id?: Ref<T>,
    modifiedOn?: Timestamp,
    modifiedBy?: PersonId
  ) => Promise<Ref<T>>

  addCollection: <T extends Doc, P extends AttachedDoc>(
    _class: Ref<Class<P>>,
    space: Ref<Space>,
    attachedTo: Ref<T>,
    attachedToClass: Ref<Class<T>>,
    collection: Extract<keyof T, string> | string,
    attributes: AttachedData<P>,
    id?: Ref<P>,
    modifiedOn?: Timestamp,
    modifiedBy?: PersonId
  ) => Promise<Ref<P>>

  update: <T extends Doc>(
    doc: T,
    update: DocumentUpdate<T>,
    retrieve?: boolean,
    modifiedOn?: Timestamp,
    modifiedBy?: PersonId
  ) => Promise<TxResult>

  remove: <T extends Doc>(doc: T, modifiedOn?: Timestamp, modifiedBy?: PersonId) => Promise<TxResult>

  createMixin: <D extends Doc, M extends D>(
    objectId: Ref<D>,
    objectClass: Ref<Class<D>>,
    objectSpace: Ref<Space>,
    mixin: Ref<Mixin<M>>,
    attributes: MixinData<D, M>,
    modifiedOn?: Timestamp,
    modifiedBy?: PersonId
  ) => Promise<TxResult>

  updateMixin: <D extends Doc, M extends D>(
    objectId: Ref<D>,
    objectClass: Ref<Class<D>>,
    objectSpace: Ref<Space>,
    mixin: Ref<Mixin<M>>,
    attributes: MixinUpdate<D, M>,
    modifiedOn?: Timestamp,
    modifiedBy?: PersonId
  ) => Promise<TxResult>
}

export interface EnsurePersonOptions {
  addGuestEmployee?: boolean
}
