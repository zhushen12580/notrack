import type { Stats } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'

export interface Platform {
  platform: NodeJS.Platform
  home: string
  env: Readonly<NodeJS.ProcessEnv>
  stdoutIsTTY: boolean
  stat(path: string): Promise<Stats>
  access(path: string, mode?: number): Promise<void>
  readFile(path: string, encoding: 'utf8'): Promise<string>
  readRegistry(key: string, valueName: string): Promise<string>
}

export function createPlatform(): Platform {
  return {
    platform: process.platform,
    home: homedir(),
    env: process.env,
    stdoutIsTTY: process.stdout.isTTY === true,
    stat,
    access,
    readFile,
    async readRegistry() {
      throw new Error('Registry reads are unavailable')
    },
  }
}
