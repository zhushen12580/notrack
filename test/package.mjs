import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  // Captured output can contain a real local scan. Never include it in failures.
  assert.ok(!result.error, `${command} could not complete (${result.error?.code})`)
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed (${result.signal ?? 'exit'})`)
  return result
}

function parseJson(output, label) {
  try {
    return JSON.parse(output)
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

await mkdir(join(root, 'test-results'), { recursive: true })
const temporary = await mkdtemp(join(root, 'test-results', 'package-'))

try {
  const packed = parseJson(run('npm', ['pack', '--json', '--pack-destination', temporary], root).stdout, 'npm pack output')
  assert.ok(Array.isArray(packed) && packed.length === 1, 'npm pack must produce one tarball')
  const files = packed[0].files.map(file => file.path)
  for (const required of ['dist/cli.js', 'data/tools.json', 'package.json']) {
    assert.ok(files.includes(required), `Tarball must include ${required}`)
  }
  assert.ok(files.every(path =>
    path.startsWith('dist/') || ['data/tools.json', 'package.json'].includes(path) || /^(readme|licen[cs]e)(\..*)?$/i.test(path),
  ), 'Tarball must contain only runtime files and package documentation')

  const installation = join(temporary, 'installation')
  await mkdir(installation)
  await writeFile(join(installation, 'package.json'), JSON.stringify({
    name: 'notrack-package-test',
    version: '1.0.0',
    private: true,
  }))
  const tarball = join(temporary, packed[0].filename)
  run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', tarball], installation)

  const installed = join(installation, 'node_modules', 'notrack')
  assert.ok(!(await lstat(installed)).isSymbolicLink(), 'Installation must unpack the tarball instead of linking the checkout')
  const manifest = parseJson(await readFile(join(installed, 'package.json'), 'utf8'), 'Installed manifest')
  assert.equal(manifest.bin?.notrack, 'dist/cli.js', 'Installed package must expose the notrack bin')
  const entry = join(installed, 'dist', 'cli.js')
  assert.ok((await readFile(entry, 'utf8')).startsWith('#!/usr/bin/env node\n'), 'Built entry must preserve its Node shebang')
  if (process.platform !== 'win32') {
    const bin = join(installation, 'node_modules', '.bin', 'notrack')
    assert.equal(await realpath(bin), await realpath(entry), 'Local bin must point to the installed CLI')
    await access(bin, constants.X_OK)
  }
  await access(join(installation, 'node_modules', 'jsonc-parser', 'package.json'))
  assert.equal(
    await readFile(join(installed, 'data', 'tools.json'), 'utf8'),
    await readFile(join(root, 'data', 'tools.json'), 'utf8'),
    'Installed package must include the complete built-in catalog',
  )

  const help = run('npx', ['--offline', 'notrack', '--help'], installation)
  assert.ok(help.stdout.includes('Usage: notrack'), 'Offline help must describe the installed CLI')
  assert.equal(help.stderr, '', 'Offline help must not print diagnostics')

  const version = run('npx', ['--offline', 'notrack', '--version'], installation)
  assert.equal(version.stdout, `${manifest.version}\n`, 'Offline CLI must read its installed package version')
  assert.equal(version.stderr, '', 'Offline version must not print diagnostics')

  const scanned = run('npx', ['--offline', 'notrack', '--json'], installation)
  assert.ok(scanned.stderr.length === 0, 'Offline scan must not print diagnostics')
  const report = parseJson(scanned.stdout, 'Offline scan output')
  assert.ok(report !== null && typeof report === 'object' && !Array.isArray(report), 'Offline scan must return an object')
  assert.deepEqual(Object.keys(report).sort(), ['doNotTrack', 'platform', 'schemaVersion', 'tools', 'windowsDiagnostics'])
  assert.ok(report.schemaVersion === 1, 'Offline scan must use schema version 1')
  assert.ok(typeof report.platform === 'string', 'Offline scan must include its platform')
  assert.ok(typeof report.doNotTrack === 'boolean', 'Offline scan must include its DNT flag')
  assert.ok(Array.isArray(report.tools), 'Offline scan must include a tools array')
  assert.ok(report.windowsDiagnostics === null || (
    typeof report.windowsDiagnostics === 'object' && !Array.isArray(report.windowsDiagnostics)
  ), 'Offline scan must include a diagnostics object or null')

  process.stdout.write('Package test passed: tarball contents, local bin, offline help, version and schema v1 JSON.\n')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
