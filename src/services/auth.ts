import { PluginState, LOGIN_RETRY_INTERVAL } from '../state'
import { hasAuthenticatedProfileLink, looksLikeLoginPage } from './http'
import { acceptCookiesIfPresent } from './puppeteer'

/**
 * 自动登录到 CAPCOM ID 获取 Cookie
 */
export async function performAutoLogin(state: PluginState, force: boolean = false): Promise<string | null> {
    if (!state.config.capcomEmail || !state.config.capcomPassword) {
        state.debugLog('未配置CAPCOM登录信息，跳过自动登录')
        return null
    }

    if (state.loginInProgress) {
        state.debugLog('登录正在进行中，跳过重复登录')
        return null
    }

    const now = Date.now()
    // 仅在非强制模式下检查时间间隔
    if (!force && state.lastLoginAttempt && (now - state.lastLoginAttempt) < LOGIN_RETRY_INTERVAL) {
        state.debugLog(`距离上次登录尝试不足${LOGIN_RETRY_INTERVAL / 60000}分钟，跳过登录`)
        return null
    }

    if (!state.ctx.puppeteer) {
        state.warnLog('自动登录需要 puppeteer 服务，请安装 koishi-plugin-puppeteer')
        return null
    }

    state.loginInProgress = true
    state.lastLoginAttempt = now

    state.infoLog('开始自动登录 CAPCOM ID...')

    const page = await state.ctx.puppeteer.page()

    try {
        // 设置浏览器环境
        await page.setUserAgent(state.config.userAgent)
        await page.setViewport({ width: 1920, height: 1080 })

        // 新增：先访问主页检查登录状态
        state.debugLog('访问Buckler主页检查登录状态...')
        // 使用更宽松的等待条件和更长的超时时间，因为冷启动时可能需要更长时间
        await page.goto(`${state.config.baseUrl}/${state.config.locale}/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await acceptCookiesIfPresent(state, page)
        // 额外等待一小段时间确保页面稳定
        await new Promise(resolve => setTimeout(resolve, 2000))
        const mainPageHtml = await page.evaluate(() => document.documentElement.outerHTML)

        // 匿名首页同样包含 profile/0，必须找到非零资料 ID 才能判定为已登录。
        const isLoggedIn = !looksLikeLoginPage(mainPageHtml) && hasAuthenticatedProfileLink(mainPageHtml)

        if (isLoggedIn) {
            state.debugLog('检测到已登录状态，直接获取Cookie')
            const cookies = await page.cookies()
            const cookieString = cookies
                .map(cookie => `${cookie.name}=${cookie.value}`)
                .join('; ')

            if (cookieString) {
                state.infoLog('已处于登录状态，成功获取Cookie')
                return cookieString
            } else {
                state.debugLog('虽检测到登录状态，但未能获取到有效Cookie，继续执行标准登录流程...')
            }
        } else {
            state.debugLog('未检测到登录状态，执行标准登录流程...')
        }

        // 第一步：直接访问登录页面
        const loginUrl = `${state.config.baseUrl}/${state.config.locale}/auth/loginep?redirect_url=/`
        state.debugLog(`直接访问登录页面: ${loginUrl}`)
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await acceptCookiesIfPresent(state, page)

        // 等待页面加载完成，然后检查当前页面内容
        state.debugLog('分析登录页面结构...')
        const currentUrl = page.url()
        state.debugLog(`当前页面URL: ${currentUrl}`)

        const pageContent = await page.evaluate(() => document.body.innerText.toLowerCase())
        state.debugLog(`页面内容关键词: ${pageContent.substring(0, 200)}`)

        const securityChallengePatterns = [
            '正在进行安全验证',
            'security verification',
            'checking your browser',
            'verify you are human',
            'cloudflare',
        ]
        if (currentUrl.includes('auth.cid.capcom.com') &&
            securityChallengePatterns.some(pattern => pageContent.includes(pattern))) {
            throw new Error('CAPCOM 登录被 Cloudflare 安全验证拦截，请改用手动 Cookie')
        }

        // 第二步：处理Cookie接受界面
        if (pageContent.includes('cookies') || pageContent.includes('cookie')) {
            state.debugLog('检测到Cookie接受界面，尝试点击接受按钮...')
            try {
                await page.waitForSelector('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', { timeout: 5000 })
                const cookieBtn = await page.$('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll')
                if (cookieBtn) {
                    state.debugLog('找到Cookie同意按钮，点击...')
                    await cookieBtn.click()
                    await new Promise(resolve => setTimeout(resolve, 3000)) // 等待Cookie处理完成
                    state.debugLog('Cookie同意完成')
                }
            } catch (e) {
                state.debugLog('Cookie按钮处理失败，尝试继续:', e)
            }
        }

        // 第三步：等待并填写登录表单
        state.debugLog('等待登录表单加载...')

        let emailInput = null
        try {
            state.debugLog('寻找邮箱输入框: input[type="email"]')
            await page.waitForSelector('input[type="email"]', { timeout: 10000 })
            emailInput = await page.$('input[type="email"]')
            if (emailInput) {
                state.debugLog('成功找到邮箱输入框')
            }
        } catch (e) {
            state.debugLog(`邮箱输入框加载失败: ${e}`)
            throw new Error('无法找到邮箱输入框，登录页面可能未正确加载')
        }

        // 寻找密码输入框
        let passwordInput = null
        try {
            state.debugLog('寻找密码输入框: .auth0-lock-input-block.auth0-lock-input-password input')
            passwordInput = await page.$('.auth0-lock-input-block.auth0-lock-input-password input')
            if (!passwordInput) {
                state.debugLog('尝试其他密码输入框选择器...')
                passwordInput = await page.$('input[type="password"]')
            }
            if (passwordInput) {
                state.debugLog('成功找到密码输入框')
            }
        } catch (e) {
            state.debugLog(`密码输入框查找失败: ${e}`)
        }

        if (!passwordInput) {
            throw new Error('无法找到密码输入框')
        }

        // 填写登录信息
        state.debugLog('填写登录信息...')

        // 填写邮箱，增加等待时间和验证
        state.debugLog('开始填写邮箱...')
        await emailInput.click()
        await new Promise(resolve => setTimeout(resolve, 500)) // 点击后等待
        await emailInput.evaluate((el: any) => el.value = '') // 清空邮箱输入框
        await new Promise(resolve => setTimeout(resolve, 300)) // 清空后等待

        // 慢速输入邮箱
        await emailInput.type(state.config.capcomEmail, { delay: 200 })
        await new Promise(resolve => setTimeout(resolve, 500)) // 输入后等待

        // 验证邮箱输入是否正确
        const emailValue = await emailInput.evaluate((el: any) => el.value)
        state.debugLog(`邮箱输入验证: ${emailValue === state.config.capcomEmail ? '成功' : '失败'}`)
        if (emailValue !== state.config.capcomEmail) {
            state.debugLog('邮箱输入不完整，重新输入...')
            await emailInput.evaluate((el: any) => el.value = '')
            await new Promise(resolve => setTimeout(resolve, 300))
            await emailInput.type(state.config.capcomEmail, { delay: 300 })
            await new Promise(resolve => setTimeout(resolve, 500))

            // 再次验证
            const emailValue2 = await emailInput.evaluate((el: any) => el.value)
            state.debugLog(`邮箱二次输入验证: ${emailValue2 === state.config.capcomEmail ? '成功' : '失败'}`)
        }

        // 填写密码，同样增加等待时间
        state.debugLog('开始填写密码...')
        await passwordInput.click()
        await new Promise(resolve => setTimeout(resolve, 500)) // 点击后等待
        await passwordInput.evaluate((el: any) => el.value = '') // 清空密码输入框
        await new Promise(resolve => setTimeout(resolve, 300)) // 清空后等待

        // 慢速输入密码
        await passwordInput.type(state.config.capcomPassword, { delay: 200 })
        await new Promise(resolve => setTimeout(resolve, 500)) // 输入后等待

        // 验证密码输入长度（不打印密码内容）
        const passwordValue = await passwordInput.evaluate((el: any) => el.value)
        state.debugLog(`密码输入验证: 期望长度=${state.config.capcomPassword.length}, 实际长度=${passwordValue.length}`)
        if (passwordValue.length !== state.config.capcomPassword.length) {
            state.debugLog('密码输入不完整，重新输入...')
            await passwordInput.evaluate((el: any) => el.value = '')
            await new Promise(resolve => setTimeout(resolve, 300))
            await passwordInput.type(state.config.capcomPassword, { delay: 300 })
            await new Promise(resolve => setTimeout(resolve, 500))

            // 再次验证
            const passwordValue2 = await passwordInput.evaluate((el: any) => el.value)
            state.debugLog(`密码二次输入验证: 期望长度=${state.config.capcomPassword.length}, 实际长度=${passwordValue2.length}`)
        }

        state.debugLog('登录信息填写完成，准备提交表单')
        // 额外等待确保所有输入都已完成
        await new Promise(resolve => setTimeout(resolve, 1000))

        // 提交表单
        state.debugLog('提交登录表单...')
        const submitSelectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            'button[class*="submit"]',
            'button[class*="login"]',
            'button[data-testid*="submit"]',
            'button[data-testid*="login"]',
            '.submit-btn',
            '[role="button"][class*="submit"]'
        ]

        let formSubmitted = false
        for (const selector of submitSelectors) {
            try {
                const submitBtn = await page.$(selector)
                if (submitBtn) {
                    state.debugLog(`找到提交按钮: ${selector}`)
                    await submitBtn.click()
                    formSubmitted = true
                    break
                }
            } catch (e) {
                state.debugLog(`提交按钮选择器 ${selector} 失败: ${e}`)
            }
        }

        if (!formSubmitted) {
            // 尝试按回车提交
            state.debugLog('尝试按回车提交表单...')
            await passwordInput.press('Enter')
        }

        // 等待登录完成并跳转
        state.debugLog('等待登录完成...')
        try {
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
        } catch (e) {
            state.debugLog('等待导航超时，检查是否有错误消息...')

            // 检查页面是否有错误信息
            const errorElements = await page.$$('.error, .alert, [class*="error"], [class*="alert"], [data-testid*="error"]')
            if (errorElements.length > 0) {
                const errorText = await page.evaluate(() => {
                    const errors = document.querySelectorAll('.error, .alert, [class*="error"], [class*="alert"], [data-testid*="error"]')
                    return Array.from(errors).map(el => el.textContent).join('; ')
                })
                throw new Error(`登录失败: ${errorText}`)
            }
        }

        // 等待额外时间确保所有cookie都已设置
        await new Promise(resolve => setTimeout(resolve, 3000))

        // 访问Buckler页面确保获得完整的Cookie
        state.debugLog('访问Buckler确保获得完整Cookie...')
        try {
            await page.goto(`${state.config.baseUrl}/${state.config.locale}/`, { waitUntil: 'networkidle2', timeout: 30000 })
            await acceptCookiesIfPresent(state, page)
        } catch (e) {
            state.debugLog('访问Buckler页面失败，但继续尝试获取Cookie...')
        }

        // 只有确认受保护资料链接已经可用，才接受本次登录产生的 Cookie。
        const verifiedHtml = await page.evaluate(() => document.documentElement.outerHTML)
        if (looksLikeLoginPage(verifiedHtml) || !hasAuthenticatedProfileLink(verifiedHtml)) {
            throw new Error('CAPCOM 登录未建立有效 Buckler 会话，可能被 Cloudflare 安全验证拦截')
        }

        // 获取所有Cookie
        const cookies = await page.cookies()
        const cookieString = cookies
            .map(cookie => `${cookie.name}=${cookie.value}`)
            .join('; ')

        if (cookieString) {
            state.infoLog('自动登录成功，已获取Cookie')
            state.debugLog(`获得Cookie长度: ${cookieString.length}`)
            return cookieString
        } else {
            throw new Error('登录完成但未获取到有效Cookie')
        }

    } catch (e: any) {
        state.warnLog('自动登录失败:', e?.message)
        return null
    } finally {
        state.loginInProgress = false
        await page.close()
    }
}

/**
 * 检查并更新 Cookie
 */
export async function ensureValidCookie(state: PluginState): Promise<boolean> {
    const now = Date.now()

    // 自动登录取得的 Cookie 到达刷新间隔后尝试刷新。刷新失败时保留仍有效的旧 Cookie。
    if (state.runtimeCookie &&
        state.runtimeCookieSource === 'auto' &&
        state.config.capcomEmail &&
        state.config.capcomPassword &&
        state.config.cookieRefreshInterval > 0) {
        const refreshIntervalMs = state.config.cookieRefreshInterval * 3600000
        if (state.lastLoginSuccess && (now - state.lastLoginSuccess) > refreshIntervalMs) {
            state.debugLog(`Cookie刷新间隔已到（${state.config.cookieRefreshInterval}小时），尝试重新登录刷新`)
            const newCookie = await performAutoLogin(state)
            if (newCookie) {
                state.setRuntimeCookie(newCookie, 'auto')
                state.lastLoginSuccess = Date.now()
                state.lastCookieValidation = Date.now()
                state.infoLog('已刷新并验证 Cookie')
            }
        }
    }

    if (state.runtimeCookie) return true

    // 配置了最高优先级的手动 Cookie 时，不自动降级到账号密码登录。
    // 无效 Cookie 会由实际查询返回的 403 或登录墙负责清除和提示。
    if (state.config.cookie?.trim()) return false

    // 没有可用 Cookie 时才尝试实验性的账号密码自动登录。
    if (state.config.capcomEmail && state.config.capcomPassword) {
        state.debugLog('当前没有有效 Cookie，尝试账号密码自动登录')
        const newCookie = await performAutoLogin(state)
        if (newCookie) {
            state.setRuntimeCookie(newCookie, 'auto')
            state.lastLoginSuccess = Date.now()
            state.lastCookieValidation = Date.now()
            state.infoLog('已通过自动登录获取并验证 Cookie')
            return true
        }
    }

    return false
}
