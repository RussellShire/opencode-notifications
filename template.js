import { access, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

const isMissingFile = (error) => error?.code === 'ENOENT'

const diagnosticFileSystem = {
    markerExists: async (markerPath) => {
        try {
            await access(markerPath)
            return true
        } catch (error) {
            if (isMissingFile(error)) return false
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

export default async ({ project, client, $, directory, worktree, diagnostics = {} }) => {
    const runningAgents = new Set()
    const diagnosticsMarkerPath = /* {{DIAGNOSTICS_MARKER_PATH}} */ null
    const diagnosticsLogPath = /* {{DIAGNOSTICS_LOG_PATH}} */ null
    const markerPath = diagnostics.markerPath ?? diagnosticsMarkerPath
    const logPath = diagnostics.logPath ?? diagnosticsLogPath
    const fileSystem = diagnostics.fileSystem ?? diagnosticFileSystem
    let diagnosticQueue = Promise.resolve()

    const writeDiagnosticEvent = async (event) => {
        if (!markerPath || !logPath) return

        try {
            if (!(await fileSystem.markerExists(markerPath))) return
        } catch (error) {
            if (isMissingFile(error)) return
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
            `${records.slice(-50).map(JSON.stringify).join('\n')}\n`,
            0o600,
        )
    }

    const enqueueDiagnosticEvent = (event) => {
        diagnosticQueue = diagnosticQueue
            .then(() => writeDiagnosticEvent(event))
            .catch((error) => console.error('Failed to log notification event:', error))
    }

    return {
        event: async (payload) => {
            const { event } = payload ?? {}

            if (!event) return

            if (
                event.type?.startsWith('session.') ||
                event.type?.startsWith('permission.')
            ) {
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
                await $`osascript -e 'display notification "Permission required" with title "OpenCode" sound name "{{PERM_SOUND}}"'`
                return
            }

            const isIdle =
                event.type === "session.idle" ||
                (event.type === "session.status" &&
                    event.properties?.status?.type === "idle")

            if (!isIdle) return

            if (hasSessionID) {
                if (runningAgents.delete(sessionID)) return
            }

            if (runningAgents.size !== 0) return

            await $`osascript -e 'display notification "Task completed" with title "OpenCode" sound name "{{IDLE_SOUND}}"'`
        },
    }
}
