const IDLE_DELAY_MS = 3000

/**
 * Create the macOS notification plugin.
 *
 * @param {{ client: object, $: Function }} context OpenCode plugin context.
 * @returns {Promise<{ event: (input: object) => Promise<void> }>} Plugin hooks.
 */
export default async ({ client, $ }) => {
    const timers = new Map()
    const generations = new Map()
    const activityGenerations = new Map()
    const activityOrders = new Map()
    let eventOrder = 0

    /** @param {string} sessionID @returns {Promise<{ id: string, ancestry: Set<string> } | null>} */
    const rootID = async (sessionID) => {
        if (typeof sessionID !== 'string' || !sessionID) return null
        const visited = new Set()
        let currentID = sessionID
        while (!visited.has(currentID)) {
            visited.add(currentID)
            const session = (await client.session.get({ sessionID: currentID }))?.data
            if (!session || session.id !== currentID) return null
            if (session.parentID === undefined) return { id: currentID, ancestry: visited }
            if (typeof session.parentID !== 'string' || !session.parentID) return null
            currentID = session.parentID
        }
        return null
    }

    /** @param {string} rootSessionID @returns {Promise<Set<string> | null>} */
    const treeIDs = async (rootSessionID) => {
        const visited = new Set()
        const pending = [rootSessionID]
        while (pending.length) {
            const sessionID = pending.pop()
            if (visited.has(sessionID)) continue
            visited.add(sessionID)
            const children = (await client.session.children({ sessionID }))?.data
            if (!Array.isArray(children)) return null
            for (const child of children) {
                if (!child || typeof child.id !== 'string' || !child.id) return null
                pending.push(child.id)
            }
        }
        return visited
    }

    /** @param {string} rootSessionID @param {number} generation */
    const notifyIfIdle = async (rootSessionID, generation) => {
        try {
            if (generations.get(rootSessionID) !== generation) return
            const sessionIDs = await treeIDs(rootSessionID)
            if (!sessionIDs || generations.get(rootSessionID) !== generation) return
            const activities = new Map([...sessionIDs].map((sessionID) => [sessionID, activityGenerations.get(sessionID) ?? 0]))
            const statuses = (await client.session.status())?.data
            if (generations.get(rootSessionID) !== generation || !statuses) return
            const currentSessionIDs = await treeIDs(rootSessionID)
            if (generations.get(rootSessionID) !== generation || !currentSessionIDs) return
            if (currentSessionIDs.size !== sessionIDs.size || [...currentSessionIDs].some((sessionID) => !sessionIDs.has(sessionID))) return
            if ([...sessionIDs].some((sessionID) => activityGenerations.get(sessionID) !== activities.get(sessionID))) return
            if (![...sessionIDs].every((sessionID) => statuses[sessionID]?.type === 'idle')) return
            await $`osascript -e '
                set prevVolume to output volume of (get volume settings)
                set volume output volume (prevVolume * 0.3)
                do shell script "afplay -v 3 /System/Library/Sounds/{{IDLE_SOUND}}.aiff"
                delay 0.1
                set volume output volume prevVolume
                '`
        } catch {
            // Session lookups and notification commands must not reject the event hook.
        }
    }

    return {
        event: async ({ event }) => {
            if (event?.type === 'permission.asked') {
                await $`osascript -e '
                    set prevVolume to output volume of (get volume settings)
                    set volume output volume (prevVolume * 0.3)
                    do shell script "afplay -v 3 /System/Library/Sounds/{{PERM_SOUND}}.aiff"
                    delay 0.1
                    set volume output volume prevVolume
                    '`
                return
            }
            if (event?.type !== 'session.status') return
            const emittingSessionID = event.properties?.sessionID
            activityGenerations.set(emittingSessionID, (activityGenerations.get(emittingSessionID) ?? 0) + 1)
            const currentEventOrder = ++eventOrder
            activityOrders.set(emittingSessionID, currentEventOrder)
            const root = await rootID(emittingSessionID).catch(() => null)
            if (!root) return
            const rootSessionID = root.id
            if (event.properties?.status?.type === 'idle') {
                const sessionIDs = await treeIDs(rootSessionID).catch(() => null)
                if (!sessionIDs || [...sessionIDs].some((sessionID) => (activityOrders.get(sessionID) ?? 0) > currentEventOrder)) return
            }
            const generation = (generations.get(rootSessionID) ?? 0) + 1
            generations.set(rootSessionID, generation)
            const timer = timers.get(rootSessionID)
            if (timer) clearTimeout(timer)
            timers.delete(rootSessionID)
            if (event.properties?.status?.type !== 'idle') return
            timers.set(rootSessionID, setTimeout(() => {
                timers.delete(rootSessionID)
                void notifyIfIdle(rootSessionID, generation)
            }, IDLE_DELAY_MS))
        },
    }
}
