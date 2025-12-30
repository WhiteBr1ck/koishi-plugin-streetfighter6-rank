import { PluginState, HTTP_TIMEOUT } from '../state'

/**
 * 构建请求头
 */
export function buildHeaders(state: PluginState): Record<string, string> {
    const headers: Record<string, string> = {
        'User-Agent': state.config.userAgent,
        'Accept-Language': state.config.locale,
    }
    if (state.runtimeCookie) {
        headers['Cookie'] = state.runtimeCookie
    }
    return headers
}

/**
 * 构建 profile 页面 URL
 */
export function profileUrl(state: PluginState, id: string): string {
    return `${state.config.baseUrl}/${state.config.locale}/profile/${id}`
}

/**
 * 构建 play 页面 URL
 */
export function playUrl(state: PluginState, id: string): string {
    return `${state.config.baseUrl}/${state.config.locale}/profile/${id}/play`
}

/**
 * 构建 battlelog 页面 URL
 */
export function battlelogUrl(state: PluginState, id: string): string {
    return `${state.config.baseUrl}/${state.config.locale}/profile/${id}/battlelog/rank`
}

/**
 * 获取 HTML 内容
 */
export async function fetchHtml(state: PluginState, url: string): Promise<string> {
    const headers = buildHeaders(state)
    state.debugLog(`正在获取HTML: ${url}`)
    state.debugLog(`请求头: ${JSON.stringify({ ...headers, Cookie: headers.Cookie ? '[REDACTED]' : undefined })}`)

    const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
    })

    if (!res.ok) {
        state.warnLog(`HTTP 请求失败: ${res.status} ${res.statusText}`)
        throw new Error(`请求失败: ${res.status}`)
    }

    const html = await res.text()
    state.debugLog(`获取到HTML，长度: ${html.length}`)
    return html
}

/**
 * 检测是否被重定向到登录页
 */
export function looksLikeLoginPage(html: string): boolean {
    // 如果页面很大（超过50KB），基本上不是纯登录页面
    if (html.length > 50000) {
        return false
    }

    // 检测真正的登录页面特征（表单相关的，不是导航栏按钮）
    const loginFormIndicators = [
        'id="login_form"',
        'action="/login"',
        'auth0-lock',  // CAPCOM使用的登录组件
        'id="email"',
        'id="password"',
        'input[type="email"]',
        'input[type="password"]',
    ]

    let loginFormCount = 0
    for (const indicator of loginFormIndicators) {
        if (html.includes(indicator)) {
            loginFormCount++
        }
    }

    // 如果有多个登录表单特征，很可能是登录页面
    if (loginFormCount >= 2) {
        return true
    }

    // 检查是否缺少预期的玩家数据内容
    const hasPlayerContent = html.includes('fighter_id') ||
        html.includes('player_name') ||
        html.includes('profile_inner') ||
        html.includes('list_fighter') ||  // 搜索结果特有
        html.includes('list_inner')        // 搜索结果特有

    // 如果页面很短且没有玩家内容，可能是重定向
    if (html.length < 5000 && !hasPlayerContent) {
        return true
    }

    return false
}
