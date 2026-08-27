import { RankData } from '../types'
import { PluginState, HTTP_TIMEOUT } from '../state'
import { profileUrl, fetchHtml, looksLikeLoginPage } from '../services/http'
import { acceptCookiesIfPresent, diagnoseScreenshotFailure, waitForImages } from '../services/puppeteer'
import { parseRankData, formatRankData } from '../parsers/rank'

// 重新导出格式化函数方便外部使用
export { formatRankData }

/**
 * 获取排位数据
 */
export async function getRankDataById(state: PluginState, id: string): Promise<RankData> {
    const cacheKey = `rank:${id}`
    const cached = state.rankCache.get(cacheKey)
    if (cached) {
        state.debugLog(`从缓存获取排位数据: ${id}`)
        return cached
    }

    state.debugLog(`开始获取排位数据: ${id}`)
    const url = profileUrl(state, id)
    const html = await fetchHtml(state, url)

    state.debugLog(`页面内容长度: ${html.length}`)
    state.debugLog(`页面前200字符: ${html.substring(0, 200)}`)

    if (looksLikeLoginPage(html)) {
        state.warnLog('检测到登录页面，Cookie可能无效')
        throw new Error('需要有效登录 Cookie 才能访问排位信息。')
    }

    const rankData = parseRankData(state, html, id)
    state.debugLog(`解析结果:`, rankData)

    // 如果解析出的数据都是默认值，可能是页面结构问题
    if (rankData.character === '未知' && rankData.rankPoints === 0) {
        state.warnLog('解析结果异常，页面可能需要登录或结构已变更')
        throw new Error('无法解析排位信息，可能需要重新设置Cookie或页面结构已变更。')
    }

    state.rankCache.set(cacheKey, rankData)
    state.infoLog(`成功获取并缓存排位数据: ${id}`)
    return rankData
}

/**
 * 截取排位页面截图
 */
/**
 * 截取排位页面截图
 */
export async function takeScreenshot(state: PluginState, id: string): Promise<Buffer> {
    const cacheKey = `screenshot:${id}`
    const cached = state.screenshotCache.get(cacheKey)
    if (cached) {
        state.debugLog(`从缓存获取截图: ${id}`)
        return cached
    }

    // 检查是否有 puppeteer 服务
    if (!state.ctx.puppeteer) {
        throw new Error('需要安装 puppeteer 服务才能使用截图功能。请安装 koishi-plugin-puppeteer。')
    }

    state.debugLog(`开始截图流程: ${id}`)
    const url = profileUrl(state, id)
    const page = await state.ctx.puppeteer.page()

    try {
        // 设置更真实的浏览器环境
        state.debugLog('设置浏览器环境')
        await page.setUserAgent(state.config.userAgent)
        await page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        })

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

        await page.setViewport({
            width: 1920,
            height: 1080
        })

        state.debugLog('开始导航到页面:', url)

        // 导航到页面并等待加载
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: HTTP_TIMEOUT
        })
        await acceptCookiesIfPresent(state, page)

        state.debugLog('页面导航完成，等待内容加载')
        // 等待图片加载（替代原有的固定等待）
        await waitForImages(state, page)

        // 检查是否是错误页面
        const pageTitle = await page.evaluate(() => document.title)
        const pageText = await page.evaluate(() => document.body.innerText)

        state.debugLog(`页面标题: ${pageTitle}`)
        state.debugLog(`页面文本前200字符: ${pageText.substring(0, 200)}`)

        if (pageText.includes('403') || pageText.includes('ERROR') || pageText.includes('blocked')) {
            state.warnLog('检测到访问被拒绝页面')
            throw new Error('访问被拒绝：可能是Cookie无效或网站检测到自动化访问。请重新获取Cookie。')
        }

        // 尝试找到overview区域（包含角色信息和数据）
        const selectors = [
            '.overview_inner__cN9HT',              // 完整的overview区域
            '.overview_bg__13XYX',                 // overview背景区域  
            '.character_character_status__5EtcB',  // 只是角色状态
            'article[class*="character_status"]',   // 模糊匹配
            'article[class*="character"]',          // 更宽泛的匹配
            'main'                                  // 兜底选择器
        ]

        let element = null
        let usedSelector = ''

        for (const selector of selectors) {
            try {
                state.debugLog(`尝试选择器: ${selector}`)
                await page.waitForSelector(selector, { timeout: 3000 })
                element = await page.$(selector)
                if (element) {
                    usedSelector = selector
                    state.debugLog(`成功找到元素，使用选择器: ${selector}`)
                    break
                }
            } catch (e) {
                state.debugLog(`选择器 ${selector} 失败，尝试下一个`)
                continue
            }
        }

        if (element) {
            state.debugLog(`开始截取元素 (${usedSelector})`)
            state.lastCookieValidation = Date.now()
            const screenshot = await element.screenshot({ type: 'png' })
            state.screenshotCache.set(cacheKey, screenshot)
            state.infoLog(`成功完成截图并缓存: ${id}`)
            return screenshot
        }

        // 所有选择器失败，进行诊断
        state.warnLog('所有选择器失败，开始诊断失败原因...')
        throw await diagnoseScreenshotFailure(state, page)

    } finally {
        await page.close()
        state.debugLog('浏览器页面已关闭')
    }
}

