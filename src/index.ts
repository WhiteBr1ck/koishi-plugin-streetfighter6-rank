import { Context, Schema, Logger, h } from 'koishi'


export const name = 'streetfighter6-rank'
export const inject = ['puppeteer', 'database']

declare module 'koishi' {
  interface Context {
    puppeteer: {
      page(): Promise<{
        setViewport(options: { width: number; height: number }): Promise<void>
        setUserAgent(userAgent: string): Promise<void>
        setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>
        goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<void>
        waitForSelector(selector: string, options?: { timeout?: number }): Promise<void>
        $(selector: string): Promise<{
          screenshot(options: { type: 'png' }): Promise<Buffer>
        } | null>
        setCookie(...cookies: Array<{ name: string; value: string; domain: string }>): Promise<void>
        evaluate<T>(fn: () => T): Promise<T>
        evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T>
        screenshot(options: { type: 'png'; fullPage?: boolean }): Promise<Buffer>
        close(): Promise<void>
      }>
    }
  }
  interface Tables {
    streetfighter6_binding: StreetFighter6Binding
  }
}

export interface StreetFighter6Binding {
  id: number
  userId: string
  playerId: string
}

export interface Config {
  // 网站连接配置
  baseUrl: string
  locale: 'zh-hans' | 'en-us' | 'ja-jp' | 'ko-kr' | 'zh-hant'
  userAgent: string
  cookie?: string
  username?: string
  password?: string
  
  // 功能开关
  enableTextOutput: boolean
  enableScreenshotOutput: boolean
  enableForwardMessage: boolean
  
  // 调试选项
  debug: boolean
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    // 网站连接配置
    baseUrl: Schema.string().default('https://www.streetfighter.com/6/buckler').description('Buckler 网站基础地址'),
    locale: Schema.union([
      Schema.const('zh-hans').description('简体中文'),
      Schema.const('zh-hant').description('繁體中文'),
      Schema.const('en-us').description('English'),
      Schema.const('ja-jp').description('日本語'),
      Schema.const('ko-kr').description('한국어'),
    ]).default('zh-hans').description('页面语言'),
    userAgent: Schema.string().default('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36').description('浏览器标识'),
    cookie: Schema.string().role('secret').description('登录 Cookie'),
    username: Schema.string().default('').description('登录账号（提供则优先使用账号密码登录）'),
    password: Schema.string().role('secret').default('').description('登录密码（提供则优先使用账号密码登录）'),
  }).description('网站连接配置'),
  
  Schema.object({
    // 功能开关
    enableTextOutput: Schema.boolean().default(true).description('启用文本信息输出'),
    enableScreenshotOutput: Schema.boolean().default(true).description('启用截图输出'),
    enableForwardMessage: Schema.boolean().default(false).description('启用合并转发消息（玩家搜索结果）'),
  }).description('功能开关'),
  
  Schema.object({
    // 调试选项
    debug: Schema.boolean().default(false).description('输出详细调试日志'),
  }).description('调试选项'),
]).description('Street Fighter 6 玩家信息查询插件')

  interface RankData {
    playerId: string
    playerName?: string  // 玩家名称
    character: string
    rankName: string
    rankPoints: number
    fightingPoints: number
    title: string
    url: string
  }

  interface PlayerSearchResult {
    playerId: string
    playerName: string
    url: string
  }

  interface WinRateData {
    playerId: string
    playerName?: string
    totalWins: number
    totalBattles: number
    winRate: number
    url: string
  }const logger = new Logger('streetfighter6-rank')

// 简单内存缓存
class SimpleCache<V> {
  private store = new Map<string, { value: V; expires: number }>()
  constructor(private ttlSec: number) {}
  get(key: string): V | undefined {
    const item = this.store.get(key)
    if (!item) return
    if (Date.now() > item.expires) {
      this.store.delete(key)
      return
    }
    return item.value
  }
  set(key: string, value: V) {
    this.store.set(key, { value, expires: Date.now() + this.ttlSec * 1000 })
  }
  clear() {
    this.store.clear()
  }
}

// 在日志中脱敏 Cookie
function redactCookie(c?: string) {
  if (!c) return ''
  const n = Math.min(8, Math.floor(c.length / 4))
  return c.slice(0, n) + '…' + c.slice(-n)
}

export function apply(ctx: Context, config: Config) {
  const log = logger

  // 创建专门的数据表来存储 SF6 玩家ID绑定
  ctx.model.extend('streetfighter6_binding', {
    id: 'unsigned',
    userId: 'string',
    playerId: 'string',
  }, {
    primary: 'id',
    autoInc: true,
  })

  // 内部常量
  const CACHE_TTL = 600 // 缓存时间 600 秒
  const HTTP_TIMEOUT = 15000 // HTTP 超时 15 秒
  const COOLDOWN_SEC = 5 // 冷却时间 5 秒
  const SHOW_WAITING_MESSAGE = true // 显示等待消息

  let runtimeCookie = ((config.username && config.password) ? '' : (config.cookie?.trim() || process.env.SF6_COOKIE || '')).trim()
  const rankCache = new SimpleCache<RankData>(CACHE_TTL)
  const screenshotCache = new SimpleCache<Buffer>(CACHE_TTL)
  const winRateCache = new SimpleCache<WinRateData>(CACHE_TTL)
  const winRateScreenshotCache = new SimpleCache<Buffer>(CACHE_TTL)
  const battlelogScreenshotCache = new SimpleCache<Buffer>(CACHE_TTL)
  const playerSearchCache = new SimpleCache<PlayerSearchResult[]>(CACHE_TTL)
  const playerSearchScreenshotCache = new SimpleCache<Buffer>(CACHE_TTL)
  const cooldownMap = new Map<string, number>()

  // 如提供账号密码，启动时尝试自动登录以获取会话 Cookie
  if (config.username && config.password) {
    (async () => {
      try {
        await performLogin()
      } catch (e) {
        warnLog('自动登录失败:', e)
      }
    })()
  }

  // 增强日志输出
  function debugLog(message: string, ...args: any[]) {
    if (config.debug) {
      log.info(`[DEBUG] ${message}`, ...args)
    }
  }

  function infoLog(message: string, ...args: any[]) {
    log.info(`[INFO] ${message}`, ...args)
  }

  function warnLog(message: string, ...args: any[]) {
    log.warn(`[WARN] ${message}`, ...args)
  }

  function profileUrl(id: string) {
    return `${config.baseUrl}/${config.locale}/profile/${id}`
  }

  function playUrl(id: string) {
    return `${config.baseUrl}/${config.locale}/profile/${id}/play`
  }

  function battlelogUrl(id: string) {
    return `${config.baseUrl}/${config.locale}/profile/${id}/battlelog`
  }

  function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': config.userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': `${config.baseUrl}/${config.locale}/`,
    }
    if (runtimeCookie) headers['Cookie'] = runtimeCookie
    return headers
  }

  // 使用账号密码执行登录，成功后更新 runtimeCookie
  async function performLogin(): Promise<void> {
    if (!config.username || !config.password) return
    if (!ctx.puppeteer) throw new Error('需要 puppeteer 以执行登录')

    const page = await ctx.puppeteer.page()
    try {
      await page.setUserAgent(config.userAgent)
      // 打开入口页
      await page.goto(`${config.baseUrl}/${config.locale}/`, { waitUntil: 'domcontentloaded', timeout: HTTP_TIMEOUT })

      // 尝试点击“登录/Sign in”等入口（如存在）
      await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('a,button')) as HTMLElement[]
        const hit = items.find(el => {
          const t = (el.textContent || '').toLowerCase()
          const href = (el.getAttribute('href') || '').toLowerCase()
          return /login|sign\s*in|登录|登入|サインイン/.test(t + ' ' + href)
        })
        hit?.click()
      })

      // 等待页面切换
      await new Promise(res => setTimeout(res, 1200))

      // 填写并提交表单（尽量宽松地选择输入框）
      await page.evaluate((u, p) => {
        const pick = (sels: string[]) => sels.map(s => document.querySelector(s) as HTMLInputElement | null).find(Boolean)
        const user = pick(['input[type="email"]', 'input[name="email"]', 'input[type="text"]'])
        const pass = pick(['input[type="password"]'])
        if (user) { user.focus(); (user as any).value = String(u) }
        if (pass) { pass.focus(); (pass as any).value = String(p) }
        const form = document.querySelector('form') as HTMLFormElement | null
        if (form) form.submit()
        else (document.querySelector('button, input[type="submit"]') as HTMLElement | null)?.click()
      }, config.username, config.password)

      // 等待登录完成
      await new Promise(res => setTimeout(res, 2000))

      const cookieText = await page.evaluate(() => document.cookie)
      if (cookieText) {
        runtimeCookie = String(cookieText)
        infoLog('登录成功，已更新 Cookie')
      } else {
        warnLog('登录完成但未获取到 Cookie')
      }
    } finally {
      await page.close()
    }
  }

