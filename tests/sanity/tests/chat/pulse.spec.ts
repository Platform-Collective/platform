import { expect, test } from '@playwright/test'
import { ApiEndpoint } from '../API/Api'
import { ChannelPage } from '../model/channel-page'
import { LeftSideMenuPage } from '../model/left-side-menu-page'
import { LoginPage } from '../model/login-page'
import { SelectWorkspacePage } from '../model/select-workspace-page'
import { SignUpData } from '../model/common-types'
import {
  PlatformURI,
  createAccount,
  generateTestData,
  generateUser,
  getInviteLink,
  getSecondPageByInvite
} from '../utils'

test.describe('Pulse — typing indicator and document presence', () => {
  let leftSideMenuPage: LeftSideMenuPage
  let channelPage: ChannelPage
  let loginPage: LoginPage
  let api: ApiEndpoint
  let newUser2: SignUpData
  let data: { workspaceName: string, userName: string, firstName: string, lastName: string, channelName: string }

  test.beforeEach(async ({ page, request }) => {
    data = generateTestData()
    newUser2 = generateUser()

    leftSideMenuPage = new LeftSideMenuPage(page)
    channelPage = new ChannelPage(page)
    loginPage = new LoginPage(page)
    api = new ApiEndpoint(request)
    await api.createAccount(data.userName, '1234', data.firstName, data.lastName)
    await api.createWorkspaceWithLogin(data.workspaceName, data.userName, '1234')
    await (await page.goto(`${PlatformURI}`))?.finished()
    await loginPage.login(data.userName, '1234')
    const swp = new SelectWorkspacePage(page)
    await swp.selectWorkspace(data.workspaceName)
  })

  test('Second user sees typing indicator while first user types in general channel', async ({
    browser,
    page,
    request
  }) => {
    const linkText = await getInviteLink(page)
    await createAccount(request, newUser2)
    using _page2 = await getSecondPageByInvite(browser, linkText, newUser2)
    const page2 = _page2.page

    const channelPageSecond = new ChannelPage(page2)
    const leftSideMenuPageSecond = new LeftSideMenuPage(page2)

    await leftSideMenuPage.clickChunter()
    await channelPage.clickChooseChannel('general')

    await leftSideMenuPageSecond.clickChunter()
    await channelPageSecond.clickChooseChannel('general')

    await channelPage.inputMessage().click()
    await channelPage.inputMessage().pressSequentially('hello there', { delay: 80 })

    const typingInfo = page2.locator('span[data-id="channel-typing-info"]')
    await expect(typingInfo).toContainText(data.firstName, { timeout: 8000 })

    await channelPage.buttonSendMessage().click()
    await expect(typingInfo).not.toContainText(data.firstName, { timeout: 10000 })
  })

  test('First user sees second user as document presence viewer in general channel', async ({
    browser,
    page,
    request
  }) => {
    const linkText = await getInviteLink(page)
    await createAccount(request, newUser2)

    await leftSideMenuPage.clickChunter()
    await channelPage.clickChooseChannel('general')

    // Presence avatars on page1 should be empty (only self — filtered out)
    const presenceFirst = page.locator('[data-id="document-presence"]')
    await expect(presenceFirst).toHaveCount(1)
    await expect(presenceFirst.locator('.hulyCombineAvatar, .avatar-button')).toHaveCount(0)

    // Second user joins and opens the same channel
    using _page2 = await getSecondPageByInvite(browser, linkText, newUser2)
    const page2 = _page2.page
    const channelPageSecond = new ChannelPage(page2)
    const leftSideMenuPageSecond = new LeftSideMenuPage(page2)
    await leftSideMenuPageSecond.clickChunter()
    await channelPageSecond.clickChooseChannel('general')

    // First user should now see second user avatar via DocumentPresence
    await expect(presenceFirst.locator('.hulyCombineAvatar, .avatar-button')).toHaveCount(1, { timeout: 10000 })

    // When second user leaves the channel (switches to another), TTL expires and avatar should disappear
    await channelPageSecond.clickChooseChannel('random')
    await expect(presenceFirst.locator('.hulyCombineAvatar, .avatar-button')).toHaveCount(0, { timeout: 20000 })
  })
})
