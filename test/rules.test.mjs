import {test, expect} from 'vitest'
import {validateRules} from '../dist/rules.js'
import {rule} from './fixtures.mjs'
test('accepts complete rules and rejects duplicate IDs', () => {
  expect(validateRules([rule('a')])).toHaveLength(1)
  expect(() => validateRules([rule('a'), rule('a')])).toThrow()
})

test('accepts opt-out-only settings without inventing an enabled value', () => {
  const setting = {source: 'env', key: 'OPT_OUT', valueType: 'string', disabled: '1'}
  expect(validateRules([rule('a', {settings: [setting]})])).toHaveLength(1)
  for (const patch of [{disabled: undefined}, {enabled: 0}, {enabled: '1'}]) {
    expect(() => validateRules([rule('a', {settings: [{...setting, ...patch}]})])).toThrow()
  }
})

test('accepts typed opt-out aliases and rejects empty, mixed, overlapping or nonfinite values', () => {
  const setting = {source: 'env', key: 'OPT_OUT', valueType: 'string', disabled: ['1', 'true', 'yes']}
  expect(validateRules([rule('a', {settings: [setting]})])).toHaveLength(1)
  for (const patch of [
    {disabled: []}, {disabled: ['1', 1]}, {disabled: ['1', '1']}, {enabled: 'true'},
    {valueType: 'number', disabled: [0, Infinity]}, {valueType: 'number', disabled: [0], enabled: NaN},
  ]) {
    expect(() => validateRules([rule('a', {settings: [{...setting, ...patch}]})])).toThrow()
  }
})

test('presence conditions are environment-only and cannot declare value matches', () => {
  const setting = {source: 'env', key: 'OPT_OUT', valueType: 'presence'}
  expect(validateRules([rule('a', {settings: [setting]})])).toHaveLength(1)
  for (const patch of [{key: 'BAD;'}, {disabled: '1'}, {enabled: '0'},
    {source: 'config', path: '{home}/tool.json', field: ['off']}]) {
    expect(() => validateRules([rule('a', {configPaths: ['{home}/tool.json'], settings: [{...setting, ...patch}]})])).toThrow()
  }
})

test('any-disabled combination requires documented alternative sources and excludes ordered precedence', () => {
  const r = rule('a', {supportsDoNotTrack: true,
    settings: [{source: 'env', key: 'OPT_OUT', valueType: 'string', disabled: '1'}],
    combination: {mode: 'any-disabled', documentationUrl: 'https://example.com/combination'},
  })
  expect(validateRules([r])).toEqual([r])
  for (const patch of [
    {combination: {mode: 'any-disabled'}},
    {combination: {mode: 'any-disabled', documentationUrl: 'http://example.com'}},
    {combination: {mode: 'unsupported', documentationUrl: 'https://example.com'}},
    {supportsDoNotTrack: false},
    {precedence: {order: [0, 'dnt'], documentationUrl: 'https://example.com'}},
  ]) expect(() => validateRules([{...r, ...patch}])).toThrow()
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

test.each([
  {precedence: {order: [0], documentationUrl: 'https://example.com'}},
  {precedence: {order: ['dnt'], documentationUrl: 'https://example.com'}},
  {precedence: {order: [], documentationUrl: 'http://example.com'}},
  {applicability: {documentationUrl: 'https://example.com', conditions: []}},
  {applicability: {documentationUrl: 'https://example.com', conditions: [{source: 'env', key: 'BAD;', values: ['2']}]}},
  {applicability: {documentationUrl: 'https://example.com', conditions: [{source: 'config', path: '{home}/undeclared', field: ['version'], values: ['2']}]}},
])('rejects invalid precedence or applicability %j', patch => {
  expect(() => validateRules([rule('a', patch)])).toThrow()
})

test('accepts documented complete precedence and local applicability', () => {
  const r = rule('a', {supportsDoNotTrack: true,
    settings: [{source: 'env', key: 'OPT_OUT', valueType: 'string', enabled: '0', disabled: '1'}],
    precedence: {order: ['dnt', 0], documentationUrl: 'https://example.com/order'},
    applicability: {documentationUrl: 'https://example.com/scope', conditions: [{source: 'env', key: 'VERSION', values: ['2']}]},
  })
  expect(validateRules([r])).toEqual([r])
  for (const order of [[0, 0], [0], ['dnt', 2], ['0', 'dnt']]) {
    expect(() => validateRules([{...r, precedence: {...r.precedence, order}}])).toThrow()
  }
})
