import { Context, h } from 'koishi'
import { PluginState, COOLDOWN_SEC, SHOW_WAITING_MESSAGE } from '../state'
import { inCooldown } from '../binding/player'
import { ensureValidCookie } from '../services/auth'
import { getPlayerSearchData, takePlayerSearchScreenshot } from '../api/search'

/**
 * 注册玩家搜索命令
 */
export function registerSearchCommands(ctx: Context, state: PluginState) {
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
                state.infoLog(`开始搜索玩家: ${name}`)

                // 显示等待消息
                let waitingMessageId: string | undefined
                if (SHOW_WAITING_MESSAGE) {
                    const waitingMessage = await session?.send(`🔍 正在搜索玩家 "${name}"，请稍候...`)
                    if (waitingMessage && Array.isArray(waitingMessage) && waitingMessage[0]) {
                        waitingMessageId = waitingMessage[0]
                        state.debugLog(`显示等待消息: ${waitingMessageId}`)
                    }
                }

                // 分别处理文本和截图，避免一个失败影响另一个
                const results: { text?: any[]; screenshot?: Buffer; errors: string[] } = { errors: [] }

                // 处理文本输出
                if (state.config.enableTextOutput) {
                    try {
                        state.debugLog('开始获取搜索结果数据')
                        results.text = await getPlayerSearchData(state, name)
                        state.debugLog(`搜索结果数据已准备，共 ${results.text.length} 个结果`)
                    } catch (e: any) {
                        state.warnLog('搜索结果获取失败:', e)
                        results.errors.push(`文本查询失败: ${e?.message || '未知错误'}`)
                    }
                }

                // 处理截图输出
                if (state.config.enableScreenshotOutput) {
                    try {
                        state.debugLog('开始获取搜索结果截图')
                        results.screenshot = await takePlayerSearchScreenshot(state, name)
                        state.debugLog('搜索结果截图已准备')
                    } catch (e: any) {
                        state.warnLog('搜索截图获取失败:', e)
                        results.errors.push(`截图获取失败: ${e?.message || '未知错误'}`)
                    }
                }

                state.infoLog(`玩家搜索完成`)

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

                if (results.text && results.text.length > 0) {
                    try {
                        if (state.config.enableForwardMessage && results.text.length > 1 && ['qq', 'onebot'].includes(session?.platform)) {
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
                        state.warnLog('文本发送失败:', e)
                        responses.push('文本发送失败')
                    }
                } else if (state.config.enableTextOutput && (!results.text || results.text.length === 0)) {
                    try {
                        await session?.send(`未找到名称包含 "${name}" 的玩家`)
                        responses.push('搜索结果为空')
                    } catch (e) {
                        state.warnLog('搜索结果发送失败:', e)
                    }
                }

                if (results.screenshot) {
                    try {
                        await session?.send(`📸 搜索结果截图：`)
                        await session?.send(h.image(results.screenshot, 'image/png'))
                        responses.push('截图')
                    } catch (e) {
                        state.warnLog('截图发送失败:', e)
                        responses.push('截图发送失败')
                    }
                }

                if (responses.length === 0) {
                    if (results.errors.length > 0) {
                        return `搜索失败，原因如下：\n- ${results.errors.join('\n- ')}`;
                    } else {
                        return '搜索完成但没有可显示的内容';
                    }
                }

                // 如果只有部分失败，在日志中记录
                if (results.errors.length > 0) {
                    state.warnLog(`部分查询功能失败: ${results.errors.join(', ')}`);
                }

                return null // 已经分别发送了，不需要return

            } catch (e: any) {
                state.warnLog('搜索失败:', e?.message)

                if (String(e?.message).includes('Cookie')) {
                    return '搜索失败：需要有效登录 Cookie。请检查配置中的Cookie设置。'
                }
                if (String(e?.message).includes('puppeteer')) {
                    return '截图功能不可用：需要安装 puppeteer 插件。'
                }
                return `搜索失败：${e?.message || '未知错误'}`
            }
        })
}
