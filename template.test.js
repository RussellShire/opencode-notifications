import assert from 'node:assert/strict'
import test from 'node:test'

import createPlugin from './template.js'

const createDiagnosticFileSystem = ({
    markerExists = true,
    log = '',
    readLog,
    rewriteLog,
} = {}) => {
    const writes = []
    const rewriteModes = []

    return {
        writes,
        rewriteModes,
        setMarkerExists: (value) => {
            markerExists = value
        },
        markerExists: async () =>
            typeof markerExists === 'function' ? markerExists() : markerExists,
        readLog: async () => (readLog ? readLog() : log),
        rewriteLog: async (_path, contents, mode) => {
            if (rewriteLog) await rewriteLog(contents)
            log = contents
            writes.push(contents)
            rewriteModes.push(mode)
        },
    }
}

const waitForDiagnosticWork = () => new Promise((resolve) => setImmediate(resolve))

test('only session and permission events are recorded when diagnostics are enabled', async () => {
    const fileSystem = createDiagnosticFileSystem()
    const plugin = await createPlugin({
        $: async () => {},
        diagnostics: {
            markerPath: '/diagnostics-marker',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    await plugin.event({ event: { type: 'message.updated' } })
    await plugin.event({ event: { type: 'session.created' } })
    await waitForDiagnosticWork()

    assert.equal(fileSystem.writes.length, 1)
    assert.deepEqual(JSON.parse(fileSystem.writes[0]), {
        timestamp: JSON.parse(fileSystem.writes[0]).timestamp,
        event: { type: 'session.created' },
    })
})

test('the marker controls diagnostic logging at the time each operation begins', async () => {
    const fileSystem = createDiagnosticFileSystem({ markerExists: false })
    const plugin = await createPlugin({
        $: async () => {},
        diagnostics: {
            markerPath: '/diagnostics-marker',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    await plugin.event({ event: { type: 'session.created', properties: {} } })
    await waitForDiagnosticWork()
    fileSystem.setMarkerExists(true)
    await plugin.event({ event: { type: 'permission.asked' } })
    await waitForDiagnosticWork()

    assert.equal(fileSystem.writes.length, 1)
    assert.equal(JSON.parse(fileSystem.writes[0]).event.type, 'permission.asked')
})

test('diagnostic records retain event order when events arrive before earlier writes finish', async () => {
    const pendingReads = []
    const fileSystem = createDiagnosticFileSystem({
        readLog: () => new Promise((resolve) => pendingReads.push(resolve)),
    })
    const plugin = await createPlugin({
        $: async () => {},
        diagnostics: {
            markerPath: '/diagnostics-marker',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    await plugin.event({ event: { type: 'session.created', properties: {} } })
    await plugin.event({ event: { type: 'permission.asked' } })
    await waitForDiagnosticWork()

    assert.equal(pendingReads.length, 1)
    pendingReads.shift()('')
    await waitForDiagnosticWork()
    pendingReads.shift()(fileSystem.writes[0])
    await waitForDiagnosticWork()

    assert.deepEqual(
        fileSystem.writes.at(-1).trim().split('\n').map(JSON.parse).map(({ event }) => event.type),
        ['session.created', 'permission.asked'],
    )
})

test('diagnostic logging continues after a log read fails', async () => {
    const error = new Error('log read failed')
    let readAttempts = 0
    const fileSystem = createDiagnosticFileSystem({
        readLog: () => {
            if (readAttempts++ === 0) throw error
            return ''
        },
    })
    const originalConsoleError = console.error
    const reportedErrors = []
    console.error = (...arguments_) => reportedErrors.push(arguments_)

    try {
        const plugin = await createPlugin({
            $: async () => {},
            diagnostics: {
                markerPath: '/diagnostics-marker',
                logPath: '/diagnostics-log',
                fileSystem,
            },
        })

        await plugin.event({ event: { type: 'session.created', properties: {} } })
        await plugin.event({ event: { type: 'permission.asked' } })
        await waitForDiagnosticWork()

        assert.equal(reportedErrors.length, 1)
        assert.equal(JSON.parse(fileSystem.writes[0]).event.type, 'permission.asked')
    } finally {
        console.error = originalConsoleError
    }
})

test('diagnostic logging continues after a log rewrite fails', async () => {
    const error = new Error('log rewrite failed')
    let rewriteAttempts = 0
    const fileSystem = createDiagnosticFileSystem({
        rewriteLog: () => {
            if (rewriteAttempts++ === 0) throw error
        },
    })
    const originalConsoleError = console.error
    const reportedErrors = []
    console.error = (...arguments_) => reportedErrors.push(arguments_)

    try {
        const plugin = await createPlugin({
            $: async () => {},
            diagnostics: {
                markerPath: '/diagnostics-marker',
                logPath: '/diagnostics-log',
                fileSystem,
            },
        })

        await plugin.event({ event: { type: 'session.created', properties: {} } })
        await plugin.event({ event: { type: 'permission.asked' } })
        await waitForDiagnosticWork()

        assert.equal(reportedErrors.length, 1)
        assert.equal(JSON.parse(fileSystem.writes[0]).event.type, 'permission.asked')
    } finally {
        console.error = originalConsoleError
    }
})

test('diagnostic logging retains the newest 49 valid records and ignores malformed lines', async () => {
    const historicRecords = Array.from(
        { length: 51 },
        (_, index) => JSON.stringify({ index }),
    )
    const fileSystem = createDiagnosticFileSystem({
        log: [...historicRecords.slice(0, 25), '{malformed', ...historicRecords.slice(25)].join('\n'),
    })
    const plugin = await createPlugin({
        $: async () => {},
        diagnostics: {
            markerPath: '/diagnostics-marker',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    await plugin.event({ event: { type: 'session.created', properties: {} } })
    await waitForDiagnosticWork()

    const records = fileSystem.writes[0].trim().split('\n').map(JSON.parse)
    assert.equal(records.length, 50)
    assert.deepEqual(records.slice(0, -1).map(({ index }) => index), Array.from({ length: 49 }, (_, index) => index + 2))
    assert.equal(records.at(-1).event.type, 'session.created')
})

test('a missing diagnostic marker produces no writes or errors', async () => {
    const missingMarkerError = Object.assign(new Error('marker is missing'), {
        code: 'ENOENT',
    })
    const fileSystem = createDiagnosticFileSystem({
        markerExists: () => {
            throw missingMarkerError
        },
    })
    const originalConsoleError = console.error
    const reportedErrors = []
    console.error = (...arguments_) => reportedErrors.push(arguments_)

    try {
        const plugin = await createPlugin({
            $: async () => {},
            diagnostics: {
                markerPath: '/diagnostics-marker',
                logPath: '/diagnostics-log',
                fileSystem,
            },
        })

        await plugin.event({ event: { type: 'session.created', properties: {} } })
        await waitForDiagnosticWork()

        assert.deepEqual(fileSystem.writes, [])
        assert.deepEqual(reportedErrors, [])
    } finally {
        console.error = originalConsoleError
    }
})

test('a missing diagnostic log produces the first diagnostic write', async () => {
    const missingLogError = Object.assign(new Error('log is missing'), {
        code: 'ENOENT',
    })
    const fileSystem = createDiagnosticFileSystem({
        readLog: () => {
            throw missingLogError
        },
    })
    const plugin = await createPlugin({
        $: async () => {},
        diagnostics: {
            markerPath: '/diagnostics-marker',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    await plugin.event({ event: { type: 'session.created', properties: {} } })
    await waitForDiagnosticWork()

    assert.equal(fileSystem.writes.length, 1)
    assert.equal(JSON.parse(fileSystem.writes[0]).event.type, 'session.created')
})

test('an unexpected marker-access error is reported and later diagnostic logging recovers', async () => {
    const accessError = Object.assign(new Error('marker access denied'), {
        code: 'EACCES',
    })
    let markerChecks = 0
    const fileSystem = createDiagnosticFileSystem({
        markerExists: () => {
            if (markerChecks++ === 0) throw accessError
            return true
        },
    })
    const originalConsoleError = console.error
    const reportedErrors = []
    console.error = (...arguments_) => reportedErrors.push(arguments_)

    try {
        const plugin = await createPlugin({
            $: async () => {},
            diagnostics: {
                markerPath: '/diagnostics-marker',
                logPath: '/diagnostics-log',
                fileSystem,
            },
        })

        await plugin.event({ event: { type: 'session.created', properties: {} } })
        await waitForDiagnosticWork()
        await plugin.event({ event: { type: 'permission.asked' } })
        await waitForDiagnosticWork()

        assert.equal(reportedErrors.length, 1)
        assert.equal(JSON.parse(fileSystem.writes[0]).event.type, 'permission.asked')
    } finally {
        console.error = originalConsoleError
    }
})

test('diagnostic log rewrites request owner-only permissions', async () => {
    const fileSystem = createDiagnosticFileSystem()
    const plugin = await createPlugin({
        $: async () => {},
        diagnostics: {
            markerPath: '/diagnostics-marker',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    await plugin.event({ event: { type: 'session.created', properties: {} } })
    await waitForDiagnosticWork()

    assert.deepEqual(fileSystem.rewriteModes, [0o600])
})

test('a permission.asked event displays a permission-required notification', async () => {
    const commands = []
    const plugin = await createPlugin({
        $: async (strings) => commands.push(strings[0]),
    })

    await plugin.event({ event: { type: 'permission.asked' } })

    assert.deepEqual(commands, [
        `osascript -e 'display notification "Permission required" with title "OpenCode" sound name "{{PERM_SOUND}}"'`,
    ])
})

test('a session.idle event displays a task-completed notification', async () => {
    const commands = []
    const plugin = await createPlugin({
        $: async (strings) => commands.push(strings[0]),
    })

    await plugin.event({ event: { type: 'session.idle' } })

    assert.deepEqual(commands, [
        `osascript -e 'display notification "Task completed" with title "OpenCode" sound name "{{IDLE_SOUND}}"'`,
    ])
})

test('an idle session.status event displays a task-completed notification', async () => {
    const commands = []
    const plugin = await createPlugin({
        $: async (strings) => commands.push(strings[0]),
    })

    await plugin.event({
        event: { type: 'session.status', properties: { status: { type: 'idle' } } },
    })

    assert.deepEqual(commands, [
        `osascript -e 'display notification "Task completed" with title "OpenCode" sound name "{{IDLE_SOUND}}"'`,
    ])
})

test('a non-idle session.status event displays no notification', async () => {
    const commands = []
    const plugin = await createPlugin({
        $: async (strings) => commands.push(strings[0]),
    })

    await plugin.event({
        event: { type: 'session.status', properties: { status: { type: 'busy' } } },
    })

    assert.deepEqual(commands, [])
})

test('an unrelated event displays no notification', async () => {
    const commands = []
    const plugin = await createPlugin({
        $: async (strings) => commands.push(strings[0]),
    })

    await plugin.event({ event: { type: 'session.created' } })

    assert.deepEqual(commands, [])
})

test('a matching child idle event removes the child without a notification', async () => {
    const commands = []
    const plugin = await createPlugin({
        $: async (strings) => commands.push(strings[0]),
    })

    await plugin.event({
        event: {
            type: 'session.created',
            properties: { parentID: 'root', sessionID: 'child' },
        },
    })
    await plugin.event({
        event: { type: 'session.idle', properties: { sessionID: 'child' } },
    })

    assert.deepEqual(commands, [])
})

test('root completion remains suppressed until every child has finished', async () => {
    const commands = []
    const plugin = await createPlugin({
        $: async (strings) => commands.push(strings[0]),
    })

    await plugin.event({
        event: {
            type: 'session.created',
            properties: { parentID: 'root', sessionID: 'first-child' },
        },
    })
    await plugin.event({
        event: {
            type: 'session.created',
            properties: { parentID: 'root', sessionID: 'second-child' },
        },
    })
    await plugin.event({ event: { type: 'session.idle' } })
    await plugin.event({
        event: { type: 'session.idle', properties: { sessionID: 'first-child' } },
    })
    await plugin.event({ event: { type: 'session.idle' } })
    await plugin.event({
        event: { type: 'session.idle', properties: { sessionID: 'second-child' } },
    })
    await plugin.event({ event: { type: 'session.idle' } })

    assert.deepEqual(commands, [
        `osascript -e 'display notification "Task completed" with title "OpenCode" sound name "{{IDLE_SOUND}}"'`,
    ])
})

for (const [parentKey, sessionKey] of [
    ['parentID', 'sessionID'],
    ['parentID', 'sessionId'],
    ['parentID', 'id'],
    ['parentId', 'sessionID'],
    ['parentId', 'id'],
]) {
    test(`a child created with ${parentKey} and ${sessionKey} suppresses then permits ID-less completion`, async () => {
        const commands = []
        const plugin = await createPlugin({
            $: async (strings) => commands.push(strings[0]),
        })

        await plugin.event({
            event: {
                type: 'session.created',
                properties: { [parentKey]: 'root', [sessionKey]: 'child' },
            },
        })
        await plugin.event({
            event: { type: 'session.idle' },
        })
        await plugin.event({
            event: { type: 'session.idle', properties: { [sessionKey]: 'child' } },
        })
        await plugin.event({ event: { type: 'session.idle' } })

        assert.deepEqual(commands, [
            `osascript -e 'display notification "Task completed" with title "OpenCode" sound name "{{IDLE_SOUND}}"'`,
        ])
    })
}

test('a child created with parentId and sessionId suppresses then permits ID-less completion', async () => {
    const commands = []
    const plugin = await createPlugin({
        $: async (strings) => commands.push(strings[0]),
    })

    await plugin.event({
        event: {
            type: 'session.created',
            properties: { parentId: 'root', sessionId: 'child' },
        },
    })
    await plugin.event({ event: { type: 'session.idle' } })
    await plugin.event({
        event: { type: 'session.idle', properties: { sessionId: 'child' } },
    })
    await plugin.event({ event: { type: 'session.idle' } })

    assert.deepEqual(commands, [
        `osascript -e 'display notification "Task completed" with title "OpenCode" sound name "{{IDLE_SOUND}}"'`,
    ])
})

test('a permission request notifies while a child is tracked', async () => {
    const commands = []
    const plugin = await createPlugin({
        $: async (strings) => commands.push(strings[0]),
    })

    await plugin.event({
        event: {
            type: 'session.created',
            properties: { parentID: 'root', sessionID: 'child' },
        },
    })
    await plugin.event({ event: { type: 'permission.asked' } })

    assert.deepEqual(commands, [
        `osascript -e 'display notification "Permission required" with title "OpenCode" sound name "{{PERM_SOUND}}"'`,
    ])
})

test('a duplicate child idle event displays a notification after the child was removed', async () => {
    const commands = []
    const plugin = await createPlugin({
        $: async (strings) => commands.push(strings[0]),
    })

    await plugin.event({
        event: {
            type: 'session.created',
            properties: { parentID: 'root', sessionID: 'child' },
        },
    })
    await plugin.event({
        event: { type: 'session.idle', properties: { sessionID: 'child' } },
    })
    await plugin.event({
        event: { type: 'session.idle', properties: { sessionID: 'child' } },
    })

    assert.deepEqual(commands, [
        `osascript -e 'display notification "Task completed" with title "OpenCode" sound name "{{IDLE_SOUND}}"'`,
    ])
})

test('an untracked idle session ID displays a task-completed notification', async () => {
    const commands = []
    const plugin = await createPlugin({
        $: async (strings) => commands.push(strings[0]),
    })

    await plugin.event({
        event: { type: 'session.idle', properties: { sessionID: 'unrelated' } },
    })

    assert.deepEqual(commands, [
        `osascript -e 'display notification "Task completed" with title "OpenCode" sound name "{{IDLE_SOUND}}"'`,
    ])
})

test('an idle session.status child event using id removes the child without a notification', async () => {
    const commands = []
    const plugin = await createPlugin({
        $: async (strings) => commands.push(strings[0]),
    })

    await plugin.event({
        event: {
            type: 'session.created',
            properties: { parentId: 'root', id: 'child' },
        },
    })
    await plugin.event({
        event: {
            type: 'session.status',
            properties: { id: 'child', status: { type: 'idle' } },
        },
    })

    assert.deepEqual(commands, [])
})

test('an empty event envelope displays no notification', async () => {
    const commands = []
    const plugin = await createPlugin({
        $: async (strings) => commands.push(strings[0]),
    })

    await assert.doesNotReject(plugin.event({}))

    assert.deepEqual(commands, [])
})

test('a null event envelope displays no notification', async () => {
    const commands = []
    const plugin = await createPlugin({
        $: async (strings) => commands.push(strings[0]),
    })

    await assert.doesNotReject(plugin.event({ event: null }))

    assert.deepEqual(commands, [])
})

for (const [sessionKey, sessionValue] of [
    ['sessionID', ''],
    ['sessionId', 0],
    ['id', null],
]) {
    test(`an idle event with a ${sessionKey} field containing ${String(sessionValue)} displays a task-completed notification`, async () => {
        const commands = []
        const plugin = await createPlugin({
            $: async (strings) => commands.push(strings[0]),
        })

        await plugin.event({
            event: { type: 'session.idle', properties: { [sessionKey]: sessionValue } },
        })

        assert.deepEqual(commands, [
            `osascript -e 'display notification "Task completed" with title "OpenCode" sound name "{{IDLE_SOUND}}"'`,
        ])
    })
}

test('an absent outer event argument displays no notification', async () => {
    const commands = []
    const plugin = await createPlugin({
        $: async (strings) => commands.push(strings[0]),
    })

    await assert.doesNotReject(plugin.event())

    assert.deepEqual(commands, [])
})

test('a null outer event argument displays no notification', async () => {
    const commands = []
    const plugin = await createPlugin({
        $: async (strings) => commands.push(strings[0]),
    })

    await assert.doesNotReject(plugin.event(null))

    assert.deepEqual(commands, [])
})

test('unrelated, malformed, and non-idle events display no notification', async () => {
    const commands = []
    const plugin = await createPlugin({
        $: async (strings) => commands.push(strings[0]),
    })

    for (const event of [
        { type: 'message.updated' },
        { type: 'session.created', properties: { parentID: 'root' } },
        { type: 'session.created', properties: { sessionID: 'child' } },
        { type: 'session.status', properties: {} },
        { type: 'session.status', properties: { status: { type: 'busy' } } },
    ]) {
        await plugin.event({ event })
    }

    assert.deepEqual(commands, [])
})

test('an injected command rejection propagates from a completion notification', async () => {
    const error = new Error('osascript failed')
    const plugin = await createPlugin({
        $: async () => Promise.reject(error),
    })

    await assert.rejects(
        plugin.event({ event: { type: 'session.idle' } }),
        error,
    )
})

test('an injected command rejection propagates from a permission notification', async () => {
    const error = new Error('osascript failed')
    const plugin = await createPlugin({
        $: async () => Promise.reject(error),
    })

    await assert.rejects(
        plugin.event({ event: { type: 'permission.asked' } }),
        error,
    )
})
