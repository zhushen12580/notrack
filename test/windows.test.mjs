import { expect, test, vi } from 'vitest'
import { scanWindows, queryRegistry, POLICY_KEYS, LOCAL_KEY } from '../dist/windows.js'

const found = (value, type = 'REG_DWORD') => ({kind: 'value', type, value})
function platform(values = {}, overrides = {}) {
  return {platform: 'win32', windowsRelease: '10.0.22631',
    readRegistry: vi.fn(async (key, name) => name === 'InstallationType' ? found('Client', 'REG_SZ') : values[key] ?? {kind: 'missing'}),
    ...overrides}
}
test.each(['linux', 'darwin'])('%s skips all reads', async os => {
  const p = platform({}, {platform: os})
  expect(await scanWindows(p)).toBeNull()
  expect(p.readRegistry).not.toHaveBeenCalled()
})
test.each([[0, 'disabled'], [1, 'disabled'], [3, 'enabled'], [2, 'unknown'], [9, 'unknown']])('local %i gives %s', async (value, status) => {
  expect((await scanWindows(platform({[LOCAL_KEY]: found(value)}))).status).toBe(status)
})
test('restrictive user policy overrides local and computer policy', async () => {
  const p = platform({[POLICY_KEYS[0]]: found(3), [POLICY_KEYS[1]]: found(1), [LOCAL_KEY]: found(3)})
  expect((await scanWindows(p)).status).toBe('disabled')
  expect(p.readRegistry.mock.calls.some(([key]) => key === LOCAL_KEY)).toBe(false)
})
test.each([{kind:'error'}, found(3), found(2), found('1', 'REG_SZ')])('unresolved policy never falls back: %j', async value => {
  const p = platform({[POLICY_KEYS[0]]: value, [LOCAL_KEY]: found(1)})
  expect((await scanWindows(p)).status).toBe('unknown')
  expect(p.readRegistry.mock.calls.some(([key]) => key === LOCAL_KEY)).toBe(false)
})
test('missing values, thrown timeout and unsupported versions stay unknown', async () => {
  expect((await scanWindows(platform())).status).toBe('unknown')
  expect((await scanWindows(platform({}, {windowsRelease:'6.1.7601'}))).status).toBe('unknown')
  expect((await scanWindows(platform({}, {readRegistry: async () => {throw Error('secret timeout')}}))).status).toBe('unknown')
  expect((await scanWindows(platform({}, {readRegistry: async () => found('Server', 'REG_SZ')}))).status).toBe('unknown')
})
test('registry adapter uses query arguments, native view, timeout and strict parsing', async () => {
  const run = vi.fn(async () => ({stdout:'\r\n    AllowTelemetry    REG_DWORD    0x1\r\n', stderr:''}))
  expect(await queryRegistry('HKLM\\key', 'AllowTelemetry', run)).toEqual(found(1))
  expect(run).toHaveBeenCalledWith('reg.exe', ['query', 'HKLM\\key', '/v', 'AllowTelemetry', '/reg:64'],
    expect.objectContaining({timeout:3000, shell:false}))
  for (const stdout of ['Other REG_DWORD 0x1', 'AllowTelemetry REG_DWORD 0x1 junk', 'AllowTelemetry REG_DWORD 0x1\nAllowTelemetry REG_DWORD 0x3']) {
    expect(await queryRegistry('key', 'AllowTelemetry', async () => ({stdout}))).toEqual({kind:'error'})
  }
})
test('only recognized not-found failure permits fallback', async () => {
  const fail = stderr => async () => {throw Object.assign(Error('private'), {code:1, stderr})}
  expect(await queryRegistry('key','value',fail('ERROR: The system was unable to find the specified registry key or value.'))).toEqual({kind:'missing'})
  for (const stderr of ['Access is denied.', '找不到指定的注册表项', '']) {
    expect(await queryRegistry('key','value',fail(stderr))).toEqual({kind:'error'})
  }
})
