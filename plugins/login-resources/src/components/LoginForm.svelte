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
  import { type IntlString, Severity, Status } from '@hcengineering/platform'
  import { signupStore } from '@hcengineering/analytics-providers'
  import { Label } from '@hcengineering/ui'
  import { onMount } from 'svelte'

  import { type BottomAction, doLoginAsGuest, doLoginNavigate, LoginMethods } from '../index'
  import LoginPasswordForm from './LoginPasswordForm.svelte'
  import LoginOtpForm from './LoginOtpForm.svelte'
  import login from '../plugin'
  import { LoginInfo } from '@hcengineering/account-client'
  import { fetchLoginCapabilities } from '../utils'

  export let navigateUrl: string | undefined = undefined
  export let signUpDisabled = false
  export let useOTP = true
  export let email: string | undefined = undefined
  export let caption: IntlString | undefined = undefined
  export let subtitle: string | undefined = undefined
  export let onLogin: ((loginInfo: LoginInfo | null, status: Status) => void | Promise<void>) | undefined = undefined

  let method: LoginMethods = useOTP ? LoginMethods.Otp : LoginMethods.Password
  let guestLoginAvailable = false
  let capabilitiesLoaded = false
  let signUpEnabled = true
  $: effectiveSignUpDisabled = signUpDisabled || (capabilitiesLoaded && !signUpEnabled)

  onMount(() => {
    signupStore.setSignUpFlow(false)
    void fetchLoginCapabilities().then((capabilities) => {
      signUpEnabled = capabilities.signUpEnabled
      guestLoginAvailable = capabilities.guestLoginAvailable
      capabilitiesLoaded = true
    })
  })

  function changeMethod(event: CustomEvent<LoginMethods>): void {
    method = event.detail
  }

  const loginWithPasswordAction: BottomAction = {
    i18n: login.string.LoginWithPassword,
    func: () => {
      method = LoginMethods.Password
    }
  }

  const loginWithCodeAction: BottomAction = {
    i18n: login.string.LoginWithCode,
    func: () => {
      method = LoginMethods.Otp
    }
  }

  async function guestLogin(): Promise<void> {
    let status = new Status(Severity.INFO, login.status.ConnectingToServer, {})
    const [loginStatus, result] = await doLoginAsGuest()
    status = loginStatus

    if (onLogin !== undefined) {
      void onLogin(result, status)
    } else {
      await doLoginNavigate(
        result,
        (st) => {
          status = st
        },
        navigateUrl
      )
    }
  }

  const loginAsGuest: BottomAction = {
    i18n: login.string.LoginAsGuest,
    func: () => {
      void guestLogin()
    }
  }

  $: methodToggleAction = method === LoginMethods.Otp ? loginWithPasswordAction : loginWithCodeAction
</script>

{#if method === LoginMethods.Otp}
  <LoginOtpForm
    {navigateUrl}
    signUpDisabled={effectiveSignUpDisabled}
    {email}
    {caption}
    {subtitle}
    {onLogin}
    on:change={changeMethod}
  />
{:else}
  <LoginPasswordForm
    {navigateUrl}
    signUpDisabled={effectiveSignUpDisabled}
    {email}
    {caption}
    {subtitle}
    {onLogin}
    on:change={changeMethod}
  />
{/if}
<div class="login-extra-actions">
  <a class="method-toggle" href="." on:click|preventDefault={methodToggleAction.func}>
    <Label label={methodToggleAction.i18n} />
  </a>
  {#if guestLoginAvailable}
    <span class="divider-dot">•</span>
    <a class="guest-link" href="." on:click|preventDefault={loginAsGuest.func}>
      <Label label={loginAsGuest.i18n} />
    </a>
  {/if}
</div>

<style lang="scss">
  .login-extra-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin-top: 1rem;
    font-size: 0.8125rem;
  }

  .divider-dot {
    color: var(--theme-dark-color);
  }

  .method-toggle,
  .guest-link {
    font-weight: 500;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  .method-toggle {
    color: var(--theme-link-color);
  }

  .guest-link {
    color: var(--theme-content-color);
  }
</style>
