import { WINDOWS_DOCS } from './windows.js'
import type { Platform } from './platform.js'
import type { Report } from './report.js'
import type { Action, Rule } from './rules.js'
import { isApplicable } from './scan.js'

export type Shell = 'bash' | 'zsh' | 'fish' | 'powershell'

function quote(value: string, shell: Shell): string {
  if (shell === 'powershell') return "'" + value.replaceAll("'", "''") + "'"
  if (shell === 'fish') return "'" + value.replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'"
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

function executable(action: Action, shell: Shell): string {
  if (action.type === 'env') {
    const value = quote(action.value!, shell)
    if (shell === 'powershell') return `$env:${action.key} = ${value}`
    if (shell === 'fish') return `set -gx ${action.key} ${value}`
    return `export ${action.key}=${value}`
  }
  const tokens = [action.program!, ...action.args!].map(token => quote(token, shell)).join(' ')
  return (shell === 'powershell' ? '& ' : '') + tokens
}

// Rendering only: the adapter exposes reads, and no generated command is executed.
export async function renderFix(report: Report, rules: Rule[], platform: Platform, shell: Shell): Promise<string> {
  const lines = new Set<string>()
  const byId = new Map(rules.map(rule => [rule.id, rule]))
  for (const tool of [...report.tools].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (tool.status === 'disabled') continue
    const rule = byId.get(tool.id)
    if (!rule) continue
    const docs = (instruction: string) => `# ${rule.name}: ${instruction} (${rule.documentationUrl})`
    if (!rule.platforms.includes(platform.platform) || !await isApplicable(rule, platform)) {
      lines.add(docs('Confirm version/channel applicability and follow the documented opt-out steps'))
      continue
    }
    if (!rule.actions.length) lines.add(docs('Follow the documented opt-out steps'))
    for (const action of rule.actions) {
      if ((action.platforms && !action.platforms.includes(platform.platform)) ||
          (action.shells && !action.shells.includes(shell))) {
        lines.add(docs(action.type === 'manual' ? action.instruction! : 'Follow the opt-out steps for the applicable platform and shell'))
      } else if (action.type === 'manual') {
        lines.add(docs(action.instruction!))
      } else {
        lines.add(executable(action, shell))
      }
    }
  }
  if (report.windowsDiagnostics && report.windowsDiagnostics.status !== 'disabled') {
    lines.add('# Windows optional diagnostic data: Settings > Privacy & security (Windows 11) / Privacy (Windows 10) > Diagnostics & feedback > Send optional diagnostic data: Off; managed devices may require an administrator (' + WINDOWS_DOCS + ')')
  }
  if (!lines.size) return '# No telemetry opt-out suggestions.\n'
  return '# Environment assignments affect only this shell and subsequent child processes.\n' + [...lines].join('\n') + '\n'
}
