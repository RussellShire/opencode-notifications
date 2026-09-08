import assert from 'node:assert/strict'
import test from 'node:test'

import createPlugin from './template.js'

const IDLE = { type: 'idle' }

/** @returns {{ runAll: (includeCancelled?: boolean) => Promise<void>, restore: () => void }} */
function useControlledTimers() {
    const timers = []
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    globalThis.setTimeout = (callback) => {
        const timer = { callback, cancelled: false }
        timers.push(timer)
        return timer
    }
    globalThis.clearTimeout = (timer) => {
        timer.cancelled = true
    }
    return {
        async runAll(includeCancelled = false) {
            for (const timer of timers) if (includeCancelled || !timer.cancelled) await timer.callback()
            await new Promise((resolve) => setImmediate(resolve))
        },
        restore() {
            globalThis.setTimeout = originalSetTimeout
            globalThis.clearTimeout = originalClearTimeout
        },
    }
}

/** @param {object} options */
function createContext(options = {}) {
    const sounds = []
    const sessions = options.sessions ?? { rootA: { id: 'rootA' }, rootB: { id: 'rootB' } }
    return {
        client: {
            session: {
                get: async ({ sessionID }) => ({ data: sessions[sessionID] }),
                children: async ({ sessionID }) => {
                    if (options.childrenError) throw new Error('children unavailable')
                    return { data: options.children?.[sessionID] ?? [] }
                },
                status: async () => {
                    if (options.statusError) throw new Error('status unavailable')
                    return { data: options.statuses ?? { rootA: IDLE, rootB: IDLE } }
                },
            },
        },
        sounds,
        $: async () => sounds.push('idle'),
    }
}

/** @param {string} sessionID @param {{ type: string }} status */
function statusEvent(sessionID, status) {
    return { event: { type: 'session.status', properties: { sessionID, status } } }
}

/** @returns {{ promise: Promise<unknown>, resolve: (value: unknown) => void }} */
function deferred() {
    let resolve
    const promise = new Promise((complete) => {
        resolve = complete
    })
    return { promise, resolve }
}

test('a busy event in another root tree does not cancel an idle root notification', async () => {
    const timers = useControlledTimers()
    try {
        const context = createContext()
        const plugin = await createPlugin(context)
        await plugin.event(statusEvent('rootA', IDLE))
        await plugin.event(statusEvent('rootB', { type: 'busy' }))
        await timers.runAll()
        assert.equal(context.sounds.length, 1)
    } finally {
        timers.restore()
    }
})

test('a direct busy child cancels its root notification', async () => {
    const timers = useControlledTimers()
    try {
        const context = createContext({
            sessions: { root: { id: 'root' }, child: { id: 'child', parentID: 'root' } },
        })
        const plugin = await createPlugin(context)
        await plugin.event(statusEvent('root', IDLE))
        await plugin.event(statusEvent('child', { type: 'busy' }))
        await timers.runAll()
        assert.equal(context.sounds.length, 0)
    } finally {
        timers.restore()
    }
})

test('a retry event in a nested child cancels its root notification', async () => {
    const timers = useControlledTimers()
    try {
        const context = createContext({
            sessions: {
                root: { id: 'root' },
                child: { id: 'child', parentID: 'root' },
                grandchild: { id: 'grandchild', parentID: 'child' },
            },
        })
        const plugin = await createPlugin(context)
        await plugin.event(statusEvent('root', IDLE))
        await plugin.event(statusEvent('grandchild', { type: 'retry' }))
        await timers.runAll()
        assert.equal(context.sounds.length, 0)
    } finally {
        timers.restore()
    }
})

test('a direct busy child suppresses its root notification at expiry', async () => {
    const timers = useControlledTimers()
    try {
        const context = createContext({
            sessions: { root: { id: 'root' } },
            children: { root: [{ id: 'child' }] },
            statuses: { root: IDLE, child: { type: 'busy' } },
        })
        const plugin = await createPlugin(context)
        await plugin.event(statusEvent('root', IDLE))
        await timers.runAll()
        assert.equal(context.sounds.length, 0)
    } finally {
        timers.restore()
    }
})

test('an all-idle root tree plays after the debounce', async () => {
    const timers = useControlledTimers()
    try {
        const context = createContext()
        const plugin = await createPlugin(context)
        await plugin.event(statusEvent('rootA', IDLE))
        await timers.runAll()
        assert.equal(context.sounds.length, 1)
    } finally {
        timers.restore()
    }
})

test('a nested busy descendant suppresses its root notification at expiry', async () => {
    const timers = useControlledTimers()
    try {
        const context = createContext({
            sessions: { root: { id: 'root' } },
            children: { root: [{ id: 'child' }], child: [{ id: 'grandchild' }] },
            statuses: { root: IDLE, child: IDLE, grandchild: { type: 'busy' } },
        })
        const plugin = await createPlugin(context)
        await plugin.event(statusEvent('root', IDLE))
        await timers.runAll()
        assert.equal(context.sounds.length, 0)
    } finally {
        timers.restore()
    }
})

test('an idle child reschedules and plays for its root after busy suppression', async () => {
    const timers = useControlledTimers()
    try {
        const context = createContext({
            sessions: { root: { id: 'root' }, child: { id: 'child', parentID: 'root' } },
            children: { root: [{ id: 'child' }] },
            statuses: { root: IDLE, child: IDLE },
        })
        const plugin = await createPlugin(context)
        await plugin.event(statusEvent('root', IDLE))
        await plugin.event(statusEvent('child', { type: 'busy' }))
        await timers.runAll()
        await plugin.event(statusEvent('child', IDLE))
        await timers.runAll()
        assert.equal(context.sounds.length, 1)
    } finally {
        timers.restore()
    }
})

