import type { Platform } from './platform.js'

export function emptyReport(platform: Platform) {
  return {
    schemaVersion: 1,
    platform: platform.platform,
    doNotTrack: platform.env.DO_NOT_TRACK === '1',
    tools: [],
    windowsDiagnostics: null,
  } as const
}
