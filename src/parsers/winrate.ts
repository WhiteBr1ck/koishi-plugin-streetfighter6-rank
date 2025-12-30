import { WinRateData } from '../types'
import { PluginState } from '../state'
import { playUrl } from '../services/http'

/**
 * 解析胜率页面
 */
export function parseWinRateData(state: PluginState, html: string, playerId: string): WinRateData {
    const url = playUrl(state, playerId)

    // 提取玩家名称（复用之前的逻辑）
    let playerName: string | undefined
    const statusNameMatch = html.match(/<span class="status_name__[^"]*">([^<]+)<\/span>/)
    if (statusNameMatch && statusNameMatch[1]) {
        playerName = statusNameMatch[1].trim()
        state.debugLog(`提取到玩家名称: ${playerName}`)
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
        state.debugLog(`方法1提取胜率数据: ${totalWins}胜/${totalBattles}战 = ${winRate}%`)
    } else {
        // 方法2: 更宽松的匹配 - 包含HTML注释
        const winsMatch = html.match(/(\d+)胜(?:<!--[^>]*-->)*\/?(?:<!--[^>]*-->)*对战：(\d+)/)
        const rateMatch = html.match(/<span>([0-9.]+)<\/span>%/)

        if (winsMatch && rateMatch) {
            totalWins = parseInt(winsMatch[1])
            totalBattles = parseInt(winsMatch[2])
            winRate = parseFloat(rateMatch[1])
            state.debugLog(`方法2提取胜率数据: ${totalWins}胜/${totalBattles}战 = ${winRate}%`)
        } else {
            state.warnLog('无法提取胜率数据')
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

/**
 * 格式化胜率数据输出
 */
export function formatWinRateData(data: WinRateData): string {
    const parts: string[] = []
    const playerInfo = data.playerName ? `${data.playerName} (ID: ${data.playerId})` : data.playerId
    parts.push(`玩家：${playerInfo}`)
    parts.push(`总战绩：${data.totalWins}胜/${data.totalBattles}战`)
    parts.push(`总胜率：${data.winRate.toFixed(2)}%`)
    parts.push(`详情：${data.url}`)
    return parts.join('\n')
}
