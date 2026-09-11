import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import createPluginFactory from './template.js'

const createPlugin = (options) => createPluginFactory({
    ...options,
    platform: options.platform,
    environment: options.environment,
    kernelRelease: options.kernelRelease,
    runPowerShell: options.runPowerShell,
    runLinux: options.runLinux,
    runAppleScript: options.runAppleScript ?? (async (script) => {
        if (script.startsWith('output volume') || script.startsWith('alert volume')) return '50'
        if (script.startsWith('display notification')) {
            return options.$?.([`osascript -e '${script}'`])
        }
        return ''
    }),
})

const createDiagnosticFileSystem = ({
    config = '{"logging":true}',
    log = '',
    readLog,
    rewriteLog,
} = {}) => {
    const writes = []
    const rewriteModes = []

    return {
        writes,
        rewriteModes,
        setConfig: (value) => {
            config = value
        },
        readConfig: async () =>
            typeof config === 'function' ? config() : config,
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

test('all non-message-part events are recorded when diagnostics are enabled', async () => {
    const fileSystem = createDiagnosticFileSystem()
    const plugin = await createPlugin({
        $: async () => {},
        diagnostics: {
            configPath: '/diagnostics-config',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    await plugin.event({ event: { type: 'message.updated' } })
    await plugin.event({ event: { type: 'session.created' } })
    await waitForDiagnosticWork()

    assert.equal(fileSystem.writes.length, 3)
    assert.deepEqual(
        fileSystem.writes.at(-1).trim().split('\n').map(JSON.parse).map(({ event }) => event?.type),
        ['message.updated', 'session.created', undefined],
    )
})

test('the configuration controls diagnostic logging at the time each operation begins', async () => {
    const fileSystem = createDiagnosticFileSystem({ config: '{"logging":false}' })
    const plugin = await createPlugin({
        $: async () => {},
        diagnostics: {
            configPath: '/diagnostics-config',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    await plugin.event({ event: { type: 'session.created', properties: {} } })
    await waitForDiagnosticWork()
    fileSystem.setConfig('{"logging":true}')
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
            configPath: '/diagnostics-config',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    const firstEvent = plugin.event({ event: { type: 'session.created', properties: {} } })
    const secondEvent = plugin.event({ event: { type: 'permission.asked' } })
    await waitForDiagnosticWork()

    assert.equal(pendingReads.length, 1)
    for (let index = 0; index < 3; index += 1) {
        assert.equal(typeof pendingReads[0], 'function')
        pendingReads.shift()(index === 0 ? '' : fileSystem.writes.at(-1))
        await waitForDiagnosticWork()
    }
    await Promise.all([firstEvent, secondEvent])

    assert.deepEqual(
        fileSystem.writes.at(-1).trim().split('\n').map(JSON.parse).map(({ event }) => event?.type),
        ['session.created', undefined, 'permission.asked'],
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
                configPath: '/diagnostics-config',
                logPath: '/diagnostics-log',
                fileSystem,
            },
        })

        await plugin.event({ event: { type: 'session.created', properties: {} } })
        await plugin.event({ event: { type: 'permission.asked' } })
        await waitForDiagnosticWork()

        assert.equal(reportedErrors.length, 1)
        assert.equal(
            fileSystem.writes
                .flatMap((contents) => contents.trim().split('\n').map(JSON.parse))
                .find(({ event }) => event?.type === 'permission.asked')
                .event.type,
            'permission.asked',
        )
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
                configPath: '/diagnostics-config',
                logPath: '/diagnostics-log',
                fileSystem,
            },
        })

        await plugin.event({ event: { type: 'session.created', properties: {} } })
        await plugin.event({ event: { type: 'permission.asked' } })
        await waitForDiagnosticWork()

        assert.equal(reportedErrors.length, 1)
        assert.equal(
            fileSystem.writes
                .flatMap((contents) => contents.trim().split('\n').map(JSON.parse))
                .find(({ event }) => event?.type === 'permission.asked')
                .event.type,
            'permission.asked',
        )
    } finally {
        console.error = originalConsoleError
    }
})

test('diagnostic logging retains valid records and ignores malformed lines', async () => {
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
            configPath: '/diagnostics-config',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    await plugin.event({ event: { type: 'session.created', properties: {} } })
    await waitForDiagnosticWork()

    const records = fileSystem.writes[0].trim().split('\n').map(JSON.parse)
    assert.equal(records.length, 52)
    assert.deepEqual(records.slice(0, -1).map(({ index }) => index), Array.from({ length: 51 }, (_, index) => index))
    assert.equal(records.at(-1).event.type, 'session.created')
})

test('a missing diagnostic configuration produces no writes or errors', async () => {
    const missingConfigError = Object.assign(new Error('configuration is missing'), {
        code: 'ENOENT',
    })
    const fileSystem = createDiagnosticFileSystem({
        config: () => {
            throw missingConfigError
        },
    })
    const originalConsoleError = console.error
    const reportedErrors = []
    console.error = (...arguments_) => reportedErrors.push(arguments_)

    try {
        const plugin = await createPlugin({
            $: async () => {},
            diagnostics: {
                configPath: '/diagnostics-config',
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

test('an invalid diagnostic configuration disables logging without reporting an error', async () => {
    const fileSystem = createDiagnosticFileSystem({ config: '{invalid' })
    const plugin = await createPlugin({
        $: async () => {},
        diagnostics: {
            configPath: '/diagnostics-config',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    await plugin.event({ event: { type: 'session.created', properties: {} } })
    await waitForDiagnosticWork()

    assert.deepEqual(fileSystem.writes, [])
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
            configPath: '/diagnostics-config',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    await plugin.event({ event: { type: 'session.created', properties: {} } })
    await waitForDiagnosticWork()

    assert.equal(fileSystem.writes.length, 2)
    assert.equal(JSON.parse(fileSystem.writes[0]).event.type, 'session.created')
})

test('an unexpected configuration-read error is reported and later diagnostic logging recovers', async () => {
	const accessError = Object.assign(new Error('configuration access denied'), {
        code: 'EACCES',
    })
    let configReads = 0
    const fileSystem = createDiagnosticFileSystem({
        config: () => {
            if (configReads++ === 0) throw accessError
            return '{"logging":true}'
        },
    })
    const originalConsoleError = console.error
    const reportedErrors = []
    console.error = (...arguments_) => reportedErrors.push(arguments_)

    try {
        const plugin = await createPlugin({
            $: async () => {},
            diagnostics: {
                configPath: '/diagnostics-config',
                logPath: '/diagnostics-log',
                fileSystem,
            },
        })

        await plugin.event({ event: { type: 'session.created', properties: {} } })
        await waitForDiagnosticWork()
        await plugin.event({ event: { type: 'permission.asked' } })
        await waitForDiagnosticWork()

        assert.equal(reportedErrors.length, 1)
        assert.equal(
            fileSystem.writes
                .flatMap((contents) => contents.trim().split('\n').map(JSON.parse))
                .find(({ event }) => event?.type === 'permission.asked')
                .event.type,
            'permission.asked',
        )
    } finally {
        console.error = originalConsoleError
    }
})

test('diagnostic log rewrites request owner-only permissions', async () => {
    const fileSystem = createDiagnosticFileSystem()
    const plugin = await createPlugin({
        $: async () => {},
        diagnostics: {
            configPath: '/diagnostics-config',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    await plugin.event({ event: { type: 'session.created', properties: {} } })
    await waitForDiagnosticWork()

    assert.deepEqual(fileSystem.rewriteModes, [0o600, 0o600])
})

test('enabled diagnostic logging writes events without handler errors', async () => {
    const fileSystem = createDiagnosticFileSystem({
        config: '{"logging":true}',
    })
    const plugin = await createPlugin({
        $: async () => {},
        diagnostics: {
            configPath: '/diagnostics-config',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    await plugin.event({ event: { type: 'session.created', properties: {} } })
    await waitForDiagnosticWork()

    assert.equal(fileSystem.writes.length, 2)
    assert.equal(JSON.parse(fileSystem.writes[0]).event.type, 'session.created')
})

test('diagnostic logging uses the configured line limit', async () => {
    const log = Array.from({ length: 3 }, (_, index) => JSON.stringify({ index })).join('\n')
    const fileSystem = createDiagnosticFileSystem({
        config: '{"logging":true,"lines":2}',
        log,
    })
    const plugin = await createPlugin({
        $: async () => {},
        diagnostics: {
            configPath: '/diagnostics-config',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    await plugin.event({ event: { type: 'session.created', properties: {} } })
    await waitForDiagnosticWork()

    const records = fileSystem.writes[0].trim().split('\n').map(JSON.parse)
    assert.equal(records.length, 2)
    assert.equal(records[0].index, 2)
    assert.equal(records[1].event.type, 'session.created')
})

test('invalid diagnostic line limits use the default limit', async () => {
    const log = Array.from({ length: 100 }, (_, index) => JSON.stringify({ index })).join('\n')
    const fileSystem = createDiagnosticFileSystem({
        config: '{"logging":true,"lines":0}',
        log,
    })
    const plugin = await createPlugin({
        $: async () => {},
        diagnostics: {
            configPath: '/diagnostics-config',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    await plugin.event({ event: { type: 'session.created', properties: {} } })
    await waitForDiagnosticWork()

    assert.equal(fileSystem.writes[0].trim().split('\n').length, 100)
})

test('handler data writes share retention and evict the oldest record at the configured limit', async () => {
    const fileSystem = createDiagnosticFileSystem({
        config: '{"logging":true,"lines":3}',
    })
    const plugin = await createPlugin({
        $: async () => {},
        diagnostics: {
            configPath: '/diagnostics-config',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    await plugin.event({ event: { type: 'session.created', properties: {} } })
    await plugin.event({ event: { type: 'permission.asked' } })
    await plugin.event({ event: { type: 'message.updated' } })
    await waitForDiagnosticWork()

    const records = fileSystem.writes.at(-1).trim().split('\n').map(JSON.parse)
    assert.deepEqual(records, [
        { timestamp: records[0].timestamp, data: [null] },
        { timestamp: records[1].timestamp, event: { type: 'permission.asked' } },
        { timestamp: records[2].timestamp, event: { type: 'message.updated' } },
    ])
})

test('handler data writes are disabled when diagnostic logging is disabled', async () => {
    const fileSystem = createDiagnosticFileSystem({ config: '{"logging":false}' })
    const plugin = await createPlugin({
        $: async () => {},
        diagnostics: {
            configPath: '/diagnostics-config',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    await plugin.event({ event: { type: 'session.created', properties: {} } })

    assert.deepEqual(fileSystem.writes, [])
})

test('concurrent handler session data writes retain submission-time session IDs in queue order', async () => {
    const pendingReads = []
    const fileSystem = createDiagnosticFileSystem({
        readLog: () => new Promise((resolve) => pendingReads.push(resolve)),
    })
    const plugin = await createPlugin({
        $: async () => {},
        diagnostics: {
            configPath: '/diagnostics-config',
            logPath: '/diagnostics-log',
            fileSystem,
        },
    })

    const firstEvent = plugin.event({
        event: { type: 'session.created', properties: { sessionID: 'first' } },
    })
    const secondEvent = plugin.event({
        event: { type: 'session.created', properties: { sessionID: 'second' } },
    })
    await waitForDiagnosticWork()

    assert.equal(pendingReads.length, 1)
    for (let index = 0; index < 4; index += 1) {
        assert.equal(typeof pendingReads[0], 'function')
        pendingReads.shift()(index === 0 ? '' : fileSystem.writes.at(-1))
        await waitForDiagnosticWork()
    }
    await Promise.all([firstEvent, secondEvent])

    const records = fileSystem.writes.at(-1).trim().split('\n').map(JSON.parse)
    assert.deepEqual(records.map(({ event, data }) => event?.properties?.sessionID ?? data), [
        'first',
        ['first'],
        'second',
        ['first', 'second'],
    ])
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

test('a Windows permission request displays an information balloon without audio', async () => {
    const scripts = []
    const plugin = await createPlugin({
        platform: 'win32',
        runPowerShell: async (script) => scripts.push(script),
    })

    await plugin.event({ event: { type: 'permission.asked' } })

    assert.equal(scripts.length, 1)
    assert.match(scripts[0], /Add-Type -AssemblyName System\.Windows\.Forms/)
    assert.match(scripts[0], /New-Object System\.Windows\.Forms\.NotifyIcon/)
    assert.match(scripts[0], /\$Notification\.Icon = \[System\.Drawing\.SystemIcons\]::Information/)
    assert.match(scripts[0], /\$Notification\.BalloonTipTitle = "OpenCode"/)
    assert.match(scripts[0], /\$Notification\.BalloonTipText = "Permission required"/)
    assert.match(scripts[0], /\$Notification\.Visible = \$true/)
    assert.match(scripts[0], /\$Notification\.ShowBalloonTip\(10000\)/)
    assert.doesNotMatch(scripts[0], /System\.Media|ms-winsoundevent/)
})

test('a WSL environment signal sends a Windows notification instead of notify-send', async () => {
    const powerShellScripts = []
    const linuxInvocations = []
    const plugin = await createPlugin({
        platform: 'linux',
        environment: { WSL_DISTRO_NAME: 'Ubuntu' },
        kernelRelease: '6.8.0-generic',
        runPowerShell: async (script) => powerShellScripts.push(script),
        runLinux: async (...arguments_) => linuxInvocations.push(arguments_),
    })

    await plugin.event({ event: { type: 'permission.asked' } })

    assert.equal(powerShellScripts.length, 1)
    assert.match(powerShellScripts[0], /\$Notification\.BalloonTipText = "Permission required"/)
    assert.deepEqual(linuxInvocations, [])
})

test('a WSL kernel release signal sends a Windows notification instead of notify-send', async () => {
    const powerShellScripts = []
    const linuxInvocations = []
    const plugin = await createPlugin({
        platform: 'linux',
        environment: {},
        kernelRelease: '6.1.0-MiCrOsOfT-standard',
        runPowerShell: async (script) => powerShellScripts.push(script),
        runLinux: async (...arguments_) => linuxInvocations.push(arguments_),
    })

    await plugin.event({ event: { type: 'permission.asked' } })

    assert.equal(powerShellScripts.length, 1)
    assert.match(powerShellScripts[0], /\$Notification\.BalloonTipText = "Permission required"/)
    assert.deepEqual(linuxInvocations, [])
})

test('a WSL PowerShell failure is propagated by the event handler', async () => {
    const error = new Error('powershell.exe is unavailable')
    const linuxInvocations = []
    const plugin = await createPlugin({
        platform: 'linux',
        environment: { WSL_DISTRO_NAME: 'Ubuntu' },
        kernelRelease: '6.8.0-generic',
        runPowerShell: async () => {
            throw error
        },
        runLinux: async (...arguments_) => linuxInvocations.push(arguments_),
    })

    await assert.rejects(plugin.event({ event: { type: 'permission.asked' } }), error)

    assert.deepEqual(linuxInvocations, [])
})

test('a kernel release with a mixed-case WSL marker sends a Windows notification instead of notify-send', async () => {
    const powerShellScripts = []
    const linuxInvocations = []
    const plugin = await createPlugin({
        platform: 'linux',
        environment: {},
        kernelRelease: '6.1.0-WsL2-standard',
        runPowerShell: async (script) => powerShellScripts.push(script),
        runLinux: async (...arguments_) => linuxInvocations.push(arguments_),
    })

    await plugin.event({ event: { type: 'permission.asked' } })

    assert.equal(powerShellScripts.length, 1)
    assert.match(powerShellScripts[0], /\$Notification\.BalloonTipText = "Permission required"/)
    assert.deepEqual(linuxInvocations, [])
})

test('a Linux permission request invokes notify-send with the application name and message', async () => {
    const invocations = []
    const plugin = await createPlugin({
        platform: 'linux',
        environment: {},
        kernelRelease: '6.8.0-generic',
        runLinux: async (...arguments_) => invocations.push(arguments_),
    })

    await plugin.event({ event: { type: 'permission.asked' } })

    assert.deepEqual(invocations, [
        ['notify-send', ['--app-name=OpenCode', 'OpenCode', 'Permission required']],
    ])
})

test('a failed Linux notification does not reject the event handler', async () => {
    const error = new Error('notify-send is unavailable')
    const invocations = []
    const plugin = await createPlugin({
        platform: 'linux',
        runLinux: async (...arguments_) => {
            invocations.push(arguments_)
            throw error
        },
    })

    await assert.doesNotReject(plugin.event({ event: { type: 'permission.asked' } }))

    assert.deepEqual(invocations, [
        ['notify-send', ['--app-name=OpenCode', 'OpenCode', 'Permission required']],
    ])
})

test('the Windows implementation contains no legacy toast or sound source', async () => {
    const source = await readFile(new URL('./template.js', import.meta.url), 'utf8')

    assert.doesNotMatch(source, /windowsSoundUri|ms-winsoundevent|Windows\.UI\.Notifications|System\.Media/)
})

test('an unsupported platform does not invoke a notification runner', async () => {
    const appleScripts = []
    const powerShellScripts = []
    const linuxInvocations = []
    const plugin = await createPlugin({
        platform: 'freebsd',
        runAppleScript: async (script) => appleScripts.push(script),
        runPowerShell: async (script) => powerShellScripts.push(script),
        runLinux: async (...arguments_) => linuxInvocations.push(arguments_),
    })

    await plugin.event({ event: { type: 'permission.asked' } })

    assert.deepEqual(appleScripts, [])
    assert.deepEqual(powerShellScripts, [])
    assert.deepEqual(linuxInvocations, [])
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

test('a child idle event without parent data displays a completion notification', async () => {
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

    assert.deepEqual(commands, [
        `osascript -e 'display notification "Task completed" with title "OpenCode" sound name "{{IDLE_SOUND}}"'`,
    ])
})

test('root completion remains suppressed while session IDs remain tracked', async () => {
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

    assert.deepEqual(commands, [])
})

for (const [parentKey, sessionKey] of [
    ['parentID', 'sessionID'],
    ['parentID', 'sessionId'],
    ['parentID', 'id'],
    ['parentId', 'sessionID'],
    ['parentId', 'id'],
]) {
    test(`a child created with ${parentKey} and ${sessionKey} keeps ID-less completion suppressed`, async () => {
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

        assert.deepEqual(commands, [])
    })
}

test('a child created with parentId and sessionId keeps ID-less completion suppressed', async () => {
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

    assert.deepEqual(commands, [])
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

test('duplicate child idle events without parent data each display a notification', async () => {
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

test('an idle session.status child event without parent data displays a notification', async () => {
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

    assert.deepEqual(commands, [
        `osascript -e 'display notification "Task completed" with title "OpenCode" sound name "{{IDLE_SOUND}}"'`,
    ])
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
