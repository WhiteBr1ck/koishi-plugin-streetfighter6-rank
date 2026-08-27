import { Context, h } from 'koishi'
import { PluginState, COOLDOWN_SEC, SHOW_WAITING_MESSAGE } from '../state'
import { parseQueryParam, inCooldown } from '../binding/player'
import { ensureValidCookie } from '../services/auth'
import { getRankDataById, takeScreenshot, formatRankData } from '../api/rank'

/**
 * 注册玩家查询命令
 */
export function registerPlayerCommands(ctx: Context, state: PluginState) {
    // 主命令：玩家查询 [玩家ID或@用户]
    ctx.command('玩家查询 [param:text]', '查询 SF6 排位积分信息')
        .example('玩家查询 1234567890')
        .example('玩家查询 @用户')
        .action(async ({ session }, param) => {
            try {
                state.infoLog(`开始排位查询，用户: ${session?.userId}, 参数: ${param}`)

                // 使用新的参数解析函数
                const { playerId: id, targetInfo } = await parseQueryParam(state, session, param)
                state.infoLog(`最终使用的玩家ID: ${id}`)

                if (!id) {
                    if (param && param.trim()) {
                        // 有参数但解析失败
                        if (session.elements?.some((el: any) => el.type === 'at')) {
                            return '该用户还未绑定街霸6玩家ID。请提醒其使用：绑定ID <玩家ID>'
                        } else {
                            return '参数格式错误。请使用：玩家查询 <玩家ID> 或 玩家查询 @用户'
                        }
                    } else {
                        // 没有参数且当前用户也没绑定
                        return '未绑定玩家ID。请先使用：绑定ID <玩家ID>'
                    }
                }
                if (!/^\d{5,}$/.test(id)) {
                    state.warnLog(`排位查询失败：ID格式错误 - ${id}`)
                    return '玩家ID格式错误，应该是5位以上的数字。'
                }

                const cdKey = session?.channelId ? `c:${session.channelId}` : `u:${session?.userId ?? 'anon'}`
                if (inCooldown(state, cdKey)) return `请稍候再试（冷却 ${COOLDOWN_SEC}s）`

                // 自动登录检查
                if (!await ensureValidCookie(state)) {
                    if (state.config.capcomEmail && state.config.capcomPassword) {
                        return '没有可用的登录 Cookie。账号密码自动登录可能被 Cloudflare 拦截，请在插件配置中填写从已登录 Buckler 页面复制的 Cookie。';
                    } else {
                        return '需要有效登录 Cookie。请在插件配置中填写从已登录 Buckler 页面复制的 Cookie。';
                    }
                }

                // 检查是否启用了任何输出
                if (!state.config.enableTextOutput && !state.config.enableScreenshotOutput) {
                    return '错误：文本输出和截图输出都已禁用，请在配置中启用至少一项。'
                }

                state.infoLog(`开始查询玩家: ${id}`)

                // 显示等待消息
                let waitingMessageId: string | undefined
                if (SHOW_WAITING_MESSAGE && session) {
                    try {
                        const waitingMessage = await session.send(`🔍 正在查询玩家 ${id} 的排位信息，请稍候...${targetInfo}`)
                        if (Array.isArray(waitingMessage) && waitingMessage[0]) {
                            waitingMessageId = waitingMessage[0]
                        }
                        state.debugLog(`显示等待消息: ${waitingMessageId}`)
                    } catch (e) {
                        state.debugLog('发送等待消息失败:', e)
                    }
                }

                try {
                    // 分别处理文本和截图，避免一个失败影响另一个
                    const results: { text?: any; screenshot?: Buffer; errors: string[] } = { errors: [] }

                    // 处理文本输出
                    if (state.config.enableTextOutput) {
                        state.debugLog('启用文本输出，开始获取排位数据')
                        try {
                            const data = await getRankDataById(state, id)
                            results.text = data
                            state.debugLog(`排位文本信息已准备`)
                        } catch (e: any) {
                            state.warnLog('排位文本获取失败:', e)
                            results.errors.push(`文本获取失败: ${e?.message || '未知错误'}`)
                        }
                    }

                    // 处理截图输出
                    if (state.config.enableScreenshotOutput) {
                        state.debugLog('启用截图输出，开始截图')
                        try {
                            const screenshot = await takeScreenshot(state, id)
                            results.screenshot = screenshot
                            state.debugLog(`排位截图已准备`)
                        } catch (e: any) {
                            state.warnLog('排位截图获取失败:', e)
                            results.errors.push(`截图获取失败: ${e?.message || '未知错误'}`)
                        }
                    }

                    state.infoLog(`排位查询完成`)

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

                    if (results.text) {
                        try {
                            const textOutput = formatRankData(results.text)
                            await session?.send(textOutput)
                            responses.push('文本信息发送成功')
                        } catch (e) {
                            state.warnLog('文本信息发送失败:', e)
                            responses.push('文本信息发送失败')
                        }
                    }

                    if (results.screenshot) {
                        try {
                            await session?.send(`📸 详细信息截图：`)
                            await session?.send(h.image(results.screenshot, 'image/png'))
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
                    state.warnLog('查询失败:', e?.message)

                    // 撤回等待消息
                    if (waitingMessageId && session) {
                        try {
                            await session.bot.deleteMessage(session.channelId, waitingMessageId)
                            state.debugLog(`撤回等待消息: ${waitingMessageId}`)
                        } catch (e) {
                            state.debugLog('撤回等待消息失败:', e)
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
                state.warnLog('玩家查询整体失败:', e)
                return `玩家查询失败：${e?.message || '未知错误'}`
            }
        })
}
