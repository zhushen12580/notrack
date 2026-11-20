import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

const readmeUrl = new URL('../README.md', import.meta.url)

function section(readme, title) {
  const heading = `## ${title}\n`
  const start = readme.indexOf(heading)
  expect(start, `README must have an English ${title} section`).toBeGreaterThanOrEqual(0)
  const contentStart = start + heading.length
  const end = readme.indexOf('\n## ', contentStart)
  return readme.slice(contentStart, end < 0 ? undefined : end)
}

function commands(text) {
  return [...text.matchAll(/^```(?:sh|bash|shell)\n([\s\S]*?)^```/gm)]
    .flatMap(([, body]) => body.trim().split('\n'))
}

test('installation starts at an existing checkout with Node.js 20+ and npm', async () => {
  const readme = await readFile(readmeUrl, 'utf8')
  const installation = section(readme, 'Installation')
  expect(installation).toMatch(/Node\.js 20\+/)
  expect(installation).toMatch(/npm/)
  expect(installation).toMatch(/clone/i)
  expect(installation).toMatch(/repository page/i)
  expect(installation).toMatch(/root/)
  expect(commands(installation)).toEqual(['npm ci', 'npm run build'])
})

test('usage runs the built CLI from the checkout root', async () => {
  const readme = await readFile(readmeUrl, 'utf8')
  const usage = section(readme, 'Usage')
  expect(usage).toMatch(/root/)
  expect(commands(usage)).toEqual([
    'node dist/cli.js',
    'node dist/cli.js --json',
    'node dist/cli.js --fix --shell bash',
    'node dist/cli.js --help',
  ])
})

test('testing documents both suites after installation and usage', async () => {
  const readme = await readFile(readmeUrl, 'utf8')
  expect(commands(section(readme, 'Testing'))).toEqual(['npm test', 'npm run test:package'])
  expect(readme.indexOf('## Installation\n')).toBeLessThan(readme.indexOf('## Usage\n'))
  expect(readme.indexOf('## Usage\n')).toBeLessThan(readme.indexOf('## Testing\n'))
})

test('the README explains read-only scanning, visible settings and limited DNT support', async () => {
  const readme = await readFile(readmeUrl, 'utf8')
  expect(readme).toMatch(/read-only/i)
  expect(readme).toMatch(/review/i)
  expect(readme).toMatch(/visible settings/)
  expect(readme).toMatch(/DO_NOT_TRACK=1/)
  expect(readme).toMatch(/only tools whose rules explicitly support it/)
})

test('the final line is the required attribution', async () => {
  const readme = await readFile(readmeUrl, 'utf8')
  expect(readme.replace(/\r?\n$/, '').split(/\r?\n/).at(-1))
    .toBe('Built with Claude Code & Codex')
})

test('the environment reference covers scan controls and every bundled environment setting', async () => {
  const readme = await readFile(readmeUrl, 'utf8')
  expect(section(readme, 'Environment')).toContain('(.env.example)')
  const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8')
  expect(example).toContain('does not automatically')
  const catalog = JSON.parse(await readFile(new URL('../data/tools.json', import.meta.url), 'utf8'))
  const keys = ['DO_NOT_TRACK', 'NO_COLOR', 'XDG_CONFIG_HOME',
    ...catalog.flatMap(rule => rule.settings.filter(setting => setting.source === 'env').map(setting => setting.key))]
  for (const key of new Set(keys)) expect(example).toMatch(new RegExp(`^# ${key}=.+$`, 'm'))
})
