import { WinRateData } from '../types'
import { PluginState } from '../state'
import { playUrl, profileUrl, fetchHtml, looksLikeLoginPage } from '../services/http'
import { acceptCookiesIfPresent, diagnoseScreenshotFailure, waitForImages } from '../services/puppeteer'
import { parseWinRateData, formatWinRateData } from '../parsers/winrate'

// 重新导出格式化函数方便外部使用
export { formatWinRateData }

/**
 * 获取胜率数据
 */
export async function getWinRateDataById(state: PluginState, id: string): Promise<WinRateData> {
    const cacheKey = `winrate:${id}`
    const cached = state.winRateCache.get(cacheKey)
    if (cached) {
        state.debugLog(`从缓存获取胜率数据: ${id}`)
        return cached
    }

    state.debugLog(`开始获取胜率数据: ${id}`)
    const url = playUrl(state, id)
    const html = await fetchHtml(state, url)

    if (looksLikeLoginPage(html)) {
        throw new Error('需要登录才能查看此页面，请检查Cookie设置')
    }

    const winRateData = parseWinRateData(state, html, id)
    state.debugLog(`胜率解析结果:`, winRateData)

    // 如果解析出的数据都是默认值，可能是页面结构问题
    if (winRateData.totalBattles === 0 && winRateData.winRate === 0) {
        state.warnLog('胜率解析结果异常，页面可能需要登录或结构已变更')
        throw new Error('无法解析胜率信息，可能需要重新设置Cookie或页面结构已变更。')
    }

    state.winRateCache.set(cacheKey, winRateData)
    state.infoLog(`成功获取并缓存胜率数据: ${id}`)
    return winRateData
}

/**
 * 截取胜率页面截图
 */
/**
 * 截取胜率页面截图
 */
export async function takeWinRateScreenshot(state: PluginState, id: string): Promise<Buffer> {
    const cacheKey = `winrate_screenshot:${id}`
    const cached = state.winRateScreenshotCache.get(cacheKey)
    if (cached) {
        state.debugLog(`从缓存获取胜率截图: ${id}`)
        return cached
    }

    if (!state.ctx.puppeteer) {
        throw new Error('需要安装 puppeteer 服务才能使用截图功能。请安装 koishi-plugin-puppeteer。')
    }

    state.debugLog(`开始胜率截图流程: ${id}`)
    const url = playUrl(state, id)
    const page = await state.ctx.puppeteer.page()

    try {
        // 设置浏览器环境
        state.debugLog('设置浏览器环境')
        await page.setUserAgent(state.config.userAgent)
        await page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Referer': profileUrl(state, id)
        })

        // 设置视窗尺寸
        await page.setViewport({ width: 1280, height: 800 })

        // 设置Cookie
        if (state.runtimeCookie) {
            state.debugLog('开始设置Cookie')
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

        // 导航到胜率页面
        state.debugLog(`开始导航到页面: ${url}`)
        await page.goto(url, {
            waitUntil: 'domcontentloaded', // 改为更快的等待条件
            timeout: 30000  // 增加超时时间到30秒
        })
        await acceptCookiesIfPresent(state, page)
        state.debugLog('页面导航完成，等待内容加载')

        // 等待胜率内容加载 - 使用新的winning_rate_winning_rate类
        try {
            await page.waitForSelector('[class*="winning_rate_winning_rate"]', { timeout: 15000 })
            state.debugLog('胜率内容加载完成')
        } catch (e) {
            state.debugLog('等待胜率内容超时，尝试直接截图')
            // 如果等待超时，仍然尝试截图，可能内容已经加载但选择器不匹配
        }

        // 等待图片加载（新增）
        await waitForImages(state, page)

        // 截图指定区域或整个页面
        // 尝试截取指定的winning_rate_winning_rate区域
        const element = await page.$('[class*="winning_rate_winning_rate"]')
        if (element) {
            state.debugLog('找到winning_rate_winning_rate元素，截取指定区域')
            const screenshot = await element.screenshot({ type: 'png' })
            state.winRateScreenshotCache.set(cacheKey, screenshot)
            state.infoLog(`成功完成胜率截图并缓存: ${id}`)
            return screenshot
        } else {
            state.debugLog('未找到winning_rate_winning_rate元素，开始诊断失败原因...')
            throw await diagnoseScreenshotFailure(state, page)
        }

    } finally {
        await page.close()
        state.debugLog('浏览器页面已关闭')
    }
}
