#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createPlatform, type Platform } from './platform.js'
import { emptyReport } from './report.js'

interface CliDependencies {
  platform: Platform
  loadRules(): Promise<unknown>
  stdout: Pick<NodeJS.WritableStream, 'write'>
  stderr: Pick<NodeJS.WritableStream, 'write'>
}

const shells = ['bash', 'zsh', 'fish', 'powershell']

const help = `notrack — local telemetry check for developer tools

Usage: notrack [options]

  --json            Print the scan report as JSON
  --fix             Print a shell snippet for opting out
  --shell <shell>   Shell for --fix (${shells.join(', ')})
  --color           Enable table colors
  --no-color        Disable table colors
  --help            Show this help message
  --version         Print the package version
`

function parseOptions(argv: readonly string[]) {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      json: { type: 'boolean' },
      fix: { type: 'boolean' },
      shell: { type: 'string' },
      color: { type: 'boolean' },
      'no-color': { type: 'boolean' },
      help: { type: 'boolean' },
      version: { type: 'boolean' },
    },
  })
  if (values.fix && values.json) {
    throw new Error('--fix and --json cannot be used together')
  }
  if (values.color && values['no-color']) {
    throw new Error('--color and --no-color cannot be used together')
  }
  if (values.shell !== undefined) {
    if (!values.fix) {
      throw new Error('--shell requires --fix')
    }
    if (!shells.includes(values.shell)) {
      throw new Error(`Invalid --shell value ${JSON.stringify(values.shell)}. Use ${shells.join(', ')}.`)
    }
  }
  return values
}

async function loadRules(): Promise<unknown> {
  return JSON.parse(await readFile(new URL('../data/tools.json', import.meta.url), 'utf8'))
}

export async function main(argv: readonly string[], deps: CliDependencies): Promise<number> {
  let options
  try {
    options = parseOptions(argv)
  } catch (error) {
    deps.stderr.write(`notrack: ${(error as Error).message}\n`)
    return 2
  }

  if (options.help) {
    deps.stdout.write(help)
    return 0
  }
  if (options.version) {
    try {
      const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
      if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
        throw new Error('Missing package version')
      }
      deps.stdout.write(`${manifest.version}\n`)
      return 0
    } catch {
      deps.stderr.write('notrack: Could not read the package version.\n')
      return 1
    }
  }

  try {
    if (!Array.isArray(await deps.loadRules())) {
      throw new Error('Expected an array of rules')
    }
  } catch {
    deps.stderr.write('notrack: Could not load telemetry rules.\n')
    return 1
  }

  if (options.json) {
    deps.stdout.write(`${JSON.stringify(emptyReport(deps.platform))}\n`)
  } else if (options.fix) {
    deps.stdout.write('# No telemetry opt-out suggestions.\n')
  } else {
    deps.stdout.write('Detected: 0  Enabled: 0  Disabled: 0  Unknown: 0\n')
  }
  return 0
}

function isDirectInvocation(entry: string | undefined): boolean {
  if (!entry) {
    return false
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isDirectInvocation(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2), {
    platform: createPlatform(),
    loadRules,
    stdout: process.stdout,
    stderr: process.stderr,
  })
}
