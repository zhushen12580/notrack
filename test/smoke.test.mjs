import { spawnSync } from 'node:child_process'
import { expect, test } from 'vitest'

test('the CLI prints help to stdout and exits successfully', () => {
  const result = spawnSync(process.execPath, ['dist/cli.js', '--help'], {
    encoding: 'utf8',
  })

  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('notrack')
  expect(result.stderr).toBe('')
})
