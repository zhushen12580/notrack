import { constants } from 'node:fs'
import { posix, win32 } from 'node:path'
import { parse, type ParseError } from 'jsonc-parser'
import type { Platform } from './platform.js'
import type { Rule, Status } from './rules.js'
import { emptyReport, type ToolResult, type Report } from './report.js'

export function environment(platform: Platform, key: string): string | undefined {
  const name = platform.platform === 'win32'
    ? Object.keys(platform.env).find(name => name.toLowerCase() === key.toLowerCase()) : key
  return name === undefined ? undefined : platform.env[name]
}
function configPath(template: string, p: Platform): string {
  const paths = p.platform === 'win32' ? win32 : posix
  const xdg = environment(p, 'XDG_CONFIG_HOME')
  const root = template.startsWith('{home}') ? p.home :
    xdg && paths.isAbsolute(xdg) ? xdg : paths.join(p.home, '.config')
  const resolved = paths.resolve(root, template.slice(template.indexOf('/') + 1))
  const relative = paths.relative(root, resolved)
  if (relative.startsWith('..') || paths.isAbsolute(relative)) throw new Error('Invalid config path')
  return resolved
}
async function regular(path: string, p: Platform, executable = false): Promise<boolean> {
  try {
    if (!(await p.stat(path)).isFile()) return false
    if (executable && p.platform !== 'win32') await p.access(path, constants.X_OK)
    return true
  } catch { return false }
}
export async function scan(rules: Rule[], p: Platform): Promise<Report> {
  const report: Report = emptyReport(p)
  const paths = p.platform === 'win32' ? win32 : posix
  for (const r of [...rules].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (!r.platforms.includes(p.platform)) continue
    const detection: string[] = []
    for (const command of r.commands) {
      const extensions = p.platform === 'win32' && !win32.extname(command)
        ? (environment(p, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(e => /^\.[A-Za-z0-9]+$/.test(e)) : ['']
      let found = false
      for (const directory of (environment(p, 'PATH') ?? '').split(p.platform === 'win32' ? ';' : ':').filter(Boolean)) {
        for (const extension of extensions) {
          if (await regular(paths.join(directory, command + extension), p, true)) { found = true; break }
        }
        if (found) break
      }
      if (found) detection.push('PATH: ' + command)
    }
    for (const template of r.configPaths) {
      if (await regular(configPath(template, p), p)) detection.push('config: ' + template)
    }
    if (!detection.length) continue
    const outcomes: {status: Status, evidence: string}[] = []
    for (const s of r.settings) {
      let value: unknown
      const evidence = s.source === 'env' ? 'env: ' + s.key : 'config: ' + s.path + ' / ' + s.field!.join('.')
      if (s.source === 'env') value = environment(p, s.key!)
      else {
        const path = configPath(s.path!, p)
        try {
          const errors: ParseError[] = []
          value = parse(await p.readFile(path, 'utf8'), errors)
          if (errors.length || value === null || typeof value !== 'object' || Array.isArray(value)) { outcomes.push({status: 'unknown', evidence: evidence + ' (invalid configuration)'}); continue }
          for (const field of s.field!) {
            value = value !== null && typeof value === 'object' && Object.hasOwn(value, field)
              ? (value as Record<string, unknown>)[field] : undefined
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
          outcomes.push({status: 'unknown', evidence: evidence + ' (unreadable configuration)'})
          continue
        }
      }
      if (value === undefined) continue
      const status: Status = typeof value !== s.valueType ? 'unknown' :
        value === s.disabled ? 'disabled' : value === s.enabled ? 'enabled' : 'unknown'
      outcomes.push({status, evidence})
    }
    let status: Status = r.defaultStatus === 'on' ? 'default_on' : r.defaultStatus === 'off' ? 'disabled' : 'unknown'
    let evidence = ['default: ' + r.defaultStatus]
    if (outcomes.length) {
      status = outcomes.every(o => o.status === outcomes[0].status) ? outcomes[0].status : 'unknown'
      evidence = outcomes.map(o => o.evidence)
      if (new Set(outcomes.map(o => o.status)).size > 1) evidence.push('setting precedence unconfirmed')
    }
    const tool: ToolResult = {id: r.id, name: r.name, detection, status, evidence,
      supportsDoNotTrack: r.supportsDoNotTrack, documentationUrl: r.documentationUrl}
    report.tools.push(tool)
  }
  return report
}
