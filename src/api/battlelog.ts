import { PluginState } from '../state'
import { battlelogUrl } from '../services/http'
import { acceptCookiesIfPresent, diagnoseScreenshotFailure, waitForImages } from '../services/puppeteer'

/**
 * 截取战斗记录截图
 */
export async function takeBattlelogScreenshot(state: PluginState, id: string): Promise<Buffer> {
    const cacheKey = `battlelog_screenshot:${id}`
    const cached = state.battlelogScreenshotCache.get(cacheKey)
    if (cached) {
        state.debugLog(`从缓存获取战斗记录截图: ${id}`)
        return cached
    }

    if (!state.ctx.puppeteer) {
        throw new Error('需要安装 puppeteer 服务才能使用截图功能。请安装 koishi-plugin-puppeteer。')
    }

    state.debugLog(`开始战斗记录截图流程: ${id}`)
    const url = battlelogUrl(state, id)
    const page = await state.ctx.puppeteer.page()

    try {
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

        // 导航到战斗记录页面
        state.debugLog(`开始导航到页面: ${url}`)
        await page.goto(url, {
            waitUntil: 'domcontentloaded', // 更快的等待条件
            timeout: 30000  // 30秒超时
        })
        await acceptCookiesIfPresent(state, page)
        state.debugLog('页面导航完成，等待内容加载')

        // 等待战斗记录内容加载
        try {
            await page.waitForSelector('[class*="battlelog_inner"]', { timeout: 15000 })
            state.debugLog('战斗记录内容加载完成')
        } catch (e) {
            state.debugLog('等待战斗记录内容超时，尝试直接截图')
            // 如果等待超时，仍然尝试截图，可能内容已经加载但选择器不匹配
        }

        // 等待图片加载（新增）
        await waitForImages(state, page)

        // 截图指定区域或整个页面
        // 尝试截取指定的battlelog_inner区域
        const element = await page.$('[class*="battlelog_inner"]')
        if (element) {
            state.debugLog('找到battlelog_inner元素，截取指定区域')
            state.lastCookieValidation = Date.now()
            const screenshot = await element.screenshot({ type: 'png' })
            state.battlelogScreenshotCache.set(cacheKey, screenshot)
            state.infoLog(`成功完成战斗记录截图并缓存: ${id}`)
            return screenshot
        } else {
            state.debugLog('未找到battlelog_inner元素，开始诊断失败原因...')
            throw await diagnoseScreenshotFailure(state, page)
        }

    } finally {
        await page.close()
        state.debugLog('浏览器页面已关闭')
    }
}
