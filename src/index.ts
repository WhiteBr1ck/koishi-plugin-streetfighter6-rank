import { Context } from 'koishi'

// 导入类型和配置
import './types' // 确保类型声明被加载
import { Config } from './config'
import { PluginState } from './state'

// 导入命令注册函数
import { registerBindCommands } from './commands/bind'
import { registerPlayerCommands } from './commands/player'
import { registerStatsCommands } from './commands/stats'
import { registerSearchCommands } from './commands/search'
import { registerAdminCommands } from './commands/admin'

// 插件元信息
export const name = 'streetfighter6-rank'
export const inject = ['puppeteer', 'database']

// 重新导出配置
export { Config }

/**
 * 插件主入口
 */
export function apply(ctx: Context, config: Config) {
  // 创建共享状态实例
  const state = new PluginState(ctx, config)

  // 初始化数据库模型
  ctx.model.extend('streetfighter6_binding', {
    id: 'unsigned',
    userId: 'string',
    playerId: 'string',
  }, {
    primary: 'id',
    autoInc: true,
  })

  // 注册所有命令
  registerBindCommands(ctx, state)
  registerPlayerCommands(ctx, state)
  registerStatsCommands(ctx, state)
  registerSearchCommands(ctx, state)
  registerAdminCommands(ctx, state)

  // 资源回收
  ctx.on('dispose', () => {
    state.clearAllCaches()
  })
}