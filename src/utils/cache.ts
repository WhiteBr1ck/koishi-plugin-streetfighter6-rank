/**
 * 简单内存缓存，支持 TTL 过期
 */
export class SimpleCache<V> {
    private store = new Map<string, { value: V; expires: number }>()

    constructor(private ttlSec: number) { }

    get(key: string): V | undefined {
        const item = this.store.get(key)
        if (!item) return
        if (Date.now() > item.expires) {
            this.store.delete(key)
            return
        }
        return item.value
    }

    set(key: string, value: V) {
        this.store.set(key, { value, expires: Date.now() + this.ttlSec * 1000 })
    }

    clear() {
        this.store.clear()
    }
}