test('a missing emitting session fails closed without rejection', async () => {
    const timers = useControlledTimers()
    try {
        const context = createContext({ sessions: {} })
        const plugin = await createPlugin(context)
        await assert.doesNotReject(plugin.event(statusEvent('missing', IDLE)))
        await timers.runAll()
        assert.equal(context.sounds.length, 0)
    } finally {
        timers.restore()
    }
})

test('a cyclic emitting-session ancestry fails closed without rejection', async () => {
    const timers = useControlledTimers()
    try {
        const context = createContext({
            sessions: { first: { id: 'first', parentID: 'second' }, second: { id: 'second', parentID: 'first' } },
        })
        const plugin = await createPlugin(context)
        await assert.doesNotReject(plugin.event(statusEvent('first', IDLE)))
        await timers.runAll()
        assert.equal(context.sounds.length, 0)
    } finally {
        timers.restore()
    }
})

test('a malformed emitting-session parent ID fails closed without rejection', async () => {
    const timers = useControlledTimers()
    try {
        const context = createContext({ sessions: { child: { id: 'child', parentID: '' } } })
        const plugin = await createPlugin(context)
        await assert.doesNotReject(plugin.event(statusEvent('child', IDLE)))
        await timers.runAll()
        assert.equal(context.sounds.length, 0)
    } finally {
        timers.restore()
    }
})

test('a children lookup failure at expiry suppresses the notification', async () => {
    const timers = useControlledTimers()
    try {
        const context = createContext({ childrenError: true })
        const plugin = await createPlugin(context)
        await plugin.event(statusEvent('rootA', IDLE))
        await timers.runAll()
        assert.equal(context.sounds.length, 0)
    } finally {
        timers.restore()
    }
})

test('a status lookup failure at expiry suppresses the notification', async () => {
    const timers = useControlledTimers()
    try {
        const context = createContext({ statusError: true })
        const plugin = await createPlugin(context)
        await plugin.event(statusEvent('rootA', IDLE))
        await timers.runAll()
        assert.equal(context.sounds.length, 0)
    } finally {
        timers.restore()
    }
})

test('a stale queued callback cannot notify after newer root activity', async () => {
    const timers = useControlledTimers()
    try {
        const context = createContext()
        const plugin = await createPlugin(context)
        await plugin.event(statusEvent('rootA', IDLE))
        await plugin.event(statusEvent('rootA', { type: 'busy' }))
        await timers.runAll(true)
        assert.equal(context.sounds.length, 0)
    } finally {
        timers.restore()
    }
})

test('a busy child awaiting session resolution suppresses an in-flight root expiry check', async () => {
    const timers = useControlledTimers()
    try {
        const statusResult = deferred()
        const childResult = deferred()
        const context = createContext({
            sessions: { root: { id: 'root' }, child: { id: 'child', parentID: 'root' } },
            children: { root: [{ id: 'child' }] },
            statuses: { root: IDLE, child: IDLE },
        })
        context.client.session.status = () => statusResult.promise
        context.client.session.get = async ({ sessionID }) => {
            if (sessionID === 'child') return childResult.promise
            return { data: { id: 'root' } }
        }
        const plugin = await createPlugin(context)
        await plugin.event(statusEvent('root', IDLE))
        await timers.runAll()

        const busyEvent = plugin.event(statusEvent('child', { type: 'busy' }))
        statusResult.resolve({ data: { root: IDLE, child: IDLE } })
        await new Promise((resolve) => setImmediate(resolve))
        childResult.resolve({ data: { id: 'child', parentID: 'root' } })
        await busyEvent

        assert.equal(context.sounds.length, 0)
    } finally {
        timers.restore()
    }
})

test('a delayed idle event cannot schedule after newer busy activity in its root tree', async () => {
    const timers = useControlledTimers()
    try {
        const childResult = deferred()
        const context = createContext({
            sessions: { root: { id: 'root' }, child: { id: 'child', parentID: 'root' } },
            statuses: { root: IDLE, child: IDLE },
        })
        context.client.session.get = ({ sessionID }) => {
            if (sessionID === 'child') return childResult.promise
            return Promise.resolve({ data: { id: 'root' } })
        }
        const plugin = await createPlugin(context)

        const idleEvent = plugin.event(statusEvent('child', IDLE))
        await plugin.event(statusEvent('root', { type: 'busy' }))
        childResult.resolve({ data: { id: 'child', parentID: 'root' } })
        await idleEvent
        await timers.runAll()

        assert.equal(context.sounds.length, 0)
    } finally {
        timers.restore()
    }
})

test('a descendant added during status retrieval suppresses the root notification', async () => {
    const timers = useControlledTimers()
    try {
        const statusResult = deferred()
        const rootChildren = []
        const context = createContext({
            sessions: { root: { id: 'root' } },
            children: { root: rootChildren },
            statuses: { root: IDLE },
        })
        context.client.session.status = () => statusResult.promise
        const plugin = await createPlugin(context)
        await plugin.event(statusEvent('root', IDLE))
        await timers.runAll()

        rootChildren.push({ id: 'new-child' })
        statusResult.resolve({ data: { root: IDLE } })
        await new Promise((resolve) => setImmediate(resolve))

        assert.equal(context.sounds.length, 0)
    } finally {
        timers.restore()
    }
})
