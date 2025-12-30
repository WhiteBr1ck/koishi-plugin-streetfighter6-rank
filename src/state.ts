import { Context } from 'koishi'
import { Config } from './config'
import { RankData, WinRateData, PlayerSearchResult } from './types'
import { SimpleCache } from './utils/cache'
import { createLogFunctions, LogFunctions } from './utils/logger'

// 常量
export const CACHE_TTL = 600 // 缓存时间 600 秒
export const HTTP_TIMEOUT = 15000 // HTTP 超时 15 秒
export const COOLDOWN_SEC = 5 // 冷却时间 5 秒
export const SHOW_WAITING_MESSAGE = true // 显示等待消息
export const LOGIN_RETRY_INTERVAL = 300000 // 5分钟重试间隔

/**
 * 插件共享状态类
 * 管理所有运行时状态、缓存和配置
 */
export class PluginState implements LogFunctions {
    // Koishi 上下文和配置
    ctx: Context
    config: Config

    // 运行时状态
    runtimeCookie: string = ''
    loginInProgress: boolean = false
    lastLoginAttempt: number = 0

    // 缓存实例
    rankCache: SimpleCache<RankData>
    screenshotCache: SimpleCache<Buffer>
    winRateCache: SimpleCache<WinRateData>
    winRateScreenshotCache: SimpleCache<Buffer>
    leaguePointScreenshotCache: SimpleCache<Buffer>
    battlelogScreenshotCache: SimpleCache<Buffer>
    playerSearchCache: SimpleCache<PlayerSearchResult[]>
    playerSearchScreenshotCache: SimpleCache<Buffer>

    // 冷却管理
    cooldownMap: Map<string, number> = new Map()

    // 日志函数
    debugLog: (message: string, ...args: any[]) => void
    infoLog: (message: string, ...args: any[]) => void
    warnLog: (message: string, ...args: any[]) => void

    constructor(ctx: Context, config: Config) {
        this.ctx = ctx
        this.config = config

        // 初始化 Cookie
        this.runtimeCookie = (process.env.SF6_COOKIE || '').trim()

        // 初始化缓存
        this.rankCache = new SimpleCache<RankData>(CACHE_TTL)
        this.screenshotCache = new SimpleCache<Buffer>(CACHE_TTL)
        this.winRateCache = new SimpleCache<WinRateData>(CACHE_TTL)
        this.winRateScreenshotCache = new SimpleCache<Buffer>(CACHE_TTL)
        this.leaguePointScreenshotCache = new SimpleCache<Buffer>(CACHE_TTL)
        this.battlelogScreenshotCache = new SimpleCache<Buffer>(CACHE_TTL)
        this.playerSearchCache = new SimpleCache<PlayerSearchResult[]>(CACHE_TTL)
        this.playerSearchScreenshotCache = new SimpleCache<Buffer>(CACHE_TTL)

        // 初始化日志函数
        // 默认启用调试日志，实际输出由 Koishi 日志级别控制
        const logFunctions = createLogFunctions(true)
        this.debugLog = logFunctions.debugLog
        this.infoLog = logFunctions.infoLog
        this.warnLog = logFunctions.warnLog
    }

    /**
     * 清理所有缓存
     */
    clearAllCaches() {
        this.rankCache.clear()
        this.screenshotCache.clear()
        this.winRateCache.clear()
        this.winRateScreenshotCache.clear()
        this.leaguePointScreenshotCache.clear()
        this.battlelogScreenshotCache.clear()
        this.playerSearchCache.clear()
        this.playerSearchScreenshotCache.clear()
        this.cooldownMap.clear()
    }
}
