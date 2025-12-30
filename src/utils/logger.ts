import { Logger } from 'koishi'

const logger = new Logger('streetfighter6-rank')

export interface LogFunctions {
    debugLog: (message: string, ...args: any[]) => void
    infoLog: (message: string, ...args: any[]) => void
    warnLog: (message: string, ...args: any[]) => void
}

/**
 * 创建日志函数
 * @param debug 是否启用调试日志
 */
export function createLogFunctions(debug: boolean): LogFunctions {
    return {
        debugLog: (message: string, ...args: any[]) => {
            if (debug) {
                logger.info(`[DEBUG] ${message}`, ...args)
            }
        },
        infoLog: (message: string, ...args: any[]) => {
            logger.info(`[INFO] ${message}`, ...args)
        },
        warnLog: (message: string, ...args: any[]) => {
            logger.warn(`[WARN] ${message}`, ...args)
        }
    }
}

export { logger }
