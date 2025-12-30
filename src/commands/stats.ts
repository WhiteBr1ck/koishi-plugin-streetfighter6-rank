import { Context, h } from 'koishi'
import { PluginState, COOLDOWN_SEC, SHOW_WAITING_MESSAGE } from '../state'
import { parseQueryParam, inCooldown } from '../binding/player'
import { ensureValidCookie } from '../services/auth'
import { takeLeaguePointScreenshot } from '../api/rank'
import { getWinRateDataById, takeWinRateScreenshot, formatWinRateData } from '../api/winrate'
import { takeBattlelogScreenshot } from '../api/battlelog'

/**
 * 注册统计相关命令
 */
export function registerStatsCommands(ctx: Context, state: PluginState) {
    // 排位查询命令（仅截图LP区域）
    ctx.command('排位查询 [param:text]', '查询 SF6 排位LP信息（仅截图）')
        .example('排位查询 1234567890')
        .example('排位查询 @用户')
        .action(async ({ session }, param) => {
            const { playerId: id, targetInfo } = await parseQueryParam(state, session, param)

            if (!id) {
                if (param && param.trim()) {
                    if (session.elements?.some((el: any) => el.type === 'at')) {
                        return '该用户还未绑定街霸6玩家ID。请提醒其使用：绑定ID <玩家ID>'
                    } else {
                        return '参数格式错误。请使用：排位查询 <玩家ID> 或 排位查询 @用户'
                    }
                } else {
                    return '未绑定玩家ID。请先使用：绑定ID <玩家ID>'
                }
            }
            if (!/^\d{5,}$/.test(id)) return '玩家ID格式错误，应该是5位以上的数字。'

            const userId = session?.userId || 'unknown'
            const cooldownKey = `ranklp:${userId}:${id}`
            if (inCooldown(state, cooldownKey)) {
                return `查询太频繁，请稍后再试。（冷却时间：${COOLDOWN_SEC}秒）`
            }

            if (!state.config.enableScreenshotOutput) {
                return '错误：截图输出已禁用，请在配置中启用。'
            }

            // 自动登录检查
            if (!await ensureValidCookie(state)) {
                if (state.config.capcomEmail && state.config.capcomPassword) {
                    return '自动登录失败，请检查配置或稍后重试。您也可以尝试手动运行 `SF6登录`。';
                } else {
                    return '需要有效登录 Cookie。请先在配置中设置 Cookie 或 CAPCOM 账号信息。';
                }
            }

            try {
                // 显示等待消息
                let waitingMessageId: string | undefined
                if (SHOW_WAITING_MESSAGE) {
                    try {
                        const waiting = await session?.send(`🔍 正在查询排位积分，请稍候...${targetInfo}`)
                        if (waiting && Array.isArray(waiting) && waiting[0]) {
                            waitingMessageId = waiting[0]
                        }
                    } catch { }
                }

                try {
                    const screenshot = await takeLeaguePointScreenshot(state, id)
                    // 撤回等待
                    if (waitingMessageId && session?.bot?.deleteMessage) {
                        try { await session.bot.deleteMessage(session.channelId, waitingMessageId) } catch { }
                    }
                    await session?.send('排位信息：')
                    await session?.send(h.image(screenshot, 'image/png'))
                    return null
                } catch (e: any) {
                    if (waitingMessageId && session?.bot?.deleteMessage) {
                        try { await session.bot.deleteMessage(session.channelId, waitingMessageId) } catch { }
                    }
                    state.warnLog('排位LP截图失败:', e)
                    if (String(e?.message).includes('登录')) {
                        return '查询失败：需要登录权限。请检查Cookie设置。'
                    }
                    if (String(e?.message).includes('Cookie')) {
                        return '排位查询失败：需要有效登录 Cookie。请检查配置中的Cookie设置。'
                    }
                    if (String(e?.message).includes('puppeteer')) {
                        return '截图功能不可用：需要安装 puppeteer 插件。'
                    }
                    return `排位查询失败：${e?.message || '未知错误'}`
                }
            } catch (e: any) {
                state.warnLog('排位查询整体失败:', e)
                return `排位查询失败：${e?.message || '未知错误'}`
            }
        })

    // 胜率查询命令
    ctx.command('胜率查询 [param:text]', '查询 SF6 胜率信息')
        .example('胜率查询 1234567890')
        .example('胜率查询 @用户')
        .action(async ({ session }, param) => {
            // 使用新的参数解析函数
            const { playerId: id, targetInfo } = await parseQueryParam(state, session, param)

            if (!id) {
                if (param && param.trim()) {
                    // 有参数但解析失败
                    if (session.elements?.some((el: any) => el.type === 'at')) {
                        return '该用户还未绑定街霸6玩家ID。请提醒其使用：绑定ID <玩家ID>'
                    } else {
                        return '参数格式错误。请使用：胜率查询 <玩家ID> 或 胜率查询 @用户'
                    }
                } else {
                    // 没有参数且当前用户也没绑定
                    return '未绑定玩家ID。请先使用：绑定ID <玩家ID>'
                }
            }
            if (!/^\d{5,}$/.test(id)) return '玩家ID格式错误，应该是5位以上的数字。'

            const userId = session?.userId || 'unknown'
            const cooldownKey = `winrate:${userId}:${id}`

            if (inCooldown(state, cooldownKey)) {
                return `查询太频繁，请稍后再试。（冷却时间：${COOLDOWN_SEC}秒）`
            }

            // 自动登录检查
            if (!await ensureValidCookie(state)) {
                if (state.config.capcomEmail && state.config.capcomPassword) {
                    return '自动登录失败，请检查配置或稍后重试。您也可以尝试手动运行 `SF6登录`。';
                } else {
                    return '需要有效登录 Cookie。请先在配置中设置 Cookie 或 CAPCOM 账号信息。';
                }
            }

            try {
                state.infoLog(`开始查询胜率: ${id}`)

                // 显示等待消息
                let waitingMessageId: string | undefined
                if (SHOW_WAITING_MESSAGE) {
                    const waitingMessage = await session?.send(`🔍 正在查询胜率信息，请稍候...${targetInfo}`)
                    if (waitingMessage && Array.isArray(waitingMessage) && waitingMessage[0]) {
                        waitingMessageId = waitingMessage[0]
                        state.debugLog(`显示等待消息: ${waitingMessageId}`)
                    }
                }

                let textOutput = ''
                let screenshotBuffer: Buffer | undefined

                // 分别处理文本和截图，避免一个失败影响另一个
                const results: { text?: any; screenshot?: Buffer; errors: string[] } = { errors: [] }

                // 处理文本输出
                if (state.config.enableTextOutput) {
                    state.debugLog('启用文本输出，开始获取胜率数据')
                    try {
                        const data = await getWinRateDataById(state, id)
                        results.text = data
                        textOutput = formatWinRateData(data)
                        state.debugLog(`胜率文本信息已准备`)
                    } catch (e: any) {
                        state.warnLog('胜率文本获取失败:', e)
                        results.errors.push(`文本获取失败: ${e?.message || '未知错误'}`)
                    }
                }

                // 处理截图输出
                if (state.config.enableScreenshotOutput) {
                    state.debugLog('启用截图输出，开始截图')
                    try {
                        screenshotBuffer = await takeWinRateScreenshot(state, id)
                        results.screenshot = screenshotBuffer
                        state.debugLog(`胜率截图已准备`)
                    } catch (e: any) {
                        state.warnLog('胜率截图获取失败:', e)
                        results.errors.push(`截图获取失败: ${e?.message || '未知错误'}`)
                    }
                }

                state.infoLog(`胜率查询完成`)

                // 撤回等待消息
                if (waitingMessageId && session?.bot?.deleteMessage) {
                    try {
                        await session.bot.deleteMessage(session.channelId, waitingMessageId)
                        state.debugLog(`撤回等待消息: ${waitingMessageId}`)
                    } catch (e) {
                        state.debugLog(`撤回等待消息失败: ${e}`)
                    }
                }

                // 发送结果 - 分别发送，避免一个失败影响另一个
                const responses: string[] = []

                if (textOutput) {
                    try {
                        await session?.send(textOutput)
                        responses.push('文本信息发送成功')
                    } catch (e) {
                        state.warnLog('文本信息发送失败:', e)
                        responses.push('文本信息发送失败')
                    }
                }

                if (screenshotBuffer) {
                    try {
                        await session?.send(`📸 胜率详情截图：`)
                        await session?.send(h.image(screenshotBuffer, 'image/png'))
                        responses.push('截图发送成功')
                    } catch (e) {
                        state.warnLog('截图发送失败:', e)
                        responses.push('截图发送失败')
                    }
                }

                if (responses.length === 0) {
                    if (results.errors.length > 0) {
                        return `查询失败，原因如下：\n- ${results.errors.join('\n- ')}`;
                    } else {
                        return '查询完成但没有可显示的内容';
                    }
                }

                // 如果只有部分失败，在日志中记录
                if (results.errors.length > 0) {
                    state.warnLog(`部分查询功能失败: ${results.errors.join(', ')}`);
                }

                return null // 已经分别发送了，不需要return

            } catch (e: any) {
                state.warnLog('胜率查询失败:', e)

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
    ctx.command('战斗记录 [param:text]', '查询 SF6 战斗记录')
        .example('战斗记录 1234567890')
        .example('战斗记录 @用户')
        .action(async ({ session }, param) => {
            // 使用新的参数解析函数
            const { playerId: id, targetInfo } = await parseQueryParam(state, session, param)

            if (!id) {
                if (param && param.trim()) {
                    // 有参数但解析失败
                    if (session.elements?.some((el: any) => el.type === 'at')) {
                        return '该用户还未绑定街霸6玩家ID。请提醒其使用：绑定ID <玩家ID>'
                    } else {
                        return '参数格式错误。请使用：战斗记录 <玩家ID> 或 战斗记录 @用户'
                    }
                } else {
                    // 没有参数且当前用户也没绑定
                    return '未绑定玩家ID。请先使用：绑定ID <玩家ID>'
                }
            }
            if (!/^\d{5,}$/.test(id)) return '玩家ID格式错误，应该是5位以上的数字。'

            const userId = session?.userId || 'unknown'
            const cooldownKey = `battlelog:${userId}:${id}`

            if (inCooldown(state, cooldownKey)) {
                return `查询太频繁，请稍后再试。（冷却时间：${COOLDOWN_SEC}秒）`
            }

            // 自动登录检查
            if (!await ensureValidCookie(state)) {
                if (state.config.capcomEmail && state.config.capcomPassword) {
                    return '自动登录失败，请检查配置或稍后重试。您也可以尝试手动运行 `SF6登录`。';
                } else {
                    return '需要有效登录 Cookie。请先在配置中设置 Cookie 或 CAPCOM 账号信息。';
                }
            }

            try {
                state.infoLog(`开始查询战斗记录: ${id}`)

                // 显示等待消息
                let waitingMessageId: string | undefined
                if (SHOW_WAITING_MESSAGE) {
                    const waitingMessage = await session?.send(`🔍 正在查询战斗记录，请稍候...${targetInfo}`)
                    if (waitingMessage && Array.isArray(waitingMessage) && waitingMessage[0]) {
                        waitingMessageId = waitingMessage[0]
                        state.debugLog(`显示等待消息: ${waitingMessageId}`)
                    }
                }

                let screenshotBuffer: Buffer | undefined
                let errorMessage = ''

                // 处理截图
                try {
                    state.debugLog('开始获取战斗记录截图')
                    screenshotBuffer = await takeBattlelogScreenshot(state, id)
                    state.debugLog('战斗记录截图已准备')
                } catch (e: any) {
                    state.warnLog('战斗记录截图获取失败:', e)
                    errorMessage = `截图获取失败: ${e?.message || '未知错误'}`
                }

                state.infoLog(`战斗记录查询完成`)

                // 撤回等待消息
                if (waitingMessageId && session?.bot?.deleteMessage) {
                    try {
                        await session.bot.deleteMessage(session.channelId, waitingMessageId)
                        state.debugLog(`撤回等待消息: ${waitingMessageId}`)
                    } catch (e) {
                        state.debugLog(`撤回等待消息失败: ${e}`)
                    }
                }

                // 发送结果
                if (screenshotBuffer) {
                    try {
                        await session?.send(`📸 战斗记录截图：`)
                        await session?.send(h.image(screenshotBuffer, 'image/png'))
                        return null // 成功发送截图
                    } catch (e) {
                        state.warnLog('截图发送失败:', e)
                        return '截图发送失败'
                    }
                } else {
                    return errorMessage || '查询失败，无法获取战斗记录截图'
                }

            } catch (e: any) {
                state.warnLog('战斗记录查询失败:', e)

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
}
