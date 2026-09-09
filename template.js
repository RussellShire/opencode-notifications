import { readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const isMissingFile = (error) => error?.code === 'ENOENT'
const defaultDiagnosticLines = 100

const diagnosticFileSystem = {
    readConfig: async (configPath) => {
        try {
            return await readFile(configPath, 'utf8')
        } catch (error) {
            if (isMissingFile(error)) return ''
            throw error
        }
    },
    readLog: async (logPath) => {
        try {
            return await readFile(logPath, 'utf8')
        } catch (error) {
            if (isMissingFile(error)) return ''
            throw error
        }
    },
    rewriteLog: async (logPath, contents, mode) => {
        const temporaryLogPath = `${logPath}.${randomUUID()}.tmp`
        await writeFile(temporaryLogPath, contents, { mode })
        await rename(temporaryLogPath, logPath)
    },
}

const validRecords = (log) =>
    log
        .split('\n')
        .flatMap((line) => {
            try {
                return line ? [JSON.parse(line)] : []
            } catch {
                return []
            }
        })

export default async ({ project, client, $, directory, worktree, diagnostics = {}, runAppleScript: injectedRunAppleScript }) => {
    const runningAgents = new Set()
    const diagnosticsConfigPath = /* {{DIAGNOSTICS_CONFIG_PATH}} */ null
    const diagnosticsLogPath = /* {{DIAGNOSTICS_LOG_PATH}} */ null
    const configPath = diagnostics.configPath ?? diagnosticsConfigPath
    const logPath = diagnostics.logPath ?? diagnosticsLogPath
    const fileSystem = diagnostics.fileSystem ?? diagnosticFileSystem
    let diagnosticQueue = Promise.resolve()

    const writeDiagnosticEvent = async (event) => {
        if (!configPath || !logPath) return

        let lines = defaultDiagnosticLines
        try {
            const config = JSON.parse(await fileSystem.readConfig(configPath))
            if (config?.logging !== true) return
            lines = Number.isSafeInteger(config.lines) && config.lines > 0
                ? config.lines
                : defaultDiagnosticLines
        } catch (error) {
            if (isMissingFile(error) || error instanceof SyntaxError) return
            throw error
        }

        let log = ''
        try {
            log = await fileSystem.readLog(logPath)
        } catch (error) {
            if (!isMissingFile(error)) throw error
        }

        const records = validRecords(log)
        records.push({ timestamp: new Date().toISOString(), event })
        await fileSystem.rewriteLog(
            logPath,
            `${records.slice(-lines).map(JSON.stringify).join('\n')}\n`,
            0o600,
        )
    }

    const enqueueDiagnosticEvent = (event) => {
        diagnosticQueue = diagnosticQueue
            .then(() => writeDiagnosticEvent(event))
            .catch((error) => console.error('Failed to log notification event:', error))
    }

    const defaultRunAppleScript = async (script) => {
        const { stdout } = await execFileAsync('osascript', ['-e', script]);
        return stdout.trim();
    };
    const runAppleScript = injectedRunAppleScript ?? defaultRunAppleScript

    const sendNotification = async (message, soundName) => {
        const rawMaster = await runAppleScript('output volume of (get volume settings)');
        const rawAlert = await runAppleScript('alert volume of (get volume settings)');

        const originalMaster = parseInt(rawMaster, 10) || 50;
        const originalAlert = parseInt(rawAlert, 10) || 50;

        const duckedVol = Math.max(10, Math.floor(originalMaster * 0.4));

        await runAppleScript(`set volume output volume ${duckedVol} alert volume 100`);

        try {
            await runAppleScript('delay 0.1')
            await runAppleScript(`display notification "${message}" with title "OpenCode" sound name "${soundName}"`)
            await runAppleScript('delay 0.1')
        } finally {
            await runAppleScript(`set volume output volume ${originalMaster} alert volume ${originalAlert}`)
        }
    }

    return {
        event: async (payload) => {
            const { event } = payload ?? {}

            if (!event) return

            if (!event.type?.startsWith('message.part.')) {
                enqueueDiagnosticEvent(event)
            }

            const parentID = event.properties?.parentID ?? event.properties?.parentId
            const sessionID =
                event.properties?.sessionID ??
                event.properties?.sessionId ??
                event.properties?.id
            const hasSessionID =
                Object.hasOwn(event.properties ?? {}, "sessionID") ||
                Object.hasOwn(event.properties ?? {}, "sessionId") ||
                Object.hasOwn(event.properties ?? {}, "id")

            if (event.type === "session.created" && parentID && sessionID) {
                runningAgents.add(sessionID)
                return
            }

            if (event.type === "permission.asked") {
                await sendNotification("Permission required", "{{PERM_SOUND}}")
                return
            }

            if (event.type === "question.asked") {
                await sendNotification("Question asked", "{{PERM_SOUND}}")
                return
            }

            const isIdle =
                event.type === "session.idle" ||
                (event.type === "session.status" &&
                    event.properties?.status?.type === "idle")

            if (!isIdle) return

            if (hasSessionID && !parentID) {
                if (runningAgents.delete(sessionID)) return
            }

            if (runningAgents.size !== 0) return

            // await $`osascript -e 'display notification "Task completed" with title "OpenCode" sound name "{{IDLE_SOUND}}"'`
            await sendNotification("Task completed", "{{IDLE_SOUND}}")
        },
    }
}
