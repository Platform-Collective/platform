<!--
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021, 2022 Hardcore Engineering Inc.
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
-->
<script lang="ts">
  import { getMetadata, setMetadata } from '@hcengineering/platform'
  import presentation from '@hcengineering/presentation'
  import {
    Location,
    Popup,
    Scroller,
    fetchMetadataLocalStorage,
    getCurrentLocation,
    location,
    setMetadataLocalStorage
  } from '@hcengineering/ui'
  import { onDestroy, onMount } from 'svelte'
  import Auth from './Auth.svelte'
  import Confirmation from './Confirmation.svelte'
  import ConfirmationSend from './ConfirmationSend.svelte'
  import CreateWorkspaceForm from './CreateWorkspaceForm.svelte'
  import Join from './Join.svelte'
  import AutoJoin from './AutoJoin.svelte'
  import LoginForm from './LoginForm.svelte'
  import ProvidersOnlyForm from './ProvidersOnlyForm.svelte'
  import PasswordRequest from './PasswordRequest.svelte'
  import PasswordRestore from './PasswordRestore.svelte'
  import SelectWorkspace from './SelectWorkspace.svelte'
  import SignupForm from './SignupForm.svelte'
  import LoginTfaForm from './LoginTfaForm.svelte'
  import BottomActionComponent from './BottomAction.svelte'
  import { loginFooterActions } from '../footerActions'
  import { Pages, getAccount, pages } from '..'
  import login from '../plugin'

  import AdminWorkspaces from './AdminWorkspaces.svelte'
  import ChangePassword from './ChangePassword.svelte'

  export let page: Pages = 'signup'

  const signUpDisabled = getMetadata(login.metadata.DisableSignUp) ?? false
  const localLoginHidden = getMetadata(login.metadata.HideLocalLogin) ?? false
  const useOTP = getMetadata(presentation.metadata.MailUrl) != null && getMetadata(presentation.metadata.MailUrl) !== ''
  let navigateUrl: string | undefined
  let tfaToken: string | undefined = undefined

  onDestroy(location.subscribe(updatePageLoc))

  function updatePageLoc(loc: Location): void {
    const token = getMetadata(presentation.metadata.Token)
    page = (loc.path[1] as Pages) ?? (token != null ? 'selectWorkspace' : 'login')
    if (page === 'join' && loc.query?.autoJoin !== undefined) {
      page = 'autoJoin'
    }

    const allowedUnauthPages: Pages[] = [
      'login',
      'signup',
      'password',
      'recovery',
      'join',
      'autoJoin',
      'confirm',
      'confirmationSend',
      'auth',
      'tfa'
    ]
    if (token === undefined ? !allowedUnauthPages.includes(page) : !pages.includes(page)) {
      const account = fetchMetadataLocalStorage(login.metadata.LastAccount)
      page = account != null ? 'login' : 'signup'
    }

    navigateUrl = loc.query?.navigateUrl ?? undefined
    tfaToken = loc.query?.token ?? undefined
  }

  async function chooseToken(): Promise<void> {
    if (page === 'auth') {
      // token handled by auth page
      return
    } else if (page === 'autoJoin') {
      // there's a separate workflow for auto join
      return
    }

    if (getMetadata(presentation.metadata.Token) == null) {
      const lastAccount = fetchMetadataLocalStorage(login.metadata.LastAccount)
      if (lastAccount != null) {
        try {
          const loginInfo = await getAccount(false)
          if (loginInfo != null) {
            setMetadata(presentation.metadata.Token, loginInfo.token)
            setMetadataLocalStorage(login.metadata.LoginAccount, loginInfo.account)
            updatePageLoc(getCurrentLocation())
          }
        } catch (err: any) {
          // do nothing
        }
      }
    }
  }

  onMount(chooseToken)
</script>

{#if page === 'admin'}
  <AdminWorkspaces />
{:else}
  <div class="login w-full h-full">
    <div class="login-column">
      <!-- TODO(rebranding): the logo is intentionally not shown on the login page for now -->
      <div class="login-card">
        <Scroller padding={'1rem 0'}>
          <div class="form-content">
            {#if page === 'login'}
              {#if localLoginHidden}
                <ProvidersOnlyForm />
              {:else}
                <LoginForm {navigateUrl} {signUpDisabled} {useOTP} />
              {/if}
            {:else if page === 'signup'}
              <SignupForm {navigateUrl} {signUpDisabled} {localLoginHidden} {useOTP} />
            {:else if page === 'createWorkspace'}
              <CreateWorkspaceForm />
            {:else if page === 'password'}
              <PasswordRequest {signUpDisabled} />
            {:else if page === 'recovery'}
              <PasswordRestore />
            {:else if page === 'selectWorkspace'}
              <SelectWorkspace {navigateUrl} />
            {:else if page === 'join'}
              <Join />
            {:else if page === 'autoJoin'}
              <AutoJoin />
            {:else if page === 'confirm'}
              <Confirmation />
            {:else if page === 'confirmationSend'}
              <ConfirmationSend />
            {:else if page === 'auth'}
              <Auth />
            {:else if page === 'changePassword'}
              <ChangePassword />
            {:else if page === 'tfa'}
              <LoginTfaForm {navigateUrl} token={tfaToken} on:back={() => (page = 'login')} />
            {/if}
          </div>
        </Scroller>
        {#if $loginFooterActions.length > 0}
          <div class="login-footer">
            {#each $loginFooterActions as footerAction (footerAction.i18n)}
              <BottomActionComponent action={footerAction} />
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <Popup />
  </div>
{/if}

<style lang="scss">
  .login {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--theme-bg-color);
    padding: 2rem 1rem;
    box-sizing: border-box;
  }

  .login-column {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    max-width: 30rem;
    min-width: 0;
    gap: 1.75rem;
  }

  .login-card {
    position: relative;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    border-radius: 1rem;
    background-color: var(--theme-comp-header-color);
    border: 1px solid var(--theme-button-border);
    box-shadow:
      var(--theme-popup-shadow),
      0 12px 32px rgba(0, 0, 0, 0.12);

    // Bounded so long content (e.g. a workspace list) scrolls internally
    // instead of the whole page growing without limit.
    display: flex;
    flex-direction: column;
    max-height: min(38rem, calc(100vh - 8rem));
    overflow: hidden;
  }

  .form-content {
    display: flex;
    flex-direction: column;
    justify-content: center;
    flex-grow: 1;
    min-height: 0;
    min-width: 0;
    height: max-content;
  }

  .login-footer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.625rem;
    padding: 1rem 2rem 1.25rem;
    text-align: center;
    font-size: 0.8125rem;
  }

  @media (max-width: 480px) {
    .login {
      padding: 1rem 0.75rem;
    }
  }
</style>
