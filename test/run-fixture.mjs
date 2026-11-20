import { main } from '../dist/cli.js'
import { withFixture } from './fixtures.mjs'

const [scenario, separator, ...argv] = process.argv.slice(2)

if (!scenario || separator !== '--') {
  process.stderr.write('Usage: node test/run-fixture.mjs <scenario> -- [CLI arguments]\n')
  process.exitCode = 2
} else {
  try {
    process.exitCode = await withFixture(scenario, (platform, loadRules) =>
      main(argv, { platform, loadRules, stdout: process.stdout, stderr: process.stderr }),
    )
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
