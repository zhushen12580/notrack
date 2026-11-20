import type { Platform } from './platform.js'
import type { Status } from './rules.js'

export interface ToolResult {
  id: string
  name: string
  detection: string[]
  status: Status
  evidence: string[]
  supportsDoNotTrack: boolean
  documentationUrl: string
}
export interface Report {
  schemaVersion: 1
  platform: NodeJS.Platform
  doNotTrack: boolean
  tools: ToolResult[]
  windowsDiagnostics: null
}
export function emptyReport(platform: Platform): Report {
  return {
    schemaVersion: 1,
    platform: platform.platform,
    doNotTrack: platform.env.DO_NOT_TRACK === '1',
    tools: [],
    windowsDiagnostics: null,
  }
}
export function renderTable(report: Report, color: boolean): string {
  const counts = {enabled: 0, disabled: 0, unknown: 0}
  const rows = report.tools.map(tool => {
    counts[tool.status === 'default_on' ? 'enabled' : tool.status]++
    const code = tool.status === 'disabled' ? 32 : tool.status === 'unknown' ? 33 : 31
    const status = color ? '\x1b[' + code + 'm' + tool.status + '\x1b[0m' : tool.status
    return [tool.name, tool.detection.join('; '), status, tool.evidence.join('; ')].join(' | ')
  })
  return ['Tool | Detection | Status | Evidence', ...rows,
    'Detected: ' + report.tools.length + '  Enabled: ' + counts.enabled + '  Disabled: ' + counts.disabled + '  Unknown: ' + counts.unknown,
    'Inference from visible settings; actual network traffic is outside this scan.'].join('\n') + '\n'
}
