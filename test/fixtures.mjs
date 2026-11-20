import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function withFixture(scenario, run) {
  if (!['empty', 'mixed', 'dnt'].includes(scenario)) {
    throw new Error(`Unknown fixture scenario: ${scenario}`)
  }

  const root = await mkdtemp(fileURLToPath(new URL('../.fixture-', import.meta.url)))
  try {
    const home = join(root, 'home')
    const bin = join(root, 'bin')
    await Promise.all([mkdir(home), mkdir(bin)])

    let rules = []
    if (scenario === 'mixed') {
      await writeFile(join(bin, 'tool'), '', {mode: 0o755})
      await writeFile(join(home, 'config.jsonc'), '// comment\n{"telemetry":false,"credential":"fake-secret"}')
      await writeFile(join(home, 'broken.json'), '{')
      rules = [
        rule('fixture-env', {settings: [{source: 'env', key: 'FIXTURE_DISABLED', valueType: 'string', enabled: '0', disabled: '1'}]}),
        rule('fixture-config', {commands: [], configPaths: ['{home}/config.jsonc'], settings: [{source: 'config', path: '{home}/config.jsonc', field: ['telemetry'], valueType: 'boolean', enabled: true, disabled: false}]}),
        rule('fixture-broken', {commands: [], configPaths: ['{home}/broken.json'], settings: [{source: 'config', path: '{home}/broken.json', field: ['telemetry'], valueType: 'boolean', enabled: true, disabled: false}]}),
        rule('fixture-absent', {commands: ['absent']}),
      ]
    }
    if (scenario === 'dnt') {
      await writeFile(join(bin, 'tool'), '', {mode: 0o755})
      rules = [rule('fixture-dnt', {supportsDoNotTrack: true}), rule('fixture-env')]
    }
    return await run({
      platform: 'linux',
      home,
      env: { HOME: home, PATH: bin, ...(scenario === 'dnt' ? {DO_NOT_TRACK: '1'} : {}) },
      stdoutIsTTY: false,
      stat,
      access,
      readFile,
      async readRegistry() {
        throw new Error('Unexpected registry read in the empty fixture')
      },
    }, async () => rules)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

export function rule(id, overrides = {}) {
  return {id, name: id, category: 'test', platforms: ['linux', 'win32', 'darwin'],
    commands: ['tool'], configPaths: [], versionScope: 'All fixture versions',
    defaultStatus: 'on', supportsDoNotTrack: false, documentationUrl: 'https://example.com/docs',
    settings: [], actions: [{type: 'env', key: 'TOOL_DISABLED', value: '1'}], ...overrides}
}
