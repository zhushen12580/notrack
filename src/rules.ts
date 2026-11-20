export type Status = 'enabled' | 'disabled' | 'default_on' | 'unknown'
type Scalar = string | boolean | number
export interface Setting {
  source: 'env' | 'config'
  key?: string
  path?: string
  field?: string[]
  valueType: 'string' | 'boolean' | 'number'
  // Opt-out flags need not have a value that proves telemetry is enabled.
  enabled?: Scalar
  disabled: Scalar
}
export interface Action {
  type: 'env' | 'command' | 'manual'
  key?: string
  value?: string
  program?: string
  args?: string[]
  instruction?: string
  platforms?: string[]
  shells?: string[]
}
export interface LocalCondition {
  source: 'env' | 'config'
  key?: string
  path?: string
  field?: string[]
  values: Scalar[]
}
export interface Rule {
  id: string
  name: string
  category: string
  platforms: string[]
  commands: string[]
  configPaths: string[]
  // Human-readable scope; machine-sensitive scopes must also declare applicability.
  versionScope: string
  applicability?: {documentationUrl: string, conditions: LocalCondition[]}
  // Complete highest-first order, including DNT when supported.
  precedence?: {documentationUrl: string, order: (number | 'dnt')[]}
  defaultStatus: 'on' | 'off' | 'unknown'
  supportsDoNotTrack: boolean
  documentationUrl: string
  settings: Setting[]
  actions: Action[]
}
const platforms = ['linux', 'darwin', 'win32', 'aix', 'freebsd', 'openbsd', 'sunos', 'android', 'netbsd', 'haiku', 'cygwin']
const shells = ['bash', 'zsh', 'fish', 'powershell']
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(v)
const command = (v: unknown) => text(v) && /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(v)
const key = (v: unknown) => text(v) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v)
const list = (v: unknown, check: (x: any) => boolean): v is any[] => Array.isArray(v) && v.every(check)
const template = (v: unknown) => text(v) && /^\{(home|xdgConfig)\}\//.test(v) &&
  v.slice(v.indexOf('/') + 1).split('/').every(p => text(p) && p !== '.' && p !== '..' && !/[\\:{}]/.test(p))
function requireValid(ok: unknown): asserts ok {
  if (!ok) throw new Error('Invalid telemetry rule')
}
function documentation(value: unknown): boolean {
  if (!text(value)) return false
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password }
  catch { return false }
}
export function validateRules(input: unknown): Rule[] {
  requireValid(Array.isArray(input))
  const ids = new Set<string>()
  for (const r of input) {
    requireValid(r && typeof r === 'object')
    requireValid(text(r.id) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.id) && !ids.has(r.id))
    ids.add(r.id)
    requireValid(text(r.name) && text(r.category) && text(r.versionScope))
    requireValid(list(r.platforms, p => platforms.includes(p)) && r.platforms.length > 0)
    requireValid(list(r.commands, command) && list(r.configPaths, template) && r.commands.length + r.configPaths.length > 0)
    requireValid(['on', 'off', 'unknown'].includes(r.defaultStatus) && typeof r.supportsDoNotTrack === 'boolean')
    requireValid(text(r.documentationUrl))
    const url = new URL(r.documentationUrl)
    requireValid(url.protocol === 'https:' && !url.username && !url.password)
    requireValid(Array.isArray(r.settings))
    for (const s of r.settings) {
      requireValid(s && ['env', 'config'].includes(s.source) && ['string', 'boolean', 'number'].includes(s.valueType))
      requireValid(typeof s.disabled === s.valueType &&
        (s.enabled === undefined || (typeof s.enabled === s.valueType && s.enabled !== s.disabled)))
      if (s.valueType === 'number') requireValid(Number.isFinite(s.disabled) &&
        (s.enabled === undefined || Number.isFinite(s.enabled)))
      if (s.source === 'env') requireValid(key(s.key))
      else requireValid(template(s.path) && r.configPaths.includes(s.path) &&
        list(s.field, text) && s.field.length > 0 && !s.field.some((k: string) => ['__proto__', 'constructor', 'prototype'].includes(k)))
    }
    if (r.precedence !== undefined) {
      const order = r.precedence.order
      requireValid(documentation(r.precedence.documentationUrl) && Array.isArray(order))
      const expected = r.settings.map((_: unknown, i: number) => i) as (number | string)[]
      if (r.supportsDoNotTrack) expected.push('dnt')
      requireValid(order.length === expected.length && new Set(order).size === order.length &&
        order.every((item: unknown) => expected.includes(item as number | string)))
    }
    if (r.applicability !== undefined) {
      requireValid(documentation(r.applicability.documentationUrl) && Array.isArray(r.applicability.conditions) && r.applicability.conditions.length > 0)
      for (const c of r.applicability.conditions) {
        requireValid(c && ['env', 'config'].includes(c.source) && list(c.values, v =>
          typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || text(v)) && c.values.length > 0)
        if (c.source === 'env') requireValid(key(c.key))
        else requireValid(template(c.path) && r.configPaths.includes(c.path) && list(c.field, text) && c.field.length > 0 &&
          !c.field.some((k: string) => ['__proto__', 'constructor', 'prototype'].includes(k)))
      }
    }
    requireValid(Array.isArray(r.actions))
    for (const a of r.actions) {
      requireValid(a && ['env', 'command', 'manual'].includes(a.type))
      if (a.platforms !== undefined) requireValid(list(a.platforms, p => platforms.includes(p)) && a.platforms.length > 0)
      if (a.shells !== undefined) requireValid(list(a.shells, s => shells.includes(s)) && a.shells.length > 0)
      if (a.type === 'env') requireValid(key(a.key) && typeof a.value === 'string' && !/[\x00-\x1f\x7f]/.test(a.value))
      if (a.type === 'command') requireValid(command(a.program) && list(a.args, v => typeof v === 'string' && !/[\x00-\x1f\x7f]/.test(v)))
      if (a.type === 'manual') requireValid(text(a.instruction))
    }
  }
  return input as Rule[]
}
