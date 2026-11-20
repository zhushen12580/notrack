import { readFile } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import { describe, test, expect } from 'vitest'
import { validateRules } from '../dist/rules.js'
import { scan } from '../dist/scan.js'
import { renderFix } from '../dist/fix.js'

// Facts and expected outcomes are authored separately from the shipped rules.
// The adapter is entirely in memory: no host tools, environment, files or network.
const cases = JSON.parse(await readFile(new URL('./rule-cases.json', import.meta.url), 'utf8'))
const rules = validateRules(JSON.parse(await readFile(new URL('../data/tools.json', import.meta.url), 'utf8')))

function platform(c, facts = {}, installed = true) {
  const os = facts.platform ?? c.platform
  const paths = os === 'win32' ? win32 : posix
  const home = os === 'win32' ? 'C:\\fixture\\home' : '/fixture/home'
  const bin = paths.join(home, 'bin')
  const xdg = facts.env?.XDG_CONFIG_HOME ?? paths.join(home, '.config')
  const expand = template => paths.normalize(template.replace('{home}', home).replace('{xdgConfig}', xdg))
  const files = new Map(Object.entries(facts.files ?? {}).map(([path, contents]) => [expand(path), contents]))
  const executable = paths.join(bin, c.command + (os === 'win32' ? '.EXE' : ''))
  if (installed) files.set(executable, '')
  const missing = () => Object.assign(new Error('Synthetic missing file'), {code: 'ENOENT'})
  return {
    platform: os, home,
    env: {HOME: home, PATH: bin, ...(os === 'win32' ? {PATHEXT: '.EXE;.CMD'} : {}), ...facts.env},
    stdoutIsTTY: false,
    async stat(path) {
      if (!files.has(path)) throw missing()
      return {isFile: () => true}
    },
    async access(path) { expect(path).toBe(executable) },
    async readFile(path) {
      if (!files.has(path)) throw missing()
      return files.get(path)
    },
    async readRegistry() { throw new Error('Catalog scan must not query registry') },
  }
}

function getRule(c) {
  const rule = rules.find(rule => rule.id === c.id)
  expect(rule, 'required built-in rule').toBeDefined()
  return rule
}

function privateReport(report) {
  const output = JSON.stringify(report)
  for (const text of ['/fixture/', 'C:\\\\fixture', 'synthetic-private-value']) expect(output).not.toContain(text)
}

test('catalog has the eight core tools and one independent case per shipped rule', () => {
  expect(cases.map(c => c.id)).toEqual(expect.arrayContaining([
    'claude-code', 'codex', 'gemini-cli', 'gh', 'nextjs', 'dotnet', 'homebrew', 'vscode',
  ]))
  expect(rules.map(rule => rule.id).sort()).toEqual(cases.map(c => c.id).sort())
  expect(new Set(cases.map(c => c.id)).size).toBe(cases.length)
  expect(new Set(rules.map(rule => rule.category)).size).toBeGreaterThanOrEqual(5)
})

for (const c of cases) {
  describe(c.id, () => {
    test('absent tools stay absent, including when opt-out variables are present', async () => {
      const selected = [getRule(c)]
      expect((await scan(selected, platform(c, {}, false))).tools).toEqual([])
      // Settings alone do not prove installation; config files intentionally can.
      expect((await scan(selected, platform(c, {env: {...c.off.env, DO_NOT_TRACK: '1'}}, false))).tools).toEqual([])
    })

    test('PATH detection, documented scope, default or unknown, and safe suggestion', async () => {
      const rule = getRule(c)
      const p = platform(c)
      const baseline = await scan(rules, p)
      expect(baseline.tools.map(tool => tool.id)).toEqual([c.id])
      const tool = baseline.tools[0]
      expect(tool.detection).toEqual(['PATH: ' + c.command])
      expect(tool.status).toBe(c.defaultStatus)
      expect(tool.evidence).toEqual(['default: ' + c.ruleDefault])
      expect(tool.documentationUrl).toBe(c.documentationUrl)
      expect(rule.versionScope).toContain('2026-11-21')
      for (const text of c.scope) expect(rule.versionScope).toContain(text)
      const fix = await renderFix(baseline, rules, p, 'bash')
      for (const text of c.fix) expect(fix).toContain(text)
      if (c.manual) {
        expect(fix.split('\n').every(line => !line || line.startsWith('#'))).toBe(true)
        expect(fix).toContain(c.documentationUrl)
      } else {
        expect(fix.split('\n').filter(line => line && !line.startsWith('#'))).toEqual(c.fix)
      }
      privateReport(baseline)
    })

    test('explicit opt-out evidence, config detection, and manual verification limits', async () => {
      const selected = [getRule(c)]
      const p = platform(c, c.off)
      const report = await scan(selected, p)
      expect(report.tools[0].status).toBe(c.offStatus)
      expect(report.tools[0].evidence).toEqual(c.offEvidence)
      expect(report.tools[0].detection).toEqual(['PATH: ' + c.command, ...(c.configDetection ? ['config: ' + c.configDetection] : [])])
      privateReport(report)
      if (c.offStatus === 'disabled') {
        expect(await renderFix(report, selected, p, 'bash')).toBe('# No telemetry opt-out suggestions.\n')
      } else {
        const fix = await renderFix(report, selected, p, 'bash')
        for (const text of c.fix) expect(fix).toContain(text)
        expect(fix.split('\n').every(line => !line || line.startsWith('#'))).toBe(true)
      }
      if (c.configDetection) {
        const configOnly = await scan(selected, platform(c, c.off, false))
        expect(configOnly.tools[0].detection).toEqual(['config: ' + c.configDetection])
        expect(configOnly.tools[0].status).toBe(c.offStatus)
      }
    })

    test('DNT affects only the documented telemetry scope and exact value 1', async () => {
      const selected = [getRule(c)]
      for (const value of ['1', 'true', '0', '1 ', '']) {
        const tool = (await scan(selected, platform(c, {env: {DO_NOT_TRACK: value}}))).tools[0]
        expect(tool.supportsDoNotTrack).toBe(c.dnt ?? false)
        expect(tool.status).toBe(c.dnt && value === '1' ? 'disabled' : c.defaultStatus)
        expect(tool.evidence).toEqual(c.dnt && value === '1' ? ['env: DO_NOT_TRACK'] : ['default: ' + c.ruleDefault])
      }
    })

    for (const example of c.examples) {
      test(example.name, async () => {
        const report = await scan([getRule(c)], platform(c, example, example.installed ?? true))
        if (example.absent) {
          expect(report.tools).toEqual([])
        } else {
          expect(report.tools[0].status).toBe(example.status)
          if (example.evidence) expect(report.tools[0].evidence).toEqual(example.evidence)
          if (example.detection) expect(report.tools[0].detection).toEqual(example.detection)
        }
        privateReport(report)
      })
    }
  })
}
