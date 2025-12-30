/**
 * 在日志中脱敏 Cookie
 */
export function redactCookie(c?: string): string {
    if (!c) return ''
    const n = Math.min(8, Math.floor(c.length / 4))
    return c.slice(0, n) + '…' + c.slice(-n)
}
