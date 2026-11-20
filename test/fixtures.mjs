import { access, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function withFixture(scenario, run) {
  if (scenario !== 'empty') {
    throw new Error(`Unknown fixture scenario: ${scenario}`)
  }

  const root = await mkdtemp(fileURLToPath(new URL('../.fixture-', import.meta.url)))
  try {
    const home = join(root, 'home')
    const bin = join(root, 'bin')
    await Promise.all([mkdir(home), mkdir(bin)])

    return await run({
      platform: 'linux',
      home,
      env: { HOME: home, PATH: bin },
      stdoutIsTTY: false,
      stat,
      access,
      readFile,
      async readRegistry() {
        throw new Error('Unexpected registry read in the empty fixture')
      },
    }, async () => [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
