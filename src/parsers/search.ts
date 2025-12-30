import { PlayerSearchResult } from '../types'
import { PluginState } from '../state'

/**
 * 解析玩家搜索结果页面
 */
export function parsePlayerSearchResults(state: PluginState, html: string): PlayerSearchResult[] {
    const results: PlayerSearchResult[] = []

    state.debugLog('开始解析搜索结果页面...')
    state.debugLog(`HTML长度: ${html.length}`)

    // 方法1: 匹配 list_fighter_list 容器内的每个 li 元素
    const fighterListRegex = /<ul class="list_fighter_list__[^"]*"[^>]*>([\s\S]*?)<\/ul>/
    const listMatch = fighterListRegex.exec(html)

    if (listMatch) {
        state.debugLog('找到 list_fighter_list 容器')
        const listContent = listMatch[1]
        state.debugLog(`list内容长度: ${listContent.length}`)

        // 匹配每个 li 项目 - 使用全局匹配
        const liRegex = /<li[^>]*>[\s\S]*?<\/li>/g
        const liMatches = listContent.match(liRegex) || []
        state.debugLog(`找到 ${liMatches.length} 个 li 元素`)

        for (let i = 0; i < liMatches.length; i++) {
            const liContent = liMatches[i]
            state.debugLog(`处理第 ${i + 1} 个 li 元素`)

            // 跳过非玩家项目的li（比如表头、分隔符等）
            if (liContent.includes('list_lp__') || liContent.includes('---积分') || liContent.includes('class="list_lp')) {
                state.debugLog(`第 ${i + 1} 个li是非玩家项目，跳过`)
                continue
            }

            // 提取相对路径的profile URL和玩家ID
            const hrefMatch = liContent.match(/href="(\/6\/buckler\/[^\/]+\/profile\/(\d+))"/)
            if (!hrefMatch) {
                state.debugLog(`第 ${i + 1} 个li未找到 profile 链接`)
                state.debugLog(`li内容片段: ${liContent.substring(0, 300)}`)
                continue
            }

            const relativePath = hrefMatch[1]
            const playerId = hrefMatch[2]
            // 修正URL拼接 - config.baseUrl已经包含了主域名，所以直接拼接相对路径
            const fullUrl = `https://www.streetfighter.com${relativePath}`
            state.debugLog(`第 ${i + 1} 个li找到玩家ID: ${playerId}`)
            state.debugLog(`第 ${i + 1} 个li相对路径: ${relativePath}`)
            state.debugLog(`第 ${i + 1} 个li完整URL: ${fullUrl}`)

            // 提取玩家名称
            const nameMatch = liContent.match(/<span class="list_name__[^"]*">([^<]+)<\/span>/)
            if (!nameMatch) {
                state.debugLog(`第 ${i + 1} 个li未找到玩家名称`)
                continue
            }

            const playerName = nameMatch[1].trim()
            state.debugLog(`第 ${i + 1} 个li找到玩家名称: ${playerName}`)

            if (playerId && playerName && !results.find(r => r.playerId === playerId)) {
                results.push({
                    playerId,
                    playerName,
                    url: fullUrl  // 直接使用完整URL
                })
                state.debugLog(`第 ${i + 1} 个li成功解析: ${playerName} (ID: ${playerId})`)
            }
        }
    } else {
        state.debugLog('未找到 list_fighter_list 容器')
    }

    // 方法2: 直接匹配整个HTML中的 profile 链接和玩家名称（更可靠）
    state.debugLog('使用方法2：直接匹配整个HTML...')

    // 先找到所有的相对路径 profile 链接 - 扩展正则以捕获更多可能的链接格式
    const profileRegexes = [
        /href="(\/6\/buckler\/[^\/]+\/profile\/(\d+))"/g,  // 标准格式
        /href="([^"]*\/profile\/(\d+)[^"]*)"/g,           // 更宽松的格式
    ]

    const profileMatches: { relativePath: string; playerId: string; fullUrl: string }[] = []

    for (const profileRegex of profileRegexes) {
        profileRegex.lastIndex = 0 // 重置正则状态
        let profileMatch
        while ((profileMatch = profileRegex.exec(html)) !== null) {
            const fullPath = profileMatch[1]
            const playerId = profileMatch[2]

            // 避免重复添加相同的玩家ID
            if (!profileMatches.find(p => p.playerId === playerId)) {
                const fullUrl = fullPath.startsWith('http') ? fullPath : `https://www.streetfighter.com${fullPath}`
                profileMatches.push({
                    relativePath: fullPath,
                    playerId: playerId,
                    fullUrl: fullUrl
                })
            }
        }
    }

    state.debugLog(`找到 ${profileMatches.length} 个 profile 链接`)

    // 然后找到所有的玩家名称
    const nameRegex = /<span class="list_name__[^"]*">([^<]+)<\/span>/g
    const nameMatches: string[] = []
    let nameMatch

    while ((nameMatch = nameRegex.exec(html)) !== null) {
        nameMatches.push(nameMatch[1].trim())
    }

    state.debugLog(`找到 ${nameMatches.length} 个玩家名称: ${nameMatches.join(', ')}`)

    // 假设链接和名称的顺序是对应的
    const minLength = Math.min(profileMatches.length, nameMatches.length)
    for (let i = 0; i < minLength; i++) {
        const profile = profileMatches[i]
        const playerName = nameMatches[i]

        if (!results.find(r => r.playerId === profile.playerId)) {
            results.push({
                playerId: profile.playerId,
                playerName: playerName,
                url: profile.fullUrl  // 使用拼接后的完整URL
            })
            state.debugLog(`配对成功: ${playerName} (ID: ${profile.playerId})`)
        }
    }

    state.debugLog(`搜索结果解析完成，共找到 ${results.length} 个玩家`)
    return results
}
