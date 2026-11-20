import {spawnSync} from 'node:child_process'
import {readdir, readFile} from 'node:fs/promises'
import {join, dirname} from 'node:path'
import {expect, test} from 'vitest'
import {main} from '../dist/cli.js'
import {withFixture, rule} from './fixtures.mjs'

async function snapshot(root) {
  const result = {}
  for (const entry of await readdir(root, {withFileTypes: true})) {
    const path = join(root, entry.name)
    result[entry.name] = entry.isDirectory() ? await snapshot(path) : (await readFile(path)).toString('hex')
  }
  return result
}
async function render(p, rules, shell) {
  let output = ''
  const code = await main(['--fix', ...(shell ? ['--shell', shell] : [])], {platform: p, loadRules: async () => rules,
    stdout: {write: s => {output += s}}, stderr: {write: s => {throw new Error(s)}}})
  expect(code).toBe(0)
  return output
}
test.each([
  ['bash', "export FIXTURE_TELEMETRY_DISABLED='1'"],
  ['zsh', "export FIXTURE_TELEMETRY_DISABLED='1'"],
  ['fish', "set -gx FIXTURE_TELEMETRY_DISABLED '1'"],
  ['powershell', "$env:FIXTURE_TELEMETRY_DISABLED = '1'"],
])('%s renders unique assignments and manual docs without writes', async (shell, assignment) => {
  await withFixture('fix', async (p, load) => {
    const before = await snapshot(dirname(p.home))
    const calls = []
    const guarded = new Proxy(p, {get(target, key) {
      const value = target[key]
      if (typeof value !== 'function') return value
      return (...args) => {calls.push(key); return value(...args)}
    }})
    const output = await render(guarded, await load(), shell)
    expect(output.split('\n').filter(s => s === assignment)).toHaveLength(1)
    expect(output).toContain('# fixture-manual: Settings > Privacy: disable telemetry (https://example.com/docs)')
    expect(output).not.toMatch(/fixture-disabled|fixture-absent|TOOL_DISABLED/)
    expect(output).toMatch(/shell.*child processes/)
    expect(await snapshot(dirname(p.home))).toEqual(before)
    expect(calls.every(key => ['stat', 'access', 'readFile'].includes(key))).toBe(true)
  })
})
test('bash preserves literal values and command arguments in child processes', async () => {
  await withFixture('fix', async p => {
    const value = "space ' dollar $HOME \\ end"
    const args = ['', value, '$(touch forbidden)', '`echo bad`']
    const output = await render(p, [rule('escape', {actions: [
      {type: 'env', key: 'ESCAPED', value},
      {type: 'command', program: 'node', args: ['-e', 'process.stdout.write(JSON.stringify([process.env.ESCAPED,...process.argv.slice(1)]))', '--', ...args]},
    ]})], 'bash')
    const result = spawnSync('bash', ['--noprofile', '--norc', '-c', output], {encoding: 'utf8', cwd: p.home})
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([value, ...args])
  })
})
test('shell quoting templates preserve quotes, backslashes and dollars', async () => {
  await withFixture('fix', async p => {
    const rules = [rule('escape', {actions: [{type: 'command', program: 'tool', args: ["a'b\\$x", '']} ]})]
    expect(await render(p, rules, 'fish')).toContain("'tool' 'a\\'b\\\\$x' ''")
    expect(await render(p, rules, 'powershell')).toContain("& 'tool' 'a''b\\$x' ''")
    expect(await render(p, rules, 'zsh')).toContain("'tool' 'a'\\''b\\$x' ''")
  })
})
test('restrictions and unknown applicability fall back to documentation', async () => {
  await withFixture('fix', async p => {
    for (const overrides of [
      {actions: [{type: 'env', key: 'BLOCKED', value: '1', platforms: ['win32']}]},
      {actions: [{type: 'command', program: 'blocked', args: [], shells: ['fish']}]},
      {applicability: {documentationUrl: 'https://example.com/version', conditions: [{source: 'env', key: 'VERSION', values: ['2']}] }},
      {actions: []},
    ]) {
      const output = await render(p, [rule('restricted', overrides)], 'bash')
      expect(output.trim().split('\n').every(line => line.startsWith('#'))).toBe(true)
      expect(output).toContain('https://example.com/docs')
    }
  })
})
test('no suggestions has one comment; defaults are bash and PowerShell', async () => {
  await withFixture('fix', async p => {
    expect(await render(p, [])).toBe('# No telemetry opt-out suggestions.\n')
    expect(await render(p, [rule('default')])).toContain("export TOOL_DISABLED='1'")
    const windows = {...p, platform: 'win32', stat: async () => ({isFile: () => true})}
    expect(await render(windows, [rule('default')])).toContain("$env:TOOL_DISABLED = '1'")
  })
})
test.each(['env', 'command', 'manual'])('rejects control characters in %s actions', async type => {
  await withFixture('fix', async p => {
    const action = type === 'env' ? {type, key: 'BAD', value: 'a\nb'} : type === 'command' ? {type, program: 'tool', args: ['a\rb']} : {type, instruction: 'a\nb'}
    let stderr = ''
    expect(await main(['--fix'], {platform: p, loadRules: async () => [rule('bad', {actions: [action]})], stdout: {write: () => {throw Error('unexpected output')}}, stderr: {write: s => {stderr += s}}})).toBe(1)
    expect(stderr).toMatch(/rules/)
  })
})

 test('duplicate commands are emitted once even with different restriction metadata', async () => {
  await withFixture('fix', async p => {
    const action = {type: 'command', program: 'tool', args: ['telemetry', 'disable']}
    const output = await render(p, [rule('one', {actions: [action]}),
      rule('two', {actions: [{...action, shells: ['bash']}]})], 'bash')
    expect(output.split('\n').filter(line => line === "'tool' 'telemetry' 'disable'")).toHaveLength(1)
  })
})
