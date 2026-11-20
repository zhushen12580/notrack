import { test, expect } from 'vitest'
import { writeFile, mkdir, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { withFixture, rule } from './fixtures.mjs'
import { scan } from '../dist/scan.js'
import { renderTable } from '../dist/report.js'

test('mixed detection, JSONC, sorting, privacy and status inference', async () => {
  await withFixture('mixed', async (p, load) => {
    const report = await scan(await load(), p)
    expect(report.tools.map(t => [t.id, t.status])).toEqual([
      ['fixture-broken', 'unknown'], ['fixture-config', 'disabled'], ['fixture-env', 'default_on'],
    ])
    expect(report.tools[1].detection).toEqual(['config: {home}/config.jsonc'])
    expect(JSON.stringify(report)).not.toContain(p.home)
    expect(JSON.stringify(report)).not.toContain('fake-secret')
    const table = renderTable(report, true)
    for (const code of [31, 32, 33]) expect(table).toContain('\x1b[' + code + 'm')
    expect(table).toContain('Detected: 3  Enabled: 1  Disabled: 1  Unknown: 1')
    expect(table).toContain('visible settings')
  })
})

test('POSIX requires executable regular files, ignores empty PATH segments and searches all entries', async () => {
  await withFixture('empty', async p => {
    const bin = p.env.PATH
    await writeFile(join(bin, 'tool'), '')
    expect((await scan([rule('a')], p)).tools).toEqual([])
    await chmod(join(bin, 'tool'), 0o755)
    expect((await scan([rule('a')], {...p, env: {PATH: ':' + join(p.home, 'missing') + '::' + bin}})).tools).toHaveLength(1)
    await mkdir(join(bin, 'directory'))
    expect((await scan([rule('a', {commands: ['directory']})], p)).tools).toEqual([])
  })
})

test('Windows uses case insensitive environment names, PATHEXT and explicit extensions', async () => {
  const seen = []
  const p = {platform: 'win32', home: 'C:\\Users\\fixture', env: {Path: ';C:\\bin;;', PathExt: '.EXE;.CMD'}, stdoutIsTTY: false,
    stat: async path => { seen.push(path); if (path.toLowerCase() !== 'c:\\bin\\tool.cmd') throw Error(); return {isFile: () => true} },
    access: async () => { throw Error('must not check POSIX execute') }}
  for (const command of ['tool', 'tool.cmd']) {
    expect((await scan([rule('a', {commands: [command]})], p)).tools).toHaveLength(1)
  }
  expect(seen.every(path => path.startsWith('C:\\bin\\'))).toBe(true)
})

test('XDG fallback/override, missing fields, wrong values, read errors, and existence-only configs', async () => {
  await withFixture('empty', async p => {
    await mkdir(join(p.home, '.config'))
    await writeFile(join(p.home, '.config', 'tool.json'), '{"telemetry":false}')
    const r = rule('a', {commands: [], configPaths: ['{xdgConfig}/tool.json'], settings: [
      {source: 'config', path: '{xdgConfig}/tool.json', field: ['telemetry'], valueType: 'boolean', enabled: true, disabled: false},
    ]})
    for (const xdg of [undefined, 'relative', p.home + '/.config']) {
      expect((await scan([r], {...p, env: {XDG_CONFIG_HOME: xdg}})).tools[0].status).toBe('disabled')
    }
    for (const [content, status] of [['{}', 'default_on'], ['{"telemetry":"fake-secret"}', 'unknown'], ['{', 'unknown'], ['null', 'unknown'], ['42', 'unknown'], ['[]', 'unknown']]) {
      await writeFile(join(p.home, '.config', 'tool.json'), content)
      expect((await scan([r], p)).tools[0].status).toBe(status)
    }
    expect((await scan([r], {...p, readFile: async () => { throw Error('fake-secret') }})).tools[0].status).toBe('unknown')
    expect((await scan([{...r, settings: []}], p)).tools[0].status).toBe('default_on')
    expect((await scan([{...r, defaultStatus: 'off', settings: []}], p)).tools[0].status).toBe('disabled')
  })
})

test('environment values use declared types and never leak raw values', async () => {
  await withFixture('mixed', async (p, load) => {
    for (const [value, status] of [['1', 'disabled'], ['0', 'enabled'], ['fake-secret', 'unknown']]) {
      const report = await scan(await load(), {...p, env: {...p.env, FIXTURE_DISABLED: value}})
      expect(report.tools.find(t => t.id === 'fixture-env').status).toBe(status)
      expect(JSON.stringify(report)).not.toContain('fake-secret')
    }
  })
})

test('opt-out aliases remain type-sensitive and unmatched values stay unknown', async () => {
  await withFixture('mixed', async p => {
    const r = rule('a', {settings: [
      {source: 'env', key: 'OPT_OUT', valueType: 'string', disabled: ['1', 'true', 'yes'], enabled: '0'},
    ]})
    for (const [value, status] of [
      [undefined, 'default_on'], ['1', 'disabled'], ['true', 'disabled'], ['yes', 'disabled'],
      ['0', 'enabled'], ['true ', 'unknown'], ['synthetic-private-value', 'unknown'],
    ]) {
      const report = await scan([r], {...p, env: {...p.env, OPT_OUT: value}})
      expect(report.tools[0].status).toBe(status)
      expect(JSON.stringify(report)).not.toContain('synthetic-private-value')
    }
    // Config aliases retain their declared JSON type instead of coercing strings.
    const config = rule('config', {commands: [], configPaths: ['{home}/tool.json'], settings: [
      {source: 'config', path: '{home}/tool.json', field: ['telemetry'], valueType: 'number', disabled: [0, -1], enabled: 1},
    ]})
    for (const [value, status] of [[0, 'disabled'], [-1, 'disabled'], [1, 'enabled'], ['0', 'unknown']]) {
      await writeFile(join(p.home, 'tool.json'), JSON.stringify({telemetry: value}))
      expect((await scan([config], p)).tools[0].status).toBe(status)
    }
  })
})

test('presence opt-outs include empty and arbitrary values without exposing them', async () => {
  await withFixture('mixed', async p => {
    const r = rule('a', {settings: [{source: 'env', key: 'OPT_OUT', valueType: 'presence'}]})
    for (const value of ['', '0', 'false', '1', 'synthetic-private-value']) {
      const report = await scan([r], {...p, env: {...p.env, OPT_OUT: value}})
      expect(report.tools[0].status).toBe('disabled')
      expect(report.tools[0].evidence).toEqual(['env: OPT_OUT'])
      expect(JSON.stringify(report)).not.toContain('synthetic-private-value')
    }
    expect((await scan([r], p)).tools[0].status).toBe('default_on')
    const windows = {...p, platform: 'win32', env: {Path: 'C:\\bin', opt_out: ''}, stat: async () => ({isFile: () => true})}
    expect((await scan([r], windows)).tools[0].status).toBe('disabled')
  })
})

test('missing configs do not override PATH detection and unsupported platforms are skipped', async () => {
  await withFixture('mixed', async p => {
    const r = rule('a', {configPaths: ['{home}/missing.json'], settings: [
      {source: 'config', path: '{home}/missing.json', field: ['telemetry'], valueType: 'boolean', enabled: true, disabled: false},
    ]})
    expect((await scan([r], p)).tools[0].status).toBe('default_on')
    expect((await scan([{...r, platforms: ['win32']}], p)).tools).toEqual([])
    expect((await scan([{...r, defaultStatus: 'unknown'}], p)).tools[0].status).toBe('unknown')
  })
})

const envSetting = {source: 'env', key: 'OPT_OUT', valueType: 'string', enabled: '0', disabled: '1'}
const brokenSetting = {source: 'config', path: '{home}/broken.json', field: ['telemetry'], valueType: 'boolean', enabled: true, disabled: false}
const documented = 'https://example.com/precedence'
test('documented alternative opt-outs cannot cancel each other, while undeclared conflicts stay unknown', async () => {
  await withFixture('mixed', async p => {
    const r = rule('a', {supportsDoNotTrack: true, settings: [envSetting],
      combination: {mode: 'any-disabled', documentationUrl: documented}})
    for (const [env, status, evidence] of [
      [{OPT_OUT: '0', DO_NOT_TRACK: '1'}, 'disabled', ['env: DO_NOT_TRACK']],
      [{OPT_OUT: 'synthetic-private-value', DO_NOT_TRACK: '1'}, 'disabled', ['env: DO_NOT_TRACK']],
      [{OPT_OUT: '1', DO_NOT_TRACK: '0'}, 'disabled', ['env: OPT_OUT']],
      [{OPT_OUT: '1', DO_NOT_TRACK: '1'}, 'disabled', ['env: OPT_OUT', 'env: DO_NOT_TRACK']],
      [{OPT_OUT: '0', DO_NOT_TRACK: '0'}, 'enabled', ['env: OPT_OUT']],
      [{OPT_OUT: 'synthetic-private-value'}, 'unknown', ['env: OPT_OUT']],
      [{}, 'default_on', ['default: on']],
    ]) {
      const report = await scan([r], {...p, env: {...p.env, ...env}})
      expect(report.tools[0].status).toBe(status)
      expect(report.tools[0].evidence).toEqual(evidence)
      expect(JSON.stringify(report)).not.toContain('synthetic-private-value')
    }
    const conflict = {...p, env: {...p.env, OPT_OUT: '0', DO_NOT_TRACK: '1'}}
    expect((await scan([{...r, combination: undefined}], conflict)).tools[0].status).toBe('unknown')
    const gated = {...r, applicability: {documentationUrl: documented,
      conditions: [{source: 'env', key: 'VERSION', values: ['2']}]}}
    expect((await scan([gated], conflict)).tools[0].status).toBe('unknown')
  })
})

test('DNT is exact, opt-in per rule, and participates in documented precedence', async () => {
  await withFixture('mixed', async p => {
    const r = rule('a', {supportsDoNotTrack: true, settings: [envSetting]})
    for (const value of [undefined, '0', 'true', '1 ', '']) {
      expect((await scan([r], {...p, env: {...p.env, DO_NOT_TRACK: value}})).tools[0].status).toBe('default_on')
    }
    const platform = {...p, env: {...p.env, DO_NOT_TRACK: '1', OPT_OUT: '0'}}
    expect((await scan([r], platform)).tools[0].status).toBe('unknown')
    for (const [order, status] of [[[0, 'dnt'], 'enabled'], [['dnt', 0], 'disabled']]) {
      expect((await scan([{...r, precedence: {order, documentationUrl: documented}}], platform)).tools[0].status).toBe(status)
    }
  })
})

test('documented order short circuits lower invalid or unreadable settings only', async () => {
  await withFixture('mixed', async p => {
    const r = rule('a', {configPaths: ['{home}/broken.json'], settings: [envSetting, brokenSetting]})
    const platform = {...p, env: {...p.env, OPT_OUT: '1'}, readFile: async () => { throw Error('private') }}
    expect((await scan([r], platform)).tools[0].status).toBe('unknown')
    const ordered = {...r, precedence: {order: [0, 1], documentationUrl: documented}}
    let reads = 0
    expect((await scan([ordered], {...platform, readFile: async () => { reads++; throw Error() }})).tools[0].status).toBe('disabled')
    expect(reads).toBe(0)
    expect((await scan([ordered], p)).tools[0].status).toBe('unknown')
    const consistent = {...r, settings: [envSetting, {...envSetting, key: 'SECOND'}]}
    expect((await scan([consistent], {...p, env: {...p.env, OPT_OUT: '1', SECOND: '1'}})).tools[0].status).toBe('disabled')
  })
})

test('version and channel gates require declared local facts before settings or defaults apply', async () => {
  await withFixture('mixed', async p => {
    const applicability = {documentationUrl: documented, conditions: [
      {source: 'env', key: 'TOOL_VERSION', values: ['2.0']},
      {source: 'config', path: '{home}/config.jsonc', field: ['channel'], values: ['stable']},
    ]}
    const r = rule('a', {defaultStatus: 'off', supportsDoNotTrack: true, configPaths: ['{home}/config.jsonc'], applicability})
    for (const version of [undefined, '1.0', '2.0']) {
      const result = (await scan([r], {...p, env: {...p.env, TOOL_VERSION: version, DO_NOT_TRACK: '1'}})).tools[0]
      expect(result.status).toBe('unknown')
      expect(result.evidence).toEqual(['version or channel applicability unconfirmed'])
    }
    await writeFile(join(p.home, 'config.jsonc'), '{"channel":"stable"}')
    expect((await scan([r], {...p, env: {...p.env, TOOL_VERSION: '2.0'}})).tools[0].status).toBe('disabled')
    expect((await scan([r], {...p, env: {...p.env, TOOL_VERSION: '2.0'}, readFile: async () => {throw Error()} })).tools[0].status).toBe('unknown')
  })
})

test('applicability interface lets action rendering reject unresolved scope', async () => {
  const {isApplicable} = await import('../dist/scan.js')
  await withFixture('empty', async p => {
    const r = rule('a', {applicability: {documentationUrl: documented,
      conditions: [{source: 'env', key: 'VERSION', values: ['2']}]}})
    expect(await isApplicable(r, p)).toBe(false)
    expect(await isApplicable(r, {...p, env: {VERSION: '2'}})).toBe(true)
    expect(await isApplicable(rule('a'), p)).toBe(true)
  })
})
