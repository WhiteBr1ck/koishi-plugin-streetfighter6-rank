import { PlayerSearchResult } from '../types'
import { PluginState, HTTP_TIMEOUT } from '../state'
import { buildHeaders, looksLikeLoginPage } from '../services/http'
import { acceptCookiesIfPresent, diagnoseScreenshotFailure, waitForImages } from '../services/puppeteer'
import { parsePlayerSearchResults } from '../parsers/search'

/**
 * 获取玩家搜索数据
 */
export async function getPlayerSearchData(state: PluginState, playerName: string): Promise<PlayerSearchResult[]> {
    const cacheKey = `search:${playerName}`
    const cached = state.playerSearchCache.get(cacheKey)
    if (cached) {
        state.debugLog(`使用缓存的搜索结果: ${playerName}，缓存结果数量: ${cached.length}`)
        // 如果缓存的结果只有1个且实际应该有更多，清理缓存重新获取
        if (cached.length === 1) {
            state.debugLog('缓存结果可能不完整，清理缓存重新获取')
            state.playerSearchCache.clear()
        } else {
            return cached
        }
    }

    state.debugLog(`开始搜索玩家: ${playerName}`)

    // URL编码玩家名称
    const encodedName = encodeURIComponent(playerName)
    const searchUrl = `${state.config.baseUrl}/${state.config.locale}/fighterslist/search/result?fighter_id=${encodedName}&page=1`

    try {
        const headers = buildHeaders(state)
        const res = await fetch(searchUrl, {
            headers,
            signal: AbortSignal.timeout(HTTP_TIMEOUT),
        })

        if (!res.ok) {
            throw new Error(`请求失败: ${res.status}`)
        }

        const html = await res.text()
        state.debugLog(`获取到HTML，长度: ${html.length}`)

        if (looksLikeLoginPage(html)) {
            state.invalidateRuntimeCookie()
            throw new Error('需要登录 Cookie 才能搜索玩家')
        }

        state.lastCookieValidation = Date.now()
        const results = parsePlayerSearchResults(state, html)
        state.playerSearchCache.set(cacheKey, results)
        state.debugLog(`搜索完成，找到 ${results.length} 个结果，已缓存`)

        return results
    } catch (e: any) {
        state.warnLog('搜索请求失败:', e)
        throw new Error(`搜索失败: ${e?.message || '未知错误'}`)
    }
}

/**
 * 截取玩家搜索结果页面
 */
/**
 * 截取玩家搜索结果页面
 */
export async function takePlayerSearchScreenshot(state: PluginState, playerName: string): Promise<Buffer> {
    const cacheKey = `search_screenshot:${playerName}`
    const cached = state.playerSearchScreenshotCache.get(cacheKey)
    if (cached) {
        state.debugLog(`使用缓存的搜索截图: ${playerName}`)
        return cached
    }

    if (!state.ctx.puppeteer) {
        throw new Error('需要安装 puppeteer 服务才能使用截图功能。请安装 koishi-plugin-puppeteer。')
    }

    state.debugLog(`开始截取搜索结果截图: ${playerName}`)

    const encodedName = encodeURIComponent(playerName)
    const searchUrl = `${state.config.baseUrl}/${state.config.locale}/fighterslist/search/result?fighter_id=${encodedName}&page=1`

    const page = await state.ctx.puppeteer.page()

    try {
        await page.setUserAgent(state.config.userAgent)

        if (state.runtimeCookie) {
            // 解析Cookie字符串
            const cookies = state.runtimeCookie.split(';').map(cookie => {
                const [name, ...valueParts] = cookie.trim().split('=')
                const value = valueParts.join('=')
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

        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 })
        await acceptCookiesIfPresent(state, page)

        state.debugLog('页面加载完成，等待搜索结果元素...')

        // 尝试多种选择器等待搜索结果加载
        let element = null

        // 等待图片加载（新增）
        await waitForImages(state, page)

        const selectors = [
            '.list_inner__hpkhV',
            '[class*="list_inner"]',
            '.fighterslist',
            'main'
        ]

        for (const selector of selectors) {
            try {
                await page.waitForSelector(selector, { timeout: 5000 })
                element = await page.$(selector)
                if (element) {
                    state.debugLog(`找到元素使用选择器: ${selector}`)
                    break
                }
            } catch (e) {
                state.debugLog(`选择器 ${selector} 未找到元素`)
            }
        }

        if (!element) {
            // 如果没有找到特定元素，进行诊断
            state.debugLog('未找到特定元素，开始诊断失败原因...')
            throw await diagnoseScreenshotFailure(state, page)
        }

        // 截取找到的元素
        state.lastCookieValidation = Date.now()
        const screenshot = await element.screenshot({ type: 'png' })
        state.playerSearchScreenshotCache.set(cacheKey, screenshot)
        state.debugLog(`搜索结果截图已缓存: ${playerName}`)

        return screenshot
    } finally {
        await page.close()
    }
}
