import { PluginState } from '../state'

/**
 * 检查并点击 Cookie 同意按钮
 */
export async function acceptCookiesIfPresent(state: PluginState, page: any): Promise<void> {
    try {
        // Cookiebot 特定的按钮选择器（优先级最高）
        const cookiebotSelectors = [
            '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',  // "Allow all cookies" 按钮
            '#CybotCookiebotDialogBodyButtonAccept',                    // 备用接受按钮
            '[data-cookiebot-accept-all]',                              // 数据属性选择器
        ]

        // 通用 Cookie 同意按钮选择器
        const genericSelectors = [
            'button[id*="cookie"][id*="accept"]',
            'button[id*="cookie"][id*="allow"]',
            'button[class*="cookie"][class*="accept"]',
            '[class*="cookie-banner"] button[class*="accept"]',
            '[class*="consent"] button[class*="accept"]',
        ]

        const allSelectors = [...cookiebotSelectors, ...genericSelectors]

        for (const selector of allSelectors) {
            try {
                // 等待按钮出现（最多2秒）
                await page.waitForSelector(selector, { timeout: 2000 })
                const button = await page.$(selector)
                if (button) {
                    // 检查按钮是否可见
                    const isVisible = await button.evaluate((el: HTMLElement) => {
                        const rect = el.getBoundingClientRect()
                        return rect.width > 0 && rect.height > 0 &&
                            window.getComputedStyle(el).display !== 'none' &&
                            window.getComputedStyle(el).visibility !== 'hidden'
                    })

                    if (isVisible) {
                        state.debugLog(`找到Cookie同意按钮: ${selector}，点击中...`)
                        await button.click()
                        // 等待弹窗消失
                        await new Promise(resolve => setTimeout(resolve, 1000))
                        state.debugLog('Cookie同意按钮已点击')
                        return
                    }
                }
            } catch (e) {
                // 这个选择器没找到，继续尝试下一个
            }
        }

        state.debugLog('未检测到Cookie同意弹窗')
    } catch (e) {
        state.debugLog('检查Cookie同意按钮时出错:', e)
    }
}

/**
 * 诊断截图失败原因
 */
export async function diagnoseScreenshotFailure(state: PluginState, page: any): Promise<Error> {
    try {
        const currentUrl = page.url()
        state.debugLog(`当前页面URL: ${currentUrl}`)

        // 检查页面内容
        const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || '')
        const pageHtml = await page.evaluate(() => document.documentElement?.outerHTML?.slice(0, 200000) || '')
        state.debugLog(`页面内容预览: ${bodyText}`)

        // 检查是否是登录页面
        const loginWallPatterns = [
            '要使用本服务，您必须登录或注册',
            '要使用本服務，您必須登入或註冊',
            '本サービスを利用するにはログイン',
            'You must log in or register',
            '로그인 또는 회원가입',
        ]
        const isLoginWall = currentUrl.includes('login') ||
            currentUrl.includes('capcom-id') ||
            currentUrl.includes('/profile/auth') ||
            /"statusCode"\s*:\s*(?:401|403)/.test(pageHtml) ||
            loginWallPatterns.some(pattern => bodyText.includes(pattern))

        if (isLoginWall) {
            state.invalidateRuntimeCookie()
            return new Error('需要有效登录 Cookie：当前 Cookie 无效、已过期或页面停留在登录验证界面。')
        }

        // 检查是否是错误页面
        if (bodyText.includes('404') || bodyText.includes('not found')) {
            return new Error('玩家不存在或页面未找到')
        }

        if (bodyText.includes('error') || bodyText.includes('Error')) {
            return new Error('服务器返回错误，请稍后重试')
        }

        return new Error('未能找到预期的页面元素，可能是页面结构变化或加载超时')
    } catch (e) {
        return new Error(`诊断失败: ${e}`)
    }
}

/**
 * 为页面设置 Cookie
 */
export async function setupPageWithCookies(state: PluginState, page: any): Promise<void> {
    // 设置视口和UA
    await page.setViewport({ width: 1280, height: 800 })
    await page.setUserAgent(state.config.userAgent)

    // 设置 Cookie
    if (state.runtimeCookie) {
        const cookies = state.runtimeCookie.split(';').map(cookie => {
            const [name, ...valueParts] = cookie.trim().split('=')
            const value = valueParts.join('=') // 处理值中包含=的情况
            return {
                name: name.trim(),
                value: value?.trim() || '',
                domain: '.streetfighter.com'
            }
        }).filter(cookie => cookie.name && cookie.value)

        if (cookies.length > 0) {
            await page.setCookie(...cookies)
            state.debugLog(`成功设置 ${cookies.length} 个Cookie`)
        }
    }
}

/**
 * 等待所有图片加载完成，并触发懒加载
 */
export async function waitForImages(state: PluginState, page: any): Promise<void> {
    try {
        state.debugLog('开始等待图片加载...')

        // 1. 模拟滚动到底部触发懒加载
        await page.evaluate(async () => {
            const distance = 100
            const delay = 50
            while (document.scrollingElement!.scrollTop + window.innerHeight < document.scrollingElement!.scrollHeight) {
                document.scrollingElement!.scrollBy(0, distance)
                await new Promise(resolve => setTimeout(resolve, delay))
            }
            // 滚回顶部
            window.scrollTo(0, 0)
        })

        // 2. 额外等待一小段时间，确保动态加载的元素开始请求
        await new Promise(resolve => setTimeout(resolve, 500))

        // 3. 检查所有图片加载状态
        await page.evaluate(async () => {
            const selectors = Array.from(document.querySelectorAll('img'))
            await Promise.all(selectors.map(img => {
                if (img.complete && img.naturalWidth > 0) return Promise.resolve()
                return new Promise((resolve) => {
                    img.onload = resolve
                    img.onerror = resolve
                    // 设置一个短超时，防止卡死
                    setTimeout(resolve, 3000)
                })
            }))
        })

        state.debugLog('图片加载等待完成')
    } catch (e) {
        state.warnLog('等待图片加载时出错:', e)
    }
}
