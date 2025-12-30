/**
 * 角色名称到资源ID的映射
 */
export const CHARACTER_ID_MAP: Record<string, string> = {
    // 基础角色
    '隆': 'ryu', 'Ryu': 'ryu',
    '肯': 'ken', 'Ken': 'ken',
    '春丽': 'chunli', 'Chun-Li': 'chunli',
    '古烈': 'guile', 'Guile': 'guile',
    '桑吉尔夫': 'zangief', 'Zangief': 'zangief',
    '达尔西姆': 'dhalsim', 'Dhalsim': 'dhalsim',
    '布兰卡': 'blanka', 'Blanka': 'blanka',
    '本田': 'ehonda', 'E. Honda': 'ehonda',

    // 新一代
    '卢克': 'luke', 'Luke': 'luke',
    '杰米': 'jamie', 'Jamie': 'jamie',
    '玛侬': 'manon', 'Manon': 'manon',
    '金伯莉': 'kimberly', 'Kimberly': 'kimberly',
    '玛丽莎': 'marisa', 'Marisa': 'marisa',
    '莉莉': 'lily', 'Lily': 'lily',
    'JP': 'jp',
    '朱莉': 'juri', 'Juri': 'juri',
    '迪杰': 'deejay', 'Dee Jay': 'deejay',
    '嘉米': 'cammy', 'Cammy': 'cammy',

    // DLC
    '拉希德': 'rashid', 'Rashid': 'rashid',
    '阿基': 'aki', 'A.K.I.': 'aki',
    '艾德': 'ed', 'Ed': 'ed',
    '豪鬼': 'akuma', 'Akuma': 'akuma',
    '维加': 'mbison', 'M. Bison': 'mbison',
    '特瑞': 'terry', 'Terry': 'terry',
    '舞': 'mai', 'Mai': 'mai',
}

/**
 * 获取角色立绘 URL
 * 这里使用的是 SF6 官网的资源路径，如果官网变更可能会失效
 * 也可以考虑将图片下载到本地作为静态资源服务
 */
export function getCharacterImageUrl(characterName: string): string {
    // 移除可能的无关字符，转小写匹配
    const cleanName = characterName.trim()
    const id = CHARACTER_ID_MAP[cleanName] || CHARACTER_ID_MAP[cleanName.replace(/\s+/g, '')] || 'luke' // 默认用 Luke

    // 官网立绘 URL 格式
    return `https://www.streetfighter.com/6/assets/images/character/${id}/visual/01.png`
}

/**
 * 获取段位图标 URL
 * 根据段位名称推断图标 ID
 */
export function getRankIconUrl(rankName: string): string {
    // 简单的段位映射逻辑
    // 这只是一个近似映射，实际 Buckler 网站有具体的 rank ID (1-36+)
    // 这里我们使用通用的段位徽章，或者根据名称尝试匹配

    let rankId = 1 // Rookie 1 默认

    const name = rankName.toLowerCase()

    if (name.includes('rookie')) rankId = 1
    else if (name.includes('iron')) rankId = 6
    else if (name.includes('bronze')) rankId = 11
    else if (name.includes('silver')) rankId = 16
    else if (name.includes('gold')) rankId = 21
    else if (name.includes('platinum')) rankId = 26
    else if (name.includes('diamond')) rankId = 31
    else if (name.includes('master')) rankId = 36
    else if (name.includes('legend')) rankId = 37

    // 细分等级处理 (1-5 星)
    // 如果能解析出具体的 star/LP 可能会更准，这里先返回大段位图标

    // 构造官网图标 URL
    // 官网通常用 rank{N}_s.png 小图标，或者 rank{N}.png 大图标
    return `https://www.streetfighter.com/6/assets/images/rank/rank${rankId}.png`
}

/**
 * 获取角色头像 URL (用于列表展示)
 */
export function getCharacterAvatorUrl(characterName: string): string {
    const cleanName = characterName.trim()
    const id = CHARACTER_ID_MAP[cleanName] || CHARACTER_ID_MAP[cleanName.replace(/\s+/g, '')] || 'luke'
    // 官网头像 URL
    return `https://www.streetfighter.com/6/assets/images/character/${id}/face.png`
}