/**
 * 截取段位LP区域截图
 */
export async function takeLeaguePointScreenshot(state: PluginState, id: string): Promise<Buffer> {
    const cacheKey = `rank_lp_screenshot:${id}`
    const cached = state.leaguePointScreenshotCache.get(cacheKey)
    if (cached) {
        state.debugLog(`使用缓存LP截图: ${id}`)
        return cached
    }

    if (!state.ctx.puppeteer) {
        throw new Error('需要安装 puppeteer 服务才能使用截图功能。请安装 koishi-plugin-puppeteer。')
    }

    const page = await state.ctx.puppeteer.page()

    // 导航关键字与目标容器选择器
    const NAV_KEYWORDS = [
        '段位积分（各角色）',
        '段位积分',
        '排名赛积分（按角色）',
        '排名赛积分',
        '排名賽積分（按角色）',
        '排名賽積分',
        '排位积分（按角色）',
        '排位积分',
        'League Points',
        'League Point',
        'LP'
    ]
    const PLAY_INNER_SELECTORS = ['[class*="play_inner__"]', '[class*="play_inner"]']
    const NAV_KEY_PATTERNS = NAV_KEYWORDS.map(k => k.replace(/\s+/g, '').toLowerCase())

    try {
        state.debugLog(`开始LP截图流程: ${id}`)

        // 设置浏览器环境
        await page.setUserAgent(state.config.userAgent)
        await page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Referer': profileUrl(state, id),
        })
        await page.setViewport({ width: 1920, height: 1080 })

        // 设置Cookie
        if (state.runtimeCookie) {
            state.debugLog('开始设置Cookie')
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

        // 1) 进入 profile 页面
        const profile = profileUrl(state, id)
        state.debugLog(`导航到个人资料页: ${profile}`)
        await page.goto(profile, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await acceptCookiesIfPresent(state, page)
        await new Promise(r => setTimeout(r, 1000))

        // 2) 精确点击"排名賽積分（按角色）/排位积分（按角色）/League Points"导航 li
        const navLiSelector = await page.evaluate((KEYS: string[]) => {
            // 在潜在的导航容器中查找 li
            const containers = Array.from(document.querySelectorAll('nav, ul, div'))
            const lis = containers.flatMap(c => Array.from(c.querySelectorAll('li')))
            const found = lis.find(li => {
                const text = (li as HTMLElement).innerText?.trim() || ''
                const cls = li.className || ''
                const looksNav = /\bplay_nav\b/i.test(cls) || /\bplay_nav_active\b/i.test(cls)
                const hasKeyword = KEYS.some(k => text.toLowerCase().includes(k.toLowerCase()))
                return looksNav && hasKeyword
            })
            if (found) {
                (found as HTMLElement).setAttribute('data-koishi-nav-lp', '1')
                return '[data-koishi-nav-lp="1"]'
            }
            // 备用：直接选择 active tab
            const active = document.querySelector('li[class*="play_nav_active"]')
            if (active) {
                (active as HTMLElement).setAttribute('data-koishi-nav-lp', '1')
                return '[data-koishi-nav-lp="1"]'
            }
            return null
        }, NAV_KEYWORDS)

        if (navLiSelector) {
            try {
                await page.waitForSelector(navLiSelector, { timeout: 5000 })
                const el = await page.$(navLiSelector)
                if (el) {
                    const liClass = await el.evaluate((n: HTMLElement) => n.className)
                    state.debugLog(`点击LP导航 li（class: ${liClass}）`)
                    await el.click()
                    // 等待导航或内容容器出现
                    try {
                        await Promise.race([
                            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }),
                            (async () => {
                                for (const s of PLAY_INNER_SELECTORS) {
                                    try { await page.waitForSelector(s, { timeout: 2500 }); return } catch { }
                                }
                            })(),
                        ])
                    } catch {
                        state.debugLog('导航点击后等待结束，继续处理')
                    }
                }
            } catch {
                // 忽略，继续后续兜底逻辑
            }
        }

        // 3) 兜底：如果当前不在 /play 则直接跳转
        try {
            const currentUrl = page.url()
            if (!/\/play(?:[\/\?#]|$)/.test(currentUrl)) {
                const play = `${state.config.baseUrl}/${state.config.locale}/profile/${id}/play`
                state.debugLog(`跳转到play页: ${play}`)
                await page.goto(play, { waitUntil: 'domcontentloaded', timeout: 30000 })
                await acceptCookiesIfPresent(state, page)
            }
        } catch (e) {
            state.debugLog('跳转到play页失败（忽略并继续）', e)
        }

        // 3b) 在 /play 页面点击 LP 导航 li
        try {
            const playNavLiSelector = await page.evaluate((PATTERNS: string[]) => {
                var lis = Array.from(document.querySelectorAll('li'));
                var found = null;
                for (var i = 0; i < lis.length; i++) {
                    var li = lis[i];
                    var text = ((li as HTMLElement).innerText || '').replace(/\s+/g, '').toLowerCase();
                    var matched = false;
                    for (var k = 0; k < PATTERNS.length; k++) {
                        if (text.indexOf(PATTERNS[k]) !== -1) { matched = true; break; }
                    }
                    if (matched) { found = li; break; }
                }
                if (found) {
                    (found as HTMLElement).setAttribute('data-koishi-nav-lp-play', '1');
                    return '[data-koishi-nav-lp-play="1"]';
                }
                return null;
            }, NAV_KEY_PATTERNS)

            if (playNavLiSelector) {
                await page.waitForSelector(playNavLiSelector, { timeout: 5000 })
                const playNavLi = await page.$(playNavLiSelector)
                if (playNavLi) {
                    const clickedText = await playNavLi.evaluate((el: HTMLElement) => el.innerText?.trim() || '')
                    state.debugLog(`在 /play 页面点击 LP 导航 li（text: ${clickedText}）`)
                    await playNavLi.click()
                    try {
                        await Promise.race([
                            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 6000 }),
                            (async () => {
                                for (const s of PLAY_INNER_SELECTORS) {
                                    try { await page.waitForSelector(s, { timeout: 2000 }); return } catch { }
                                }
                            })(),
                        ])
                    } catch { }
                }
            } else {
                state.debugLog('在 /play 页面未找到 LP 导航 li，继续定位 play_inner 容器')
            }
        } catch (e) {
            state.debugLog('在 /play 页面点击 LP 导航 li 失败（忽略并继续）', e)
        }

        // 4) 寻找并截图 play_inner 容器
        let targetEl: any = null
        let usedSelector = ''
        for (const sel of PLAY_INNER_SELECTORS) {
            try {
                await page.waitForSelector(sel, { timeout: 5000 })
                targetEl = await page.$(sel)
                if (targetEl) {
                    usedSelector = sel
                    state.debugLog(`找到 play_inner 容器: ${sel}`)
                    break
                }
            } catch { }
        }

        // 如果仍未找到，使用智能定位
        if (!targetEl) {
            state.debugLog('未命中 play_inner 选择器，尝试智能定位 play 区域...')
            const marker = await page.evaluate(() => {
                const nodes = Array.from(document.querySelectorAll('div,section,article'))
                const likely = nodes.find(el => {
                    const cls = (el.className || '').toString()
                    const isPlay = /\bplay_/i.test(cls)
                    const text = (el as HTMLElement).innerText || ''
                    const hasNumber = /(?:\d{1,3}(?:,\d{3})+|\d{3,})/.test(text)
                    const hasLPKeyword = /LP|League\s*Point|段位积分|排名賽積分/i.test(text)
                    return isPlay && (hasNumber || hasLPKeyword)
                })
                if (likely) {
                    (likely as HTMLElement).setAttribute('data-koishi-play-inner', '1')
                    return '[data-koishi-play-inner="1"]'
                }
                return null
            })
            if (marker) {
                try {
                    await page.waitForSelector(marker, { timeout: 4000 })
                    targetEl = await page.$(marker)
                    usedSelector = marker
                    if (targetEl) {
                        state.debugLog(`智能定位 play 区域成功，使用标记选择器: ${marker}`)
                    }
                } catch { }
            }
        }

        if (!targetEl) {
            state.debugLog('play_inner 容器仍未找到，开始诊断失败原因...')
            throw await diagnoseScreenshotFailure(state, page)
        }

        // 等待图片加载（新增）
        await waitForImages(state, page)

        state.lastCookieValidation = Date.now()
        const screenshot = await targetEl.screenshot({ type: 'png' })
        state.leaguePointScreenshotCache.set(cacheKey, screenshot)
        state.infoLog(`成功完成LP截图并缓存: ${id}${usedSelector ? `（selector: ${usedSelector}）` : ''}`)
        return screenshot
    } finally {
        await page.close()
        state.debugLog('浏览器页面已关闭')
    }
}
