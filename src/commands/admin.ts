import { Context } from 'koishi'
import { PluginState } from '../state'
import { performAutoLogin } from '../services/auth'
import { redactCookie } from '../utils/helpers'

/**
 * 注册管理命令
 */
export function registerAdminCommands(ctx: Context, state: PluginState) {
    // 手动登录命令
    ctx.command('SF6登录', '尝试使用CAPCOM ID账号密码自动登录')
        .action(async ({ session }) => {
            if (!state.config.capcomEmail || !state.config.capcomPassword) {
                return '请先在插件配置中设置CAPCOM ID邮箱和密码'
            }

            if (state.loginInProgress) {
                return '登录正在进行中，请稍后再试'
            }

            try {
                state.infoLog(`用户 ${session?.userId} 手动触发登录`)
                const waiting = await session?.send('🔄 正在尝试登录CAPCOM ID，请稍候...')

                const newCookie = await performAutoLogin(state, true)

                // 撤回等待消息
                if (waiting && Array.isArray(waiting) && waiting[0] && session?.bot?.deleteMessage) {
                    try {
                        await session.bot.deleteMessage(session.channelId, waiting[0])
                    } catch (e) {
                        state.debugLog('撤回等待消息失败:', e)
                    }
                }

                if (newCookie) {
                    state.setRuntimeCookie(newCookie, 'auto')
                    state.lastLoginSuccess = Date.now()
                    state.lastCookieValidation = Date.now()
                    return '✅ 登录成功，已获取新的Cookie'
                } else {
                    return '❌ 自动登录未取得有效会话。CAPCOM 登录可能被 Cloudflare 安全验证拦截，请改用手动 Cookie。'
                }
            } catch (e: any) {
                state.warnLog('手动登录失败:', e)
                return `登录失败：${e?.message || '未知错误'}`
            }
        })

    // 检查登录状态
    ctx.command('SF6状态', '检查当前登录状态')
        .action(async ({ session }) => {
            const status: string[] = []

            // Cookie状态
            if (state.runtimeCookie) {
                const sourceLabels = {
                    config: '插件配置',
                    environment: '环境变量',
                    auto: '自动登录',
                    none: '未知',
                }
                const validationStatus = state.lastCookieValidation ? '已验证' : '待首次验证'
                const icon = state.lastCookieValidation ? '✅' : '⚠️'
                status.push(`${icon} Cookie状态：已设置，${validationStatus}，来源：${sourceLabels[state.runtimeCookieSource]} (${redactCookie(state.runtimeCookie)})`)
            } else {
                status.push('❌ Cookie状态：未设置')
            }

            // 自动登录配置状态
            if (state.config.capcomEmail && state.config.capcomPassword) {
                status.push(`⚠️ 自动登录：已配置但属于实验性功能，可能被 Cloudflare 拦截 (${state.config.capcomEmail.replace(/^(.{3}).*(@.*)$/, '$1***$2')})`)
            } else {
                status.push('❌ 自动登录：未配置')
            }

            // 登录状态
            if (state.loginInProgress) {
                status.push('🔄 登录状态：登录中')
            } else if (state.lastLoginSuccess) {
                const timeSinceLogin = Math.floor((Date.now() - state.lastLoginSuccess) / 60000)
                status.push(`✅ 上次登录成功：${timeSinceLogin}分钟前`)
            } else if (state.lastLoginAttempt) {
                const timeSinceAttempt = Math.floor((Date.now() - state.lastLoginAttempt) / 60000)
                status.push(`⚠️ 上次仅尝试登录：${timeSinceAttempt}分钟前，尚无成功记录`)
            } else {
                status.push('⭕ 登录状态：未登录')
            }

            // Puppeteer服务状态
            if (state.ctx.puppeteer) {
                status.push('✅ Puppeteer：可用')
            } else {
                status.push('❌ Puppeteer：不可用 (需要安装 koishi-plugin-puppeteer)')
            }

            return `🔍 Street Fighter 6 插件状态：\n\n${status.join('\n')}`
        })

    // 清除Cookie
    ctx.command('SF6清除', '清除当前Cookie')
        .action(async ({ session }) => {
            state.invalidateRuntimeCookie()
            state.lastLoginAttempt = 0
            state.lastLoginSuccess = 0
            state.infoLog(`用户 ${session?.userId} 手动清除Cookie`)
            return '✅ 已清除当前运行时 Cookie。若使用插件配置 Cookie，请重载插件后重新读取配置。'
        })
}
