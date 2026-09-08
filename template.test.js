import assert from 'node:assert/strict'
import test from 'node:test'

import createPlugin from './template.js'

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