async function fetchHtml(url: string): Promise<string> {
  debugLog('开始请求页面', url)

  // 若配置了账号密码且尚未建立会话，先尝试登录
  if (config.username && config.password && !runtimeCookie) {
    try {
      await performLogin()
    } catch (e) {
      warnLog('自动登录失败，将直接请求:', e)
    }
  }

  try {
    const startTime = Date.now()
    let html = await ctx.http.get(url, { headers: buildHeaders(), timeout: HTTP_TIMEOUT })
    const endTime = Date.now()
    debugLog(`页面请求完成，耗时 ${endTime - startTime}ms，页面大小 ${html.length} 字符`)

    // 如果返回的是登录页，且配置了账号密码，自动登录并重试一次
    if (looksLikeLoginPage(html) && config.username && config.password) {
      infoLog('检测到登录页面，尝试自动登录后重试')
      try {
        await performLogin()
        html = await ctx.http.get(url, { headers: buildHeaders(), timeout: HTTP_TIMEOUT })
      } catch (err) {
        warnLog('自动登录或重试失败:', err)
      }
    }

    return html
  } catch (e: any) {
    const body = e?.response?.data
    if (e?.response?.status) {
      warnLog(`HTTP请求失败 ${e.response.status} for ${url}`)
    }
    if (typeof body === 'string') return body
    throw e
  }
}


  // 检测是否被重定向到登录页
  function looksLikeLoginPage(html: string): boolean {
    const text = html.toLowerCase()
    // 更精确的登录页检测 - 只有同时包含登录相关词汇和登录表单/按钮时才认为是登录页
    const hasLoginKeywords = /login|signin|登录|請登入|サインイン|sign in/.test(text)
    const hasLoginForm = /type=[\"\']password[\"\']|login.?form|signin.?form|oauth|auth.?button/.test(text)
    const hasProfileContent = /character_character_status|段位积分|league.?point|rank|profile/.test(text)
    
    // 如果有排位内容，就不是登录页
    if (hasProfileContent) return false
    
    // 只有既有登录关键词又有登录表单时才认为是登录页
    return hasLoginKeywords && hasLoginForm
  }

// 解析玩家搜索结果页面
function parsePlayerSearchResults(html: string): PlayerSearchResult[] {
  const results: PlayerSearchResult[] = []
  
  debugLog('开始解析搜索结果页面...')
  debugLog(`HTML长度: ${html.length}`)
  
  // 方法1: 匹配 list_fighter_list 容器内的每个 li 元素
  const fighterListRegex = /<ul class="list_fighter_list__[^"]*"[^>]*>([\s\S]*?)<\/ul>/
  const listMatch = fighterListRegex.exec(html)
  
  if (listMatch) {
    debugLog('找到 list_fighter_list 容器')
    const listContent = listMatch[1]
    debugLog(`list内容长度: ${listContent.length}`)
    
    // 匹配每个 li 项目 - 使用全局匹配
    const liRegex = /<li[^>]*>[\s\S]*?<\/li>/g
    const liMatches = listContent.match(liRegex) || []
    debugLog(`找到 ${liMatches.length} 个 li 元素`)
    
    for (let i = 0; i < liMatches.length; i++) {
      const liContent = liMatches[i]
      debugLog(`处理第 ${i + 1} 个 li 元素`)
      
      // 跳过非玩家项目的li（比如表头、分隔符等）
      if (liContent.includes('list_lp__') || liContent.includes('---积分') || liContent.includes('class="list_lp')) {
        debugLog(`第 ${i + 1} 个li是非玩家项目，跳过`)
        continue
      }
      
      // 提取相对路径的profile URL和玩家ID
      const hrefMatch = liContent.match(/href="(\/6\/buckler\/[^\/]+\/profile\/(\d+))"/)
      if (!hrefMatch) {
        debugLog(`第 ${i + 1} 个li未找到 profile 链接`)
        debugLog(`li内容片段: ${liContent.substring(0, 300)}`)
        continue
      }
      
      const relativePath = hrefMatch[1]
      const playerId = hrefMatch[2]
      // 修正URL拼接 - config.baseUrl已经包含了主域名，所以直接拼接相对路径
      const fullUrl = new URL(relativePath, config.baseUrl).toString()
      debugLog(`第 ${i + 1} 个li找到玩家ID: ${playerId}`)
      debugLog(`第 ${i + 1} 个li相对路径: ${relativePath}`)
      debugLog(`第 ${i + 1} 个li完整URL: ${fullUrl}`)
      
      // 提取玩家名称
      const nameMatch = liContent.match(/<span class="list_name__[^"]*">([^<]+)<\/span>/)
      if (!nameMatch) {
        debugLog(`第 ${i + 1} 个li未找到玩家名称`)
        continue
      }
      
      const playerName = nameMatch[1].trim()
      debugLog(`第 ${i + 1} 个li找到玩家名称: ${playerName}`)
      
      if (playerId && playerName) {
        results.push({
          playerId,
          playerName,
          url: fullUrl  // 直接使用完整URL
        })
        debugLog(`第 ${i + 1} 个li成功解析: ${playerName} (ID: ${playerId})`)
      }
    }
  } else {
    debugLog('未找到 list_fighter_list 容器')
  }
  
  // 方法2: 直接匹配整个HTML中的 profile 链接和玩家名称（更可靠）
  debugLog('使用方法2：直接匹配整个HTML...')
  
  // 先找到所有的相对路径 profile 链接 - 扩展正则以捕获更多可能的链接格式
  const profileRegexes = [
    /href="(\/6\/buckler\/[^\/]+\/profile\/(\d+))"/g,  // 标准格式
    /href="([^"]*\/profile\/(\d+)[^"]*)"/g,           // 更宽松的格式
  ]
  
  const profileMatches = []
  
  for (const profileRegex of profileRegexes) {
    profileRegex.lastIndex = 0 // 重置正则状态
    let profileMatch
    while ((profileMatch = profileRegex.exec(html)) !== null) {
      const fullPath = profileMatch[1]
      const playerId = profileMatch[2]
      
      // 避免重复添加相同的玩家ID
      if (!profileMatches.find(p => p.playerId === playerId)) {
        const fullUrl = fullPath.startsWith('http') ? fullPath : new URL(fullPath, config.baseUrl).toString()
        profileMatches.push({
          relativePath: fullPath,
          playerId: playerId,
          fullUrl: fullUrl
        })
      }
    }
  }
  
  debugLog(`找到 ${profileMatches.length} 个 profile 链接`)
  
  // 然后找到所有的玩家名称
  const nameRegex = /<span class="list_name__[^"]*">([^<]+)<\/span>/g
  const nameMatches = []
  let nameMatch
  
  while ((nameMatch = nameRegex.exec(html)) !== null) {
    nameMatches.push(nameMatch[1].trim())
  }
  
  debugLog(`找到 ${nameMatches.length} 个玩家名称: ${nameMatches.join(', ')}`)
  
  // 假设链接和名称的顺序是对应的
  const minLength = Math.min(profileMatches.length, nameMatches.length)
  for (let i = 0; i < minLength; i++) {
    const profile = profileMatches[i]
    const playerName = nameMatches[i]
    
    results.push({
      playerId: profile.playerId,
      playerName: playerName,
      url: profile.fullUrl  // 使用拼接后的完整URL
    })
    debugLog(`配对成功: ${playerName} (ID: ${profile.playerId})`)
  }
  
  debugLog(`搜索结果解析完成，共找到 ${results.length} 个玩家`)
  return results
}  // 获取玩家搜索数据
  async function getPlayerSearchData(playerName: string): Promise<PlayerSearchResult[]> {
    const cacheKey = `search:${playerName}`
    const cached = playerSearchCache.get(cacheKey)
    if (cached) {
      debugLog(`使用缓存的搜索结果: ${playerName}，缓存结果数量: ${cached.length}`)
      // 如果缓存的结果只有1个且实际应该有更多，清理缓存重新获取
      if (cached.length === 1) {
        debugLog('缓存结果可能不完整，清理缓存重新获取')
        playerSearchCache.clear()
      } else {
        return cached
      }
    }

    debugLog(`开始搜索玩家: ${playerName}`)
    
    // URL编码玩家名称
    const encodedName = encodeURIComponent(playerName)
    const searchUrl = `${config.baseUrl}/${config.locale}/fighterslist/search/result?fighter_id=${encodedName}&page=1`
    
    try {
      const html = await ctx.http.get(searchUrl, { headers: buildHeaders(), timeout: HTTP_TIMEOUT })
      debugLog(`获取到HTML，长度: ${html.length}`)
      
      if (looksLikeLoginPage(html)) {
        throw new Error('需要登录 Cookie 才能搜索玩家')
      }
      
      const results = parsePlayerSearchResults(html)
      playerSearchCache.set(cacheKey, results)
      debugLog(`搜索完成，找到 ${results.length} 个结果，已缓存`)
      
      return results
    } catch (e: any) {
      warnLog('搜索请求失败:', e)
      throw new Error(`搜索失败: ${e?.message || '未知错误'}`)
    }
  }

  // 截取玩家搜索结果页面
  async function takePlayerSearchScreenshot(playerName: string): Promise<Buffer> {
    const cacheKey = `search_screenshot:${playerName}`
    const cached = playerSearchScreenshotCache.get(cacheKey)
    if (cached) {
      debugLog(`使用缓存的搜索截图: ${playerName}`)
      return cached
    }

    debugLog(`开始截取搜索结果截图: ${playerName}`)
    
    const encodedName = encodeURIComponent(playerName)
    const searchUrl = `${config.baseUrl}/${config.locale}/fighterslist/search/result?fighter_id=${encodedName}&page=1`
    
    const page = await ctx.puppeteer.page()
    
    try {
      await page.setUserAgent(config.userAgent)
      
      if (runtimeCookie) {
        // 解析Cookie字符串
        const cookies = runtimeCookie.split(';').map(cookie => {
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
          debugLog(`成功设置 ${cookies.length} 个Cookie`)
        }
      }
      
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: HTTP_TIMEOUT })
      
      debugLog('页面加载完成，等待搜索结果元素...')
      
      // 尝试多种选择器等待搜索结果加载
      let element = null
      const selectors = [
        '.list_inner__hpkhV',
        '[class*="list_inner"]',
        '.fighterslist',
        'main',
        'body'
      ]
      
      for (const selector of selectors) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 })
          element = await page.$(selector)
          if (element) {
            debugLog(`找到元素使用选择器: ${selector}`)
            break
          }
        } catch (e) {
          debugLog(`选择器 ${selector} 未找到元素`)
        }
      }
      
      if (!element) {
        // 如果没有找到特定元素，截取整个可视区域
        debugLog('未找到特定元素，截取整个页面')
        const screenshot = await page.screenshot({ type: 'png', fullPage: true })
        playerSearchScreenshotCache.set(cacheKey, screenshot)
        debugLog(`搜索结果截图已缓存: ${playerName}`)
        return screenshot
      }
      
      // 截取找到的元素
      const screenshot = await element.screenshot({ type: 'png' })
      playerSearchScreenshotCache.set(cacheKey, screenshot)
      debugLog(`搜索结果截图已缓存: ${playerName}`)
      
      return screenshot
    } finally {
      await page.close()
    }
  }

  // 解析排位积分页面
  function parseRankData(html: string, playerId: string): RankData {
    const url = profileUrl(playerId)
    
    // 提取玩家名称 - 从特定的HTML元素中提取
    let playerName: string | undefined
    
    // 方法1: 从status_name元素中提取（最准确的方法）
    const statusNameMatch = html.match(/<span class="status_name__[^"]*">([^<]+)<\/span>/)
    if (statusNameMatch && statusNameMatch[1]) {
      playerName = statusNameMatch[1].trim()
      debugLog(`方法1(status_name)提取到玩家名称: ${playerName}`)
    }
    
    // 方法2: 如果方法1失败，尝试更宽松的class匹配
    if (!playerName) {
      const nameClassMatch = html.match(/<span class="[^"]*name[^"]*">([^<]+)<\/span>/)
      if (nameClassMatch && nameClassMatch[1]) {
        const candidate = nameClassMatch[1].trim()
        // 确保不是系统词汇
        if (!/^(设置|账号|简介|格斗|排位|退出|登录|资料|CFN|CAPCOM|STREET|FIGHTER|UTC|电竞|支持|包括|服务|独有|ZH-HANS)$/i.test(candidate)) {
          playerName = candidate
          debugLog(`方法2(name_class)提取到玩家名称: ${playerName}`)
        }
      }
    }
    
    // 方法3: 备用方案 - 从纯文本中提取（如果HTML解析失败）
    if (!playerName) {
      const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      const textParts = textContent.split(/\s+/).filter(part => part.length > 0)
      
      for (let i = 0; i < textParts.length - 2; i++) {
        if (textParts[i] === '简介' && textParts[i + 2] === '设置') {
          const candidate = textParts[i + 1]
          if (candidate && candidate.length >= 2 && candidate.length <= 20) {
            if (!/^(设置|账号|简介|格斗|排位|退出|登录|资料|CFN|CAPCOM|STREET|FIGHTER|UTC|电竞|支持|包括|服务|独有|ZH-HANS)$/i.test(candidate)) {
              playerName = candidate
              debugLog(`方法3(文本解析)提取到玩家名称: ${playerName}`)
              break
            }
          }
        }
      }
    }
    
    debugLog(`最终提取的玩家名称: ${playerName || '未找到'}`)
    
    // 提取角色名
    const characterMatch = html.match(/<p class="character_name__\w+"[^>]*>所用角色<span>([^<]+)<\/span><\/p>/)
    const character = characterMatch?.[1] || '未知'

    // 提取段位积分
    const rankPointsMatch = html.match(/<span class="character_point__\w+"[^>]*>([0-9,]+)积分<\/span>/)
    const rankPoints = rankPointsMatch ? parseInt(rankPointsMatch[1].replace(/,/g, '')) : 0

    // 提取段位名称 (从图片alt属性)
    const rankNameMatch = html.match(/<img alt="([^"]+)"[^>]*src="[^"]*\/rank\/rank\d+_s\.png"/)
    const rankName = rankNameMatch?.[1] || '未知段位'

    // 提取格斗点
    const fightingPointsMatch = html.match(/<dt><span>格斗点<\/span><\/dt><dd class="character_point__\w+"[^>]*>([0-9,]+)<\/dd>/)
    const fightingPoints = fightingPointsMatch ? parseInt(fightingPointsMatch[1].replace(/,/g, '')) : 0

    // 提取称号
    const titleMatch2 = html.match(/<span class="character_text__\w+"[^>]*>([^<]+)<\/span>/)
    const title = titleMatch2?.[1] || '无称号'

    return {
      playerId,
      playerName, // 新增玩家名称
      character,
      rankName,
      rankPoints,
      fightingPoints,
      title,
      url
    }
  }

  // 解析胜率页面
  function parseWinRateData(html: string, playerId: string): WinRateData {
    const url = playUrl(playerId)
    
    // 提取玩家名称（复用之前的逻辑）
    let playerName: string | undefined
    const statusNameMatch = html.match(/<span class="status_name__[^"]*">([^<]+)<\/span>/)
    if (statusNameMatch && statusNameMatch[1]) {
      playerName = statusNameMatch[1].trim()
      debugLog(`提取到玩家名称: ${playerName}`)
    }
    
    // 提取总胜率数据 - 查找"全部"的胜率信息
    let totalWins = 0
    let totalBattles = 0
    let winRate = 0
    
    // 方法1: 从winning_rate_inner块中提取第一个li（应该是"全部"）
    const allStatsMatch = html.match(/<div class="winning_rate_inner__[^"]*">[\s\S]*?<li>[\s\S]*?<p class="winning_rate_name__[^"]*">全部<\/p>[\s\S]*?<p class="winning_rate_rate__[^"]*">(\d+)胜(?:<!--[^>]*-->)*\/?(?:<!--[^>]*-->)*对战：(\d+)<\/p>[\s\S]*?<span>([0-9.]+)<\/span>%/)
    
    if (allStatsMatch) {
      totalWins = parseInt(allStatsMatch[1])
      totalBattles = parseInt(allStatsMatch[2])
      winRate = parseFloat(allStatsMatch[3])
      debugLog(`方法1提取胜率数据: ${totalWins}胜/${totalBattles}战 = ${winRate}%`)
    } else {
      // 方法2: 更宽松的匹配 - 包含HTML注释
      const winsMatch = html.match(/(\d+)胜(?:<!--[^>]*-->)*\/?(?:<!--[^>]*-->)*对战：(\d+)/)
      const rateMatch = html.match(/<span>([0-9.]+)<\/span>%/)
      
      if (winsMatch && rateMatch) {
        totalWins = parseInt(winsMatch[1])
        totalBattles = parseInt(winsMatch[2])
        winRate = parseFloat(rateMatch[1])
        debugLog(`方法2提取胜率数据: ${totalWins}胜/${totalBattles}战 = ${winRate}%`)
      } else {
        warnLog('无法提取胜率数据')
      }
    }
    
    return {
      playerId,
      playerName,
      totalWins,
      totalBattles,
      winRate,
      url
    }
  }

  async function getRankDataById(id: string): Promise<RankData> {
    const cacheKey = `rank:${id}`
    const cached = rankCache.get(cacheKey)
    if (cached) {
      debugLog(`从缓存获取排位数据: ${id}`)
      return cached
    }

    debugLog(`开始获取排位数据: ${id}`)
    const url = profileUrl(id)
    const html = await fetchHtml(url)
    
    debugLog(`页面内容长度: ${html.length}`)
    debugLog(`页面前200字符: ${html.substring(0, 200)}`)
    
    if (looksLikeLoginPage(html)) {
      warnLog('检测到登录页面，Cookie可能无效')
      throw new Error('需要有效登录 Cookie 才能访问排位信息。')
    }

    const rankData = parseRankData(html, id)
    debugLog(`解析结果:`, rankData)
    
    // 如果解析出的数据都是默认值，可能是页面结构问题
    if (rankData.character === '未知' && rankData.rankPoints === 0) {
      warnLog('解析结果异常，页面可能需要登录或结构已变更')
      throw new Error('无法解析排位信息，可能需要重新设置Cookie或页面结构已变更。')
    }
    
    rankCache.set(cacheKey, rankData)
    infoLog(`成功获取并缓存排位数据: ${id}`)
    return rankData
  }

  async function getWinRateDataById(id: string): Promise<WinRateData> {
    const cacheKey = `winrate:${id}`
    const cached = winRateCache.get(cacheKey)
    if (cached) {
      debugLog(`从缓存获取胜率数据: ${id}`)
      return cached
    }

    debugLog(`开始获取胜率数据: ${id}`)
    const url = playUrl(id)
    const html = await fetchHtml(url)
    
    if (looksLikeLoginPage(html)) {
      throw new Error('需要登录才能查看此页面，请检查Cookie设置')
    }

    const winRateData = parseWinRateData(html, id)
    debugLog(`胜率解析结果:`, winRateData)
    
    // 如果解析出的数据都是默认值，可能是页面结构问题
    if (winRateData.totalBattles === 0 && winRateData.winRate === 0) {
      warnLog('胜率解析结果异常，页面可能需要登录或结构已变更')
      throw new Error('无法解析胜率信息，可能需要重新设置Cookie或页面结构已变更。')
    }
    
    winRateCache.set(cacheKey, winRateData)
    infoLog(`成功获取并缓存胜率数据: ${id}`)
    return winRateData
  }

  async function takeScreenshot(id: string): Promise<Buffer> {
    const cacheKey = `screenshot:${id}`
    const cached = screenshotCache.get(cacheKey)
    if (cached) {
      debugLog(`从缓存获取截图: ${id}`)
      return cached
    }

    // 检查是否有 puppeteer 服务
    if (!ctx.puppeteer) {
      throw new Error('需要安装 puppeteer 服务才能使用截图功能。请安装 koishi-plugin-puppeteer。')
    }

    debugLog(`开始截图流程: ${id}`)
    const url = profileUrl(id)
    const page = await ctx.puppeteer.page()
    
    try {
      // 设置更真实的浏览器环境
      debugLog('设置浏览器环境')
      await page.setUserAgent(config.userAgent)
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      })

      // 设置Cookie
      if (runtimeCookie) {
        debugLog('开始设置Cookie')
        const cookies = runtimeCookie.split(';').map(cookie => {
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
          debugLog(`成功设置 ${cookies.length} 个Cookie`)
        }
      }

      await page.setViewport({ 
        width: 1920, 
        height: 1080 
      })
      
      debugLog('开始导航到页面:', url)
      
      // 导航到页面并等待加载
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: HTTP_TIMEOUT 
      })
      
      debugLog('页面导航完成，等待内容加载')
      // 额外等待，确保动态内容加载
      await new Promise(resolve => setTimeout(resolve, 3000))
      
      // 检查是否是错误页面
      const pageTitle = await page.evaluate(() => document.title)
      const pageText = await page.evaluate(() => document.body.innerText)
      
      debugLog(`页面标题: ${pageTitle}`)
      debugLog(`页面文本前200字符: ${pageText.substring(0, 200)}`)
      
      if (pageText.includes('403') || pageText.includes('ERROR') || pageText.includes('blocked')) {
        warnLog('检测到访问被拒绝页面')
        throw new Error('访问被拒绝：可能是Cookie无效或网站检测到自动化访问。请重新获取Cookie。')
      }
      
      // 尝试找到overview区域（包含角色信息和数据）
      const selectors = [
        '.overview_inner__cN9HT',              // 完整的overview区域
        '.overview_bg__13XYX',                 // overview背景区域  
        '.character_character_status__5EtcB',  // 只是角色状态
        'article[class*="character_status"]',   // 模糊匹配
        'article[class*="character"]',          // 更宽泛的匹配
        'main',                                 // 兜底选择器
        'body'                                  // 最后的兜底
      ]
      
      let element = null
      let usedSelector = ''
      
      for (const selector of selectors) {
        try {
          debugLog(`尝试选择器: ${selector}`)
          await page.waitForSelector(selector, { timeout: 3000 })
          element = await page.$(selector)
          if (element) {
            usedSelector = selector
            debugLog(`成功找到元素，使用选择器: ${selector}`)
            break
          }
        } catch (e) {
          debugLog(`选择器 ${selector} 失败，尝试下一个`)
          continue
        }
      }
      
      if (element) {
        debugLog(`开始截取元素 (${usedSelector})`)
        const screenshot = await element.screenshot({ type: 'png' })
        screenshotCache.set(cacheKey, screenshot)
        infoLog(`成功完成截图并缓存: ${id}`)
        return screenshot
      }
      
      // 最后兜底：截取整个页面
      warnLog('所有选择器失败，截取整个页面')
      const screenshot = await page.screenshot({ type: 'png', fullPage: false })
      screenshotCache.set(cacheKey, screenshot)
      return screenshot
      
    } finally {
      await page.close()
      debugLog('浏览器页面已关闭')
    }
  }

  async function takeWinRateScreenshot(id: string): Promise<Buffer> {
    const cacheKey = `winrate_screenshot:${id}`
    const cached = winRateScreenshotCache.get(cacheKey)
    if (cached) {
      debugLog(`从缓存获取胜率截图: ${id}`)
      return cached
    }

    debugLog(`开始胜率截图流程: ${id}`)
    const url = playUrl(id)
    const page = await ctx.puppeteer.page()
    
    try {
      // 设置浏览器环境
      debugLog('设置浏览器环境')
      await page.setUserAgent(config.userAgent)
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Referer': profileUrl(id)
      })
      
      // 设置视窗尺寸
      await page.setViewport({ width: 1920, height: 1080 })
      
      // 设置Cookie
      if (runtimeCookie) {
        debugLog('开始设置Cookie')
        const cookies = runtimeCookie.split(';').map(cookie => {
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
          debugLog(`成功设置 ${cookies.length} 个Cookie`)
        }
      }

      // 导航到胜率页面
      debugLog(`开始导航到页面: ${url}`)
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', // 改为更快的等待条件
        timeout: 30000  // 增加超时时间到30秒
      })
      debugLog('页面导航完成，等待内容加载')
      
      // 等待胜率内容加载 - 使用新的winning_rate_winning_rate类
      try {
        await page.waitForSelector('[class*="winning_rate_winning_rate"]', { timeout: 15000 })
        debugLog('胜率内容加载完成')
      } catch (e) {
        debugLog('等待胜率内容超时，尝试直接截图')
        // 如果等待超时，仍然尝试截图，可能内容已经加载但选择器不匹配
      }
      
      // 截图指定区域或整个页面
      let screenshot: Buffer
      try {
        // 尝试截取指定的winning_rate_winning_rate区域
        const element = await page.$('[class*="winning_rate_winning_rate"]')
        if (element) {
          debugLog('找到winning_rate_winning_rate元素，截取指定区域')
          screenshot = await element.screenshot({ type: 'png' })
        } else {
          debugLog('未找到winning_rate_winning_rate元素，截取整个页面')
          screenshot = await page.screenshot({
            fullPage: true,
            type: 'png'
          })
        }
      } catch (e) {
        debugLog('区域截图失败，使用整页截图')
        screenshot = await page.screenshot({
          fullPage: true,
          type: 'png'
        })
      }
      
      winRateScreenshotCache.set(cacheKey, screenshot)
      infoLog(`成功完成胜率截图并缓存: ${id}`)
      return screenshot
      
    } finally {
      await page.close()
      debugLog('浏览器页面已关闭')
    }
  }

  async function takeBattlelogScreenshot(id: string): Promise<Buffer> {
    const cacheKey = `battlelog_screenshot:${id}`
    const cached = battlelogScreenshotCache.get(cacheKey)
    if (cached) {
      debugLog(`从缓存获取战斗记录截图: ${id}`)
      return cached
    }

    debugLog(`开始战斗记录截图流程: ${id}`)
    const url = battlelogUrl(id)
    const page = await ctx.puppeteer.page()
    
    try {
      // 设置浏览器环境
      debugLog('设置浏览器环境')
      await page.setUserAgent(config.userAgent)
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Referer': profileUrl(id)
      })
      
      // 设置视窗尺寸
      await page.setViewport({ width: 1920, height: 1080 })
      
      // 设置Cookie
      if (runtimeCookie) {
        debugLog('开始设置Cookie')
        const cookies = runtimeCookie.split(';').map(cookie => {
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
          debugLog(`成功设置 ${cookies.length} 个Cookie`)
        }
      }

      // 导航到战斗记录页面
      debugLog(`开始导航到页面: ${url}`)
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', // 更快的等待条件
        timeout: 30000  // 30秒超时
      })
      debugLog('页面导航完成，等待内容加载')
      
      // 等待战斗记录内容加载
      try {
        await page.waitForSelector('[class*="battlelog_inner"]', { timeout: 15000 })
        debugLog('战斗记录内容加载完成')
      } catch (e) {
        debugLog('等待战斗记录内容超时，尝试直接截图')
        // 如果等待超时，仍然尝试截图，可能内容已经加载但选择器不匹配
      }
      
      // 截图指定区域或整个页面
      let screenshot: Buffer
      try {
        // 尝试截取指定的battlelog_inner区域
        const element = await page.$('[class*="battlelog_inner"]')
        if (element) {
          debugLog('找到battlelog_inner元素，截取指定区域')
          screenshot = await element.screenshot({ type: 'png' })
        } else {
          debugLog('未找到battlelog_inner元素，截取整个页面')
          screenshot = await page.screenshot({
            fullPage: true,
            type: 'png'
          })
        }
      } catch (e) {
        debugLog('区域截图失败，使用整页截图')
        screenshot = await page.screenshot({
          fullPage: true,
          type: 'png'
        })
      }
      
      battlelogScreenshotCache.set(cacheKey, screenshot)
      infoLog(`成功完成战斗记录截图并缓存: ${id}`)
      return screenshot
      
    } finally {
      await page.close()
      debugLog('浏览器页面已关闭')
    }
  }

  function formatRankData(data: RankData): string {
    const parts: string[] = []
    const playerInfo = data.playerName ? `${data.playerName} (ID: ${data.playerId})` : data.playerId
    parts.push(`玩家：${playerInfo}`)
    parts.push(`使用角色：${data.character}`)
    parts.push(`段位：${data.rankName}`)
    parts.push(`排位积分：${data.rankPoints.toLocaleString()}`)
    parts.push(`格斗点：${data.fightingPoints.toLocaleString()}`)
    if (data.title !== '无称号') parts.push(`称号：${data.title}`)
    parts.push(`详情：${data.url}`)
    return parts.join('\n')
  }

  function formatWinRateData(data: WinRateData): string {
    const parts: string[] = []
    const playerInfo = data.playerName ? `${data.playerName} (ID: ${data.playerId})` : data.playerId
    parts.push(`玩家：${playerInfo}`)
    parts.push(`总战绩：${data.totalWins}胜/${data.totalBattles}战`)
    parts.push(`总胜率：${data.winRate.toFixed(2)}%`)
    parts.push(`详情：${data.url}`)
    return parts.join('\n')
  }

  function inCooldown(key: string): boolean {
    const last = cooldownMap.get(key) || 0
    const now = Date.now()
    if (now - last < COOLDOWN_SEC * 1000) return true
    cooldownMap.set(key, now)
    return false
  }

  // 获取用户绑定的玩家ID
  async function getUserPlayerId(userId: string): Promise<string | null> {
    try {
      const bindings = await ctx.database.get('streetfighter6_binding', { userId })
      return bindings.length > 0 ? bindings[0].playerId : null
    } catch (e) {
      warnLog('获取用户绑定ID失败:', e)
      return null
    }
  }

  // 设置用户绑定的玩家ID
  async function setUserPlayerId(userId: string, playerId: string): Promise<boolean> {
    try {
      const existing = await ctx.database.get('streetfighter6_binding', { userId })
      if (existing.length > 0) {
        await ctx.database.set('streetfighter6_binding', { userId }, { playerId })
      } else {
        await ctx.database.create('streetfighter6_binding', { userId, playerId })
      }
      infoLog(`成功设置用户 ${userId} 的玩家ID: ${playerId}`)
      return true
    } catch (e) {
      warnLog('设置用户绑定ID失败:', e)
      return false
    }
  }

  // 删除用户绑定的玩家ID
  async function removeUserPlayerId(userId: string): Promise<boolean> {
    try {
      await ctx.database.remove('streetfighter6_binding', { userId })
      infoLog(`成功移除用户 ${userId} 的玩家ID绑定`)
      return true
    } catch (e) {
      warnLog('移除用户绑定ID失败:', e)
      return false
    }
  }

  // 绑定ID
  ctx.command('绑定ID <playerId:string>', '绑定你的 SF6 玩家ID')
    .example('绑定ID 1234567890')
    .action(async ({ session }, playerId) => {
      if (!playerId) {
        return '用法：绑定ID <玩家ID>\n例如：绑定ID 1234567890'
      }
      
      const id = playerId.trim()
      if (!/^\d{5,}$/.test(id)) {
        return '玩家ID格式错误，应该是5位以上的数字。'
      }
      
      try {
        infoLog(`开始绑定ID操作，用户: ${session!.userId}, 参数: ${playerId}`)
        
        const success = await setUserPlayerId(session!.userId, id)
        if (success) {
          return `已绑定玩家ID：${id}\n之后可直接使用：排位查询 / 胜率查询 / 战斗记录`
        } else {
          return '绑定失败，请稍后重试。'
        }
      } catch (e: any) {
        warnLog('绑定ID操作失败:', e)
        return `绑定失败：${e?.message || '未知错误'}`
      }
    })

  // 解绑ID
  ctx.command('解绑ID', '清除已绑定的 SF6 玩家ID')
    .action(async ({ session }) => {
      try {
        infoLog(`开始解绑ID操作，用户: ${session!.userId}`)
        
        const success = await removeUserPlayerId(session!.userId)
        if (success) {
          return '已清除绑定的玩家ID。'
        } else {
          return '解绑失败，请稍后重试。'
        }
      } catch (e: any) {
        warnLog('解绑ID操作失败:', e)
        return `解绑失败：${e?.message || '未知错误'}`
      }
    })

  // 主命令：排位查询 [玩家ID]
  ctx.command('排位查询 [playerId:string]', '查询 SF6 排位积分信息')
    .example('排位查询 1234567890')
    .action(async ({ session }, playerId) => {
      try {
        infoLog(`开始排位查询，用户: ${session?.userId}, 参数: ${playerId}`)
        
        let id = playerId?.trim()
        if (!id) {
          // 如果没有提供参数，尝试获取绑定的ID
          id = await getUserPlayerId(session!.userId)
        }
        infoLog(`最终使用的玩家ID: ${id}`)
        
        if (!id) {
          warnLog('排位查询失败：未绑定玩家ID且未提供参数')
          return '未绑定玩家ID。请先使用：绑定ID <玩家ID>'
        }
        if (!/^\d{5,}$/.test(id)) {
          warnLog(`排位查询失败：ID格式错误 - ${id}`)
          return '玩家ID格式错误，应该是5位以上的数字。'
        }

        const cdKey = session?.channelId ? `c:${session.channelId}` : `u:${session?.userId ?? 'anon'}`
        if (inCooldown(cdKey)) return `请稍候再试（冷却 ${COOLDOWN_SEC}s）`
        
        // 检查是否启用了任何输出
        if (!config.enableTextOutput && !config.enableScreenshotOutput) {
          return '错误：文本输出和截图输出都已禁用，请在配置中启用至少一项。'
        }

        infoLog(`开始查询玩家: ${id}`)

        // 显示等待消息
        let waitingMessageId: string | undefined
        if (SHOW_WAITING_MESSAGE && session) {
          try {
            const suffix = playerId ? '' : '（使用已绑定ID）'
            const waitingMessage = await session.send(`🔍 正在查询玩家 ${id} 的排位信息，请稍候...${suffix}`)
            if (Array.isArray(waitingMessage) && waitingMessage[0]) {
              waitingMessageId = waitingMessage[0]
            }
            debugLog(`显示等待消息: ${waitingMessageId}`)
          } catch (e) {
            debugLog('发送等待消息失败:', e)
          }
        }

        try {
          // 分别处理文本和截图，避免一个失败影响另一个
          const results: { text?: RankData; screenshot?: Buffer; errors: string[] } = { errors: [] }
          
          // 处理文本输出
          if (config.enableTextOutput) {
            debugLog('启用文本输出，开始获取排位数据')
            try {
              const data = await getRankDataById(id)
              results.text = data
              debugLog(`排位文本信息已准备`)
            } catch (e: any) {
              warnLog('排位文本获取失败:', e)
              results.errors.push(`文本获取失败: ${e?.message || '未知错误'}`)
            }
          }

          // 处理截图输出
          if (config.enableScreenshotOutput) {
            debugLog('启用截图输出，开始截图')
            try {
              const screenshot = await takeScreenshot(id)
              results.screenshot = screenshot
              debugLog(`排位截图已准备`)
            } catch (e: any) {
              warnLog('排位截图获取失败:', e)
              results.errors.push(`截图获取失败: ${e?.message || '未知错误'}`)
            }
          }

          infoLog(`排位查询完成`)
          
          // 撤回等待消息
          if (waitingMessageId && session?.bot?.deleteMessage) {
            try {
              await session.bot.deleteMessage(session.channelId, waitingMessageId)
              debugLog(`撤回等待消息: ${waitingMessageId}`)
            } catch (e) {
              debugLog(`撤回等待消息失败: ${e}`)
            }
          }

          // 发送结果 - 分别发送，避免一个失败影响另一个
          const responses: string[] = []
          
          if (results.text) {
            try {
              const textOutput = formatRankData(results.text)
              await session?.send(textOutput)
              responses.push('文本信息发送成功')
            } catch (e) {
              warnLog('文本信息发送失败:', e)
              responses.push('文本信息发送失败')
            }
          }
          
          if (results.screenshot) {
            try {
              await session?.send(`📸 详细信息截图：`)
              await session?.send(h.image(results.screenshot, 'image/png'))
              responses.push('截图发送成功')
            } catch (e) {
              warnLog('截图发送失败:', e)
              responses.push('截图发送失败')
            }
          }
          
          // 如果有错误，添加错误信息
          if (results.errors.length > 0) {
            responses.push(`部分功能失败: ${results.errors.join(', ')}`)
          }
          
          if (responses.length === 0) {
            return '查询完成但没有可显示的内容'
          }
          
          // 只在所有操作都失败时才返回错误
          return null // 已经分别发送了，不需要return
          
        } catch (e: any) {
          warnLog('查询失败:', e?.message)
          
          // 撤回等待消息
          if (waitingMessageId && session) {
            try {
              await session.bot.deleteMessage(session.channelId, waitingMessageId)
              debugLog(`撤回等待消息: ${waitingMessageId}`)
            } catch (e) {
              debugLog('撤回等待消息失败:', e)
            }
          }
          
          if (String(e?.message).includes('Cookie')) {
            return '排位查询失败：需要有效登录 Cookie。请检查配置中的Cookie设置。'
          }
          if (String(e?.message).includes('puppeteer')) {
            return '截图功能不可用：需要安装 puppeteer 插件。'
          }
          return `查询失败：${e?.message || '未知错误'}`
        }
      } catch (e: any) {
        warnLog('排位查询整体失败:', e)
        return `排位查询失败：${e?.message || '未知错误'}`
      }
    })

  // 胜率查询命令
  ctx.command('胜率查询 [playerId:string]', '查询 SF6 胜率信息')
    .example('胜率查询 1234567890')
    .action(async ({ session }, playerId) => {
      let id = playerId?.trim()
      if (!id) {
        // 如果没有提供参数，尝试获取绑定的ID
        id = await getUserPlayerId(session!.userId)
      }
      if (!id) return '未绑定玩家ID。请先使用：绑定ID <玩家ID>'
      if (!/^\d{5,}$/.test(id)) return '玩家ID格式错误，应该是5位以上的数字。'

      const userId = session?.userId || 'unknown'
      const cooldownKey = `winrate:${userId}:${id}`
      
      if (inCooldown(cooldownKey)) {
        return `查询太频繁，请稍后再试。（冷却时间：${COOLDOWN_SEC}秒）`
      }

      try {
        infoLog(`开始查询胜率: ${id}`)
        
        // 显示等待消息
        let waitingMessageId: string | undefined
        if (SHOW_WAITING_MESSAGE) {
          const suffix = playerId ? '' : '（使用已绑定ID）'
          const waitingMessage = await session?.send(`🔍 正在查询胜率信息，请稍候...${suffix}`)
          if (waitingMessage && Array.isArray(waitingMessage) && waitingMessage[0]) {
            waitingMessageId = waitingMessage[0]
            debugLog(`显示等待消息: ${waitingMessageId}`)
          }
        }

        const promises: Promise<any>[] = []
        let textOutput = ''
        let screenshotBuffer: Buffer | undefined

        // 分别处理文本和截图，避免一个失败影响另一个
        const results: { text?: WinRateData; screenshot?: Buffer; errors: string[] } = { errors: [] }

        // 处理文本输出
        if (config.enableTextOutput) {
          debugLog('启用文本输出，开始获取胜率数据')
          try {
            const data = await getWinRateDataById(id)
            results.text = data
            textOutput = formatWinRateData(data)
            debugLog(`胜率文本信息已准备`)
          } catch (e: any) {
            warnLog('胜率文本获取失败:', e)
            results.errors.push(`文本获取失败: ${e?.message || '未知错误'}`)
          }
        }

        // 处理截图输出
        if (config.enableScreenshotOutput) {
          debugLog('启用截图输出，开始截图')
          try {
            screenshotBuffer = await takeWinRateScreenshot(id)
            results.screenshot = screenshotBuffer
            debugLog(`胜率截图已准备`)
          } catch (e: any) {
            warnLog('胜率截图获取失败:', e)
            results.errors.push(`截图获取失败: ${e?.message || '未知错误'}`)
          }
        }

        infoLog(`胜率查询完成`)
        
        // 撤回等待消息
        if (waitingMessageId && session?.bot?.deleteMessage) {
          try {
            await session.bot.deleteMessage(session.channelId, waitingMessageId)
            debugLog(`撤回等待消息: ${waitingMessageId}`)
          } catch (e) {
            debugLog(`撤回等待消息失败: ${e}`)
          }
        }

        // 发送结果 - 分别发送，避免一个失败影响另一个
        const responses: string[] = []
        
        if (textOutput) {
          try {
            await session?.send(textOutput)
            responses.push('文本信息发送成功')
          } catch (e) {
            warnLog('文本信息发送失败:', e)
            responses.push('文本信息发送失败')
          }
        }
        
        if (screenshotBuffer) {
          try {
            await session?.send(`📸 胜率详情截图：`)
            await session?.send(h.image(screenshotBuffer, 'image/png'))
            responses.push('截图发送成功')
          } catch (e) {
            warnLog('截图发送失败:', e)
            responses.push('截图发送失败')
          }
        }
        
        // 如果有错误，添加错误信息
        if (results.errors.length > 0) {
          responses.push(`部分功能失败: ${results.errors.join(', ')}`)
        }
        
        if (responses.length === 0) {
          return '查询完成但没有可显示的内容'
        }
        
        // 只在所有操作都失败时才返回错误
        return null // 已经分别发送了，不需要return
        
      } catch (e: any) {
        warnLog('胜率查询失败:', e)
        
        if (String(e?.message).includes('登录')) {
          return '查询失败：需要登录权限。请检查Cookie设置。'
        }
        
        if (String(e?.message).includes('Cookie')) {
          return '胜率查询失败：需要有效登录 Cookie。请检查配置中的Cookie设置。'
        }
        if (String(e?.message).includes('puppeteer')) {
          return '截图功能不可用：需要安装 puppeteer 插件。'
        }
        return `胜率查询失败：${e?.message || '未知错误'}`
      }
    })

  // 战斗记录查询命令
  ctx.command('战斗记录 [playerId:string]', '查询 SF6 战斗记录')
    .example('战斗记录 1234567890')
    .action(async ({ session }, playerId) => {
      let id = playerId?.trim()
      if (!id) {
        // 如果没有提供参数，尝试获取绑定的ID
        id = await getUserPlayerId(session!.userId)
      }
      if (!id) return '未绑定玩家ID。请先使用：绑定ID <玩家ID>'
      if (!/^\d{5,}$/.test(id)) return '玩家ID格式错误，应该是5位以上的数字。'

      const userId = session?.userId || 'unknown'
      const cooldownKey = `battlelog:${userId}:${id}`
      
      if (inCooldown(cooldownKey)) {
        return `查询太频繁，请稍后再试。（冷却时间：${COOLDOWN_SEC}秒）`
      }

      try {
        infoLog(`开始查询战斗记录: ${id}`)
        
        // 显示等待消息
        let waitingMessageId: string | undefined
        if (SHOW_WAITING_MESSAGE) {
          const suffix = playerId ? '' : '（使用已绑定ID）'
          const waitingMessage = await session?.send(`🔍 正在查询战斗记录，请稍候...${suffix}`)
          if (waitingMessage && Array.isArray(waitingMessage) && waitingMessage[0]) {
            waitingMessageId = waitingMessage[0]
            debugLog(`显示等待消息: ${waitingMessageId}`)
          }
        }

        let screenshotBuffer: Buffer | undefined
        let errorMessage = ''

        // 处理截图
        try {
          debugLog('开始获取战斗记录截图')
          screenshotBuffer = await takeBattlelogScreenshot(id)
          debugLog('战斗记录截图已准备')
        } catch (e: any) {
          warnLog('战斗记录截图获取失败:', e)
          errorMessage = `截图获取失败: ${e?.message || '未知错误'}`
        }

        infoLog(`战斗记录查询完成`)
        
        // 撤回等待消息
        if (waitingMessageId && session?.bot?.deleteMessage) {
          try {
            await session.bot.deleteMessage(session.channelId, waitingMessageId)
            debugLog(`撤回等待消息: ${waitingMessageId}`)
          } catch (e) {
            debugLog(`撤回等待消息失败: ${e}`)
          }
        }

        // 发送结果
        if (screenshotBuffer) {
          try {
            await session?.send(`📸 战斗记录截图：`)
            await session?.send(h.image(screenshotBuffer, 'image/png'))
            return null // 成功发送截图
          } catch (e) {
            warnLog('截图发送失败:', e)
            return '截图发送失败'
          }
        } else {
          return errorMessage || '查询失败，无法获取战斗记录截图'
        }
        
      } catch (e: any) {
        warnLog('战斗记录查询失败:', e)
        
        if (String(e?.message).includes('登录')) {
          return '查询失败：需要登录权限。请检查Cookie设置。'
        }
        
        if (String(e?.message).includes('Cookie')) {
          return '战斗记录查询失败：需要有效登录 Cookie。请检查配置中的Cookie设置。'
        }
        if (String(e?.message).includes('puppeteer')) {
          return '截图功能不可用：需要安装 puppeteer 插件。'
        }
        return `战斗记录查询失败：${e?.message || '未知错误'}`
      }
    })

  // 玩家搜索命令
  ctx.command('玩家搜索 <playerName:string>', '搜索 SF6 玩家')
    .example('玩家搜索 幻想童話')
    .action(async ({ session }, playerName) => {
      if (!playerName) return '用法：玩家搜索 <玩家名称>\n例如：玩家搜索 幻想童話'
      
      if (playerName.trim().length === 0) {
        return '玩家名称不能为空。'
      }

      const name = playerName.trim()
      const userId = session?.userId || 'unknown'
      const cooldownKey = `search:${userId}:${name}`
      
      if (inCooldown(cooldownKey)) {
        return `查询太频繁，请稍后再试。（冷却时间：${COOLDOWN_SEC}秒）`
      }

      try {
        infoLog(`开始搜索玩家: ${name}`)
        
        // 显示等待消息
        let waitingMessageId: string | undefined
        if (SHOW_WAITING_MESSAGE) {
          const waitingMessage = await session?.send(`🔍 正在搜索玩家 "${name}"，请稍候...`)
          if (waitingMessage && Array.isArray(waitingMessage) && waitingMessage[0]) {
            waitingMessageId = waitingMessage[0]
            debugLog(`显示等待消息: ${waitingMessageId}`)
          }
        }

        // 分别处理文本和截图，避免一个失败影响另一个
        const results: { text?: PlayerSearchResult[]; screenshot?: Buffer; errors: string[] } = { errors: [] }

        // 处理文本输出
        if (config.enableTextOutput) {
          try {
            debugLog('开始获取搜索结果数据')
            results.text = await getPlayerSearchData(name)
            debugLog(`搜索结果数据已准备，共 ${results.text.length} 个结果`)
          } catch (e: any) {
            warnLog('搜索结果获取失败:', e)
            results.errors.push(`文本查询失败: ${e?.message || '未知错误'}`)
          }
        }

        // 处理截图输出
        if (config.enableScreenshotOutput) {
          try {
            debugLog('开始获取搜索结果截图')
            results.screenshot = await takePlayerSearchScreenshot(name)
            debugLog('搜索结果截图已准备')
          } catch (e: any) {
            warnLog('搜索截图获取失败:', e)
            results.errors.push(`截图获取失败: ${e?.message || '未知错误'}`)
          }
        }

        infoLog(`玩家搜索完成`)
        
        // 撤回等待消息
        if (waitingMessageId && session?.bot?.deleteMessage) {
          try {
            await session.bot.deleteMessage(session.channelId, waitingMessageId)
            debugLog(`撤回等待消息: ${waitingMessageId}`)
          } catch (e) {
            debugLog(`撤回等待消息失败: ${e}`)
          }
        }

        // 发送结果 - 分别发送，避免一个失败影响另一个
        const responses: string[] = []
        
        if (results.text && results.text.length > 0) {
          try {
            if (config.enableForwardMessage && results.text.length > 1 && ['qq', 'onebot'].includes(session?.platform)) {
              // 使用合并转发发送多个玩家结果
              const contentNodes = [
                h.text(`🔍 搜索到 ${results.text.length} 个玩家：`),
                ...results.text.map((player, index) => 
                  h.text(`${index + 1}. ${player.playerName}\nID: ${player.playerId}\n链接: ${player.url}`)
                )
              ]
              
              await session?.send(h('figure', {}, contentNodes))
              responses.push('合并转发消息')
            } else {
              // 普通消息发送
              const header = `🔍 搜索到 ${results.text.length} 个玩家：`
              const lines = results.text.map((player, index) => {
                return `${index + 1}. ${player.playerName}\n   ID: ${player.playerId}\n   链接: ${player.url}`
              })
              const fullText = [header, '', ...lines].join('\n')

              // 分段发送，避免过长被平台截断
              const chunks: string[] = []
              const maxLen = 3500
              let start = 0
              while (start < fullText.length) {
                chunks.push(fullText.slice(start, start + maxLen))
                start += maxLen
              }
              for (const chunk of chunks) {
                await session?.send(chunk)
              }
              responses.push('文本信息')
            }
          } catch (e) {
            warnLog('文本发送失败:', e)
            responses.push('文本发送失败')
          }
        } else if (config.enableTextOutput && (!results.text || results.text.length === 0)) {
          try {
            await session?.send(`未找到名称包含 "${name}" 的玩家`)
            responses.push('搜索结果为空')
          } catch (e) {
            warnLog('搜索结果发送失败:', e)
          }
        }
        
        if (results.screenshot) {
          try {
            await session?.send(`📸 搜索结果截图：`)
            await session?.send(h.image(results.screenshot, 'image/png'))
            responses.push('截图')
          } catch (e) {
            warnLog('截图发送失败:', e)
            responses.push('截图发送失败')
          }
        }
        
        if (responses.length === 0) {
          return '搜索完成但没有可显示的内容'
        }
        
        // 只在所有操作都失败时才返回错误
        return null // 已经分别发送了，不需要return
        
      } catch (e: any) {
        warnLog('搜索失败:', e?.message)
        
        if (String(e?.message).includes('Cookie')) {
          return '搜索失败：需要有效登录 Cookie。请检查配置中的Cookie设置。'
        }
        if (String(e?.message).includes('puppeteer')) {
          return '截图功能不可用：需要安装 puppeteer 插件。'
        }
        return `搜索失败：${e?.message || '未知错误'}`
      }
    })

  // 资源回收
  ctx.on('dispose', () => {
    rankCache.clear()
    screenshotCache.clear()
    winRateCache.clear()
    winRateScreenshotCache.clear()
    battlelogScreenshotCache.clear()
    playerSearchCache.clear()
    playerSearchScreenshotCache.clear()
    cooldownMap.clear()
  })
}
