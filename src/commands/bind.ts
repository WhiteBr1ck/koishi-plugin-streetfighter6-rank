import { Context } from 'koishi'
import { PluginState } from '../state'
import { setUserPlayerId, removeUserPlayerId } from '../binding/player'

/**
 * 注册绑定相关命令
 */
export function registerBindCommands(ctx: Context, state: PluginState) {
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
                state.infoLog(`开始绑定ID操作，用户: ${session!.userId}, 参数: ${playerId}`)

                const success = await setUserPlayerId(state, session!.userId, id)
                if (success) {
                    return `已绑定玩家ID：${id}\n之后可直接使用：玩家查询 / 胜率查询 / 战斗记录`
                } else {
                    return '绑定失败，请稍后重试。'
                }
            } catch (e: any) {
                state.warnLog('绑定ID操作失败:', e)
                return `绑定失败：${e?.message || '未知错误'}`
            }
        })

    // 解绑ID
    ctx.command('解绑ID', '清除已绑定的 SF6 玩家ID')
        .action(async ({ session }) => {
            try {
                state.infoLog(`开始解绑ID操作，用户: ${session!.userId}`)

                const success = await removeUserPlayerId(state, session!.userId)
                if (success) {
                    return '已清除绑定的玩家ID。'
                } else {
                    return '解绑失败，请稍后重试。'
                }
            } catch (e: any) {
                state.warnLog('解绑ID操作失败:', e)
                return `解绑失败：${e?.message || '未知错误'}`
            }
        })
}
