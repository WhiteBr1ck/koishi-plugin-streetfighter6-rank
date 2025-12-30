import { RankData } from '../types'
import { PluginState } from '../state'
import { profileUrl } from '../services/http'

/**
 * 解析排位积分页面
 */
export function parseRankData(state: PluginState, html: string, playerId: string): RankData {
    const url = profileUrl(state, playerId)

    // 提取玩家名称 - 从特定的HTML元素中提取
    let playerName: string | undefined

    // 方法1: 从status_name元素中提取（最准确的方法）
    const statusNameMatch = html.match(/<span class="status_name__[^"]*">([^<]+)<\/span>/)
    if (statusNameMatch && statusNameMatch[1]) {
        playerName = statusNameMatch[1].trim()
        state.debugLog(`方法1(status_name)提取到玩家名称: ${playerName}`)
    }

    // 方法2: 如果方法1失败，尝试更宽松的class匹配
    if (!playerName) {
        const nameClassMatch = html.match(/<span class="[^"]*name[^"]*">([^<]+)<\/span>/)
        if (nameClassMatch && nameClassMatch[1]) {
            const candidate = nameClassMatch[1].trim()
            // 确保不是系统词汇
            if (!/^(设置|账号|简介|格斗|排位|退出|登录|资料|CFN|CAPCOM|STREET|FIGHTER|UTC|电竞|支持|包括|服务|独有|ZH-HANS)$/i.test(candidate)) {
                playerName = candidate
                state.debugLog(`方法2(name_class)提取到玩家名称: ${playerName}`)
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
                        state.debugLog(`方法3(文本解析)提取到玩家名称: ${playerName}`)
                        break
                    }
                }
            }
        }
    }

    state.debugLog(`最终提取的玩家名称: ${playerName || '未找到'}`)

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
        playerName,
        character,
        rankName,
        rankPoints,
        fightingPoints,
        title,
        url
    }
}

/**
 * 格式化排位数据输出
 */
export function formatRankData(data: RankData): string {
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
