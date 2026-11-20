import { execFile } from 'node:child_process'
import { win32 } from 'node:path'
import { promisify } from 'node:util'
import type { Platform } from './platform.js'

export type RegistryResult = {kind: 'missing' | 'error'} |
  {kind: 'value', type: 'REG_DWORD' | 'REG_SZ', value: number | string}
export interface WindowsDiagnostics {
  status: 'enabled' | 'disabled' | 'unknown'
  evidence: string[]
}
export const WINDOWS_DOCS = 'https://learn.microsoft.com/en-us/windows/privacy/configure-windows-diagnostic-data-in-your-organization'
export const POLICY_KEYS = [
  'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection',
  'HKCU\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection',
]
export const LOCAL_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\DataCollection'
const execute = promisify(execFile)
type Runner = (file: string, args: string[], options: {timeout: number, shell: false, encoding: 'utf8', maxBuffer: number, windowsHide: boolean}) => Promise<{stdout: string}>

export async function queryRegistry(key: string, valueName: string, run: Runner = execute): Promise<RegistryResult> {
  try {
    // Use the OS-provided system root, never executable lookup in cwd or PATH.
    // A drive-rooted local path is required: \Windows and C:Windows depend on cwd.
    const systemRoot = process.env.SystemRoot
    if (!systemRoot || !/^[a-z]:[\\/]/i.test(systemRoot)) return {kind: 'error'}
    const executable = win32.join(systemRoot, 'System32', 'reg.exe')
    const {stdout} = await run(executable, ['query', key, '/v', valueName, '/reg:64'],
      {timeout: 3000, shell: false, encoding: 'utf8', maxBuffer: 65536, windowsHide: true})
    const rows = stdout.split(/\r?\n/).map(line => line.trim()).filter(line => line.split(/\s+/)[0]?.toLowerCase() === valueName.toLowerCase())
    if (rows.length !== 1) return {kind: 'error'}
    const match = /^(\S+)\s+(REG_DWORD|REG_SZ)\s+(.+)$/.exec(rows[0])
    if (!match) return {kind: 'error'}
    if (match[2] === 'REG_SZ') return {kind: 'value', type: 'REG_SZ', value: match[3]}
    if (!/^(0x[0-9a-f]+|[0-9]+)$/i.test(match[3])) return {kind: 'error'}
    const value = Number(match[3])
    return Number.isInteger(value) && value <= 0xffffffff ? {kind: 'value', type: 'REG_DWORD', value} : {kind: 'error'}
  } catch (error) {
    const failure = error as {code?: unknown, stderr?: unknown, killed?: boolean}
    // reg exit code 1 also covers access denied. Never classify it alone as absence.
    if (failure.code === 1 && !failure.killed && typeof failure.stderr === 'string' &&
        failure.stderr.trim() === 'ERROR: The system was unable to find the specified registry key or value.') return {kind: 'missing'}
    return {kind: 'error'}
  }
}

// Sources: WINDOWS_DOCS and https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-system#allowtelemetry
// Local UI registry location: https://learn.microsoft.com/en-us/answers/a/13023670
// Only client Windows 10 1903 through 22H2 and released Windows 11 builds below.
// 0/1 exclude optional data (0 may become 1 by edition); 2 is deliberately unknown.
// Policy 3 is a ceiling: users may choose less. Do not infer enabled from it.
export async function scanWindows(platform: Platform): Promise<WindowsDiagnostics | null> {
  if (platform.platform !== 'win32') return null
  const unknown = (reason: string): WindowsDiagnostics => ({status: 'unknown', evidence: [reason]})
  const build = /^10\.0\.(\d+)$/.exec(platform.windowsRelease ?? '')
  const supported = new Set([18362, 18363, 19041, 19042, 19043, 19044, 19045, 22000, 22621, 22631, 26100, 26200])
  if (!build || !supported.has(Number(build[1]))) return unknown('Windows version semantics unconfirmed')
  try {
    const installation = await platform.readRegistry('HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', 'InstallationType')
    if (installation.kind !== 'value' || installation.type !== 'REG_SZ' || installation.value !== 'Client') return unknown('Windows client edition unconfirmed')
    const policies = []
    for (const key of POLICY_KEYS) policies.push(await platform.readRegistry(key, 'AllowTelemetry'))
    const restrictive = policies.some(p => p.kind === 'value' && p.type === 'REG_DWORD' && (p.value === 0 || p.value === 1))
    if (restrictive) return {status: 'disabled', evidence: ['policy AllowTelemetry excludes optional diagnostic data']}
    if (!policies.every(p => p.kind === 'missing')) return unknown('policy AllowTelemetry cannot determine effective optional data setting')
    const local = await platform.readRegistry(LOCAL_KEY, 'AllowTelemetry')
    if (local.kind !== 'value' || local.type !== 'REG_DWORD') return unknown('local AllowTelemetry missing or unreadable')
    if (local.value === 0 || local.value === 1) return {status: 'disabled', evidence: ['local AllowTelemetry excludes optional diagnostic data']}
    if (local.value === 3) return {status: 'enabled', evidence: ['local AllowTelemetry selects optional diagnostic data']}
    return unknown('local AllowTelemetry semantics unrecognized')
  } catch {
    return unknown('Windows registry unavailable or timed out')
  }
}
