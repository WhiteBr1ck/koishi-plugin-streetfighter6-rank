import { Schema } from 'koishi'

export interface Config {
    cookie?: string
    capcomEmail?: string
    capcomPassword?: string
    cookieRefreshInterval: number
    userAgent: string
    baseUrl: string
    locale: string
    enableTextOutput: boolean // 是否启用文本输出
    enableScreenshotOutput: boolean // 是否启用截图输出
    enableForwardMessage: boolean // 是否启用合并转发
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        cookie: Schema.string().role('secret').description('Buckler 登录cookies（最高优先级）'),
        capcomEmail: Schema.string().description('CAPCOM ID 邮箱（大概率被 Cloudflare 拦截，不推荐使用）'),
        capcomPassword: Schema.string().role('secret').description('CAPCOM ID 密码（大概率被 Cloudflare 拦截，不推荐使用）'),
        cookieRefreshInterval: Schema.number().default(12).description('账号密码自动登录 Cookie 刷新间隔（小时），0为不自动刷新（大概率被 Cloudflare 拦截，不推荐使用）').min(0),
        userAgent: Schema.string().default('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36').description('浏览器 User-Agent'),
    }).description('账号设置'),

    Schema.object({
        baseUrl: Schema.string().default('https://www.streetfighter.com/6/buckler').description('SF6 Buckler 基础 URL'),
        locale: Schema.string().default('zh-hans').description('语言区域 (zh-hans/en/ja)'),
    }).description('网络设置'),

    Schema.object({
        enableTextOutput: Schema.boolean().default(true).description('是否输出文本信息'),
        enableScreenshotOutput: Schema.boolean().default(true).description('是否输出图片信息'),
        enableForwardMessage: Schema.boolean().default(true).description('搜索结果过多时是否使用合并转发'),
    }).description('输出设置'),
])
