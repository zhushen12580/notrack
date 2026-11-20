import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, test, vi } from 'vitest'
import { withFixture } from './fixtures.mjs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function runFixture(...args) {
  return spawnSync(process.execPath, ['test/run-fixture.mjs', 'empty', '--', ...args], {
    encoding: 'utf8',
    env: { ...process.env, DO_NOT_TRACK: '1' },
  })
}

test('empty fixture emits one JSON object with the stable report fields', () => {
  const result = runFixture('--json')

  expect(result.status, result.stderr).toBe(0)
  expect(result.stderr).toBe('')
  expect(JSON.parse(result.stdout)).toEqual({
    schemaVersion: 1,
    platform: 'linux',
    doNotTrack: false,
    tools: [],
    windowsDiagnostics: null,
  })
})

test.each([
  [['--fix', '--json'], /--fix.*--json/],
  [['--unrecognized'], /--unrecognized/],
  [['unexpected'], /unexpected/i],
  [['--shell', 'bash'], /--shell.*--fix/],
  [['--fix', '--shell', 'cmd'], /--shell.*cmd/],
  [['--fix', '--shell'], /--shell/],
  [['--color', '--no-color'], /--color.*--no-color/],
  [['--help', '--unrecognized'], /--unrecognized/],
])('rejects invalid arguments %j', (args, diagnostic) => {
  const result = runFixture(...args)

  expect(result.status, result.stderr).toBe(2)
  expect(result.stdout).toBe('')
  expect(result.stderr).toMatch(diagnostic)
})

async function runMain(args, loadRules, env = {}) {
  const { main } = await import('../dist/cli.js')
  const stdout = { write: vi.fn() }
  const stderr = { write: vi.fn() }

  const status = await withFixture('empty', (platform) =>
    main(args, { platform: { ...platform, env: { ...platform.env, ...env } }, loadRules, stdout, stderr }),
  )
  return { status, stdout, stderr }
}

test.each([
  ['--help', /Usage: notrack/],
  ['--version', `${manifest.version}\n`],
])('%s bypasses rule loading', async (flag, expected) => {
  const loadRules = vi.fn()
  const { status, stdout, stderr } = await runMain([flag], loadRules)

  expect(status).toBe(0)
  expect(stdout.write).toHaveBeenCalledOnce()
  if (typeof expected === 'string') {
    expect(stdout.write).toHaveBeenCalledWith(expected)
  } else {
    expect(stdout.write.mock.calls[0][0]).toMatch(expected)
  }
  expect(stderr.write).not.toHaveBeenCalled()
  expect(loadRules).not.toHaveBeenCalled()
})

test.each([
  ['1', true],
  ['true', false],
  ['1 ', false],
])('interprets DO_NOT_TRACK=%j as %s', async (value, expected) => {
  const { status, stdout } = await runMain(['--json'], async () => [], { DO_NOT_TRACK: value })

  expect(status).toBe(0)
  expect(JSON.parse(stdout.write.mock.calls[0][0]).doNotTrack).toBe(expected)
})

test('validates arguments before loading rules', async () => {
  const loadRules = vi.fn()
  const { status, stdout, stderr } = await runMain(['--fix', '--json'], loadRules)

  expect(status).toBe(2)
  expect(loadRules).not.toHaveBeenCalled()
  expect(stdout.write).not.toHaveBeenCalled()
  expect(stderr.write).toHaveBeenCalledOnce()
})

test.each([
  async () => { throw new Error('cannot read file') },
  async () => ({}),
])('reports invalid or unavailable rules on stderr with exit 1', async (loadRules) => {
  const { status, stdout, stderr } = await runMain(['--json'], loadRules)

  expect(status).toBe(1)
  expect(stdout.write).not.toHaveBeenCalled()
  expect(stderr.write).toHaveBeenCalledWith(expect.stringMatching(/rules/i))
})

test.each([
  [false, {}, [], false], [true, {}, [], true], [true, {NO_COLOR: ''}, [], false],
  [false, {NO_COLOR: '1'}, ['--color'], true], [true, {}, ['--no-color'], false],
])('table color follows terminal, NO_COLOR and explicit flags', async (tty, env, args, colored) => {
  const {main} = await import('../dist/cli.js')
  await withFixture('mixed', async (p, loadRules) => {
    let output = ''
    const status = await main(args, {platform: {...p, stdoutIsTTY: tty, env: {...p.env, ...env}}, loadRules,
      stdout: {write: text => { output += text }}, stderr: {write: () => {}}})
    expect(status).toBe(0)
    expect(output.includes('\x1b[')).toBe(colored)
    expect(output).toContain('fixture-config')
    expect(output).toContain('{home}/config.jsonc')
    expect(output).not.toContain('fixture-absent')
  })
})

test('dnt fixture reports exact support, status and safe evidence', () => {
  const result = spawnSync(process.execPath, ['test/run-fixture.mjs', 'dnt', '--', '--json'], {encoding: 'utf8'})
  expect(result.status, result.stderr).toBe(0)
  const report = JSON.parse(result.stdout)
  expect(report.doNotTrack).toBe(true)
  expect(report.tools.map(t => [t.id, t.supportsDoNotTrack, t.status, t.evidence])).toEqual([
    ['fixture-dnt', true, 'disabled', ['env: DO_NOT_TRACK']],
    ['fixture-env', false, 'default_on', ['default: on']],
  ])
})

test('fix fixture wrapper uses the real CLI entry', () => {
  const result = spawnSync(process.execPath, ['test/run-fixture.mjs', 'fix', '--', '--fix'], {encoding: 'utf8'})
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain("export FIXTURE_TELEMETRY_DISABLED='1'")
})

test('the default table associates documentation with every individual finding', () => {
  const run = flag => spawnSync(process.execPath, ['test/run-fixture.mjs', 'mixed', '--', flag], {encoding: 'utf8'})
  const json = run('--json')
  const table = run('--no-color')
  expect(json.status, json.stderr).toBe(0)
  expect(table.status, table.stderr).toBe(0)
  for (const tool of JSON.parse(json.stdout).tools) {
    const row = table.stdout.split('\n').find(line => line.startsWith(tool.name + ' | '))
    expect(row).toContain(tool.documentationUrl)
  }
})

test.each([['windows-off','disabled'],['windows-on','enabled'],['windows-denied','unknown'],['linux',null],['macos',null]])('diagnostics fixture %s', (scenario, status) => {
  const result = spawnSync(process.execPath, ['test/run-fixture.mjs', scenario, '--', '--json'], {encoding:'utf8'})
  expect(result.status, result.stderr).toBe(0)
  const diagnostics = JSON.parse(result.stdout).windowsDiagnostics
  if (status === null) expect(diagnostics).toBeNull()
  else expect(diagnostics.status).toBe(status)
})
test('Windows table follows summary and fix contains only commented UI guidance', () => {
  const run = flag => spawnSync(process.execPath, ['test/run-fixture.mjs','windows-on','--',flag], {encoding:'utf8'}).stdout
  const table = run('--no-color')
  expect(table.indexOf('Windows optional diagnostic data')).toBeGreaterThan(table.indexOf('Detected:'))
  const fix = run('--fix')
  expect(fix).toContain('Diagnostics & feedback')
  expect(fix).toContain('https://learn.microsoft.com/')
  expect(fix.trim().split('\n').every(line => line.startsWith('#'))).toBe(true)
})
