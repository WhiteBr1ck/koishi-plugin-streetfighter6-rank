import { PluginState, COOLDOWN_SEC } from '../state'

/**
 * 获取用户绑定的玩家ID
 */
export async function getUserPlayerId(state: PluginState, userId: string): Promise<string | null> {
    try {
        const bindings = await state.ctx.database.get('streetfighter6_binding', { userId })
        return bindings.length > 0 ? bindings[0].playerId : null
    } catch (e) {
        state.warnLog('获取用户绑定ID失败:', e)
        return null
    }
}

/**
 * 设置用户绑定的玩家ID
 */
export async function setUserPlayerId(state: PluginState, userId: string, playerId: string): Promise<boolean> {
    try {
        const existing = await state.ctx.database.get('streetfighter6_binding', { userId })
        if (existing.length > 0) {
            await state.ctx.database.set('streetfighter6_binding', { userId }, { playerId })
        } else {
            await state.ctx.database.create('streetfighter6_binding', { userId, playerId })
        }
        state.infoLog(`成功设置用户 ${userId} 的玩家ID: ${playerId}`)
        return true
    } catch (e) {
        state.warnLog('设置用户绑定ID失败:', e)
        return false
    }
}

/**
 * 删除用户绑定的玩家ID
 */
export async function removeUserPlayerId(state: PluginState, userId: string): Promise<boolean> {
    try {
        await state.ctx.database.remove('streetfighter6_binding', { userId })
        state.infoLog(`成功移除用户 ${userId} 的玩家ID绑定`)
        return true
    } catch (e) {
        state.warnLog('移除用户绑定ID失败:', e)
        return false
    }
}

/**
 * 解析查询参数（支持@用户或直接输入玩家ID）
 */
export async function parseQueryParam(
    state: PluginState,
    session: any,
    param?: string
): Promise<{ playerId: string | null; targetInfo: string }> {
    state.debugLog(`解析查询参数: ${param}`)

    if (!param || param.trim() === '') {
        // 没有参数，使用当前用户的绑定ID
        const playerId = await getUserPlayerId(state, session.userId)
        return {
            playerId,
            targetInfo: playerId ? '（使用已绑定ID）' : ''
        }
    }

    const trimmedParam = param.trim()

    // 检查是否是@用户格式
    if (session.elements && session.elements.length > 0) {
        // 查找@元素
        const atElement = session.elements.find((el: any) => el.type === 'at')
        if (atElement && atElement.attrs?.id) {
            const targetUserId = atElement.attrs.id
            state.debugLog(`找到@用户: ${targetUserId}`)

            const playerId = await getUserPlayerId(state, targetUserId)
            return {
                playerId,
                targetInfo: playerId ? `（查询用户 <@${targetUserId}> 的数据）` : ''
            }
        }
    }

    // 检查是否是纯数字ID格式
    if (/^\d{5,}$/.test(trimmedParam)) {
        return {
            playerId: trimmedParam,
            targetInfo: ''
        }
    }

    // 其他情况认为是无效参数
    return {
        playerId: null,
        targetInfo: ''
    }
}

/**
 * 检查是否在冷却中
 */
export function inCooldown(state: PluginState, key: string): boolean {
    const last = state.cooldownMap.get(key) || 0
    const now = Date.now()
    if (now - last < COOLDOWN_SEC * 1000) return true
    state.cooldownMap.set(key, now)
    return false
}
