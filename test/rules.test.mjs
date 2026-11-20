import {test, expect} from 'vitest'
import {validateRules} from '../dist/rules.js'
import {rule} from './fixtures.mjs'
test('accepts complete rules and rejects duplicate IDs', () => {
  expect(validateRules([rule('a')])).toHaveLength(1)
  expect(() => validateRules([rule('a'), rule('a')])).toThrow()
})
test.each([
  {id: '../a'}, {name: ''}, {category: ''}, {platforms: ['invalid']}, {commands: ['../tool']},
  {commands: [], configPaths: []}, {configPaths: ['{home}/../secret']}, {configPaths: ['{other}/file']},
  {configPaths: ['{home}/a/../../file']}, {documentationUrl: 'http://example.com'}, {versionScope: ''},
  {defaultStatus: 'yes'}, {supportsDoNotTrack: 'yes'},
  {settings: [{source: 'env', key: 'A;bad', valueType: 'string', enabled: '0', disabled: '1'}]},
  {settings: [{source: 'config', path: '{home}/x', field: ['a'], valueType: 'boolean', enabled: true, disabled: false}]},
  {actions: [{type: 'env', key: 'BAD;KEY', value: '1'}]},
  {actions: [{type: 'command', program: '../bad', args: []}]},
  {actions: [{type: 'manual', instruction: 'x', shells: ['cmd']}]},
])('rejects malformed rule %j', patch => {
  expect(() => validateRules([rule('a', patch)])).toThrow()
})
