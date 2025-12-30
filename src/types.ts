import { Context } from 'koishi'

// Koishi 模块声明扩展
declare module 'koishi' {
    interface Context {
        puppeteer: {
            page(): Promise<{
                setViewport(options: { width: number; height: number }): Promise<void>
                setUserAgent(userAgent: string): Promise<void>
                setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>
                goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<void>
                waitForSelector(selector: string, options?: { timeout?: number; visible?: boolean }): Promise<void>
                $(selector: string): Promise<{
                    screenshot(options: { type: 'png' }): Promise<Buffer>
                    click(options?: any): Promise<void>
                    evaluate<T>(fn: (el: any, ...args: any[]) => T, ...args: any[]): Promise<T>
                    type(text: string, options?: { delay: number }): Promise<void>
                    press(key: string): Promise<void>
                } | null>
                $$(selector: string): Promise<any[]>
                setCookie(...cookies: Array<{ name: string; value: string; domain: string }>): Promise<void>
                cookies(...urls: string[]): Promise<Array<{ name: string; value: string; domain: string }>>
                evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T>
                screenshot(options: { type: 'png'; fullPage?: boolean }): Promise<Buffer>
                close(): Promise<void>
                url(): string
                waitForNavigation(options?: any): Promise<any>
            }>
        }
    }

    interface Tables {
        streetfighter6_binding: StreetFighter6Binding
    }
}

// 数据库表结构
export interface StreetFighter6Binding {
    id: number
    userId: string
    playerId: string
}

// 排位数据
export interface RankData {
    playerId: string
    playerName?: string
    character: string
    rankName: string
    rankPoints: number
    fightingPoints: number
    title: string
    url: string
}

// 玩家搜索结果
export interface PlayerSearchResult {
    playerId: string
    playerName: string
    url: string
}

// 胜率数据
export interface WinRateData {
    playerId: string
    playerName?: string
    totalWins: number
    totalBattles: number
    winRate: number
    url: string
}
