import { computeBinding, getDefaultBinding } from './binding'
import { readFile, load, save, bindingMatches } from './storage'
import type { VaultConfig, VaultData, BindingSource, OpenResult, Mode } from './types'
import { MODE_BOUND, MODE_STRICT } from './types'
import { notOpen, bindingMismatch, invalidMode, invalidConfig } from './errors'
import { existsSync, unlinkSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'

function defaultVaultPath(): string {
  const home = homedir()
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), '@minerouter', 'mrcv', 'storage.mrcv')
  }
  return join(home, '.config', '@minerouter', 'mrcv', 'storage.mrcv')
}

function ensureDir(filePath: string): void {
  try { mkdirSync(dirname(filePath), { recursive: true }) } catch {}
}

export class Vault {
  private path: string
  private bindingSources: BindingSource[]
  private mode: Mode
  private bindingId: Buffer | null = null
  private data: VaultData | null = null
  private _opened = false
  private _unlocked = false
  private memory: number
  private iterations: number

  constructor(config: VaultConfig) {
    if (!config || typeof config !== 'object') throw invalidConfig('config object required')

    this.path = config.path || defaultVaultPath()
    if (typeof this.path !== 'string' || !this.path) throw invalidConfig('path must be a non-empty string')

    this.bindingSources = config.bindingSources || getDefaultBinding()
    if (!Array.isArray(this.bindingSources)) throw invalidConfig('bindingSources must be an array')

    this.mode = MODE_BOUND
    if (config.mode !== undefined) {
      if (config.mode !== 'bound' && config.mode !== 'strict') throw invalidMode(config.mode)
      this.mode = config.mode
    }

    this.memory = typeof config.memory === 'number' && config.memory > 0 ? config.memory : 256 * 1024 * 1024
    this.iterations = typeof config.iterations === 'number' && config.iterations > 0 ? config.iterations : 3
  }

  async tryOpen(): Promise<OpenResult> {
    if (this._opened) throw new Error('Vault already open')

    this.bindingId = await computeBinding(this.bindingSources)

    if (!existsSync(this.path)) {
      return await this.createNew()
    }

    const file = readFile(this.path)
    if (!file || !bindingMatches(file, this.bindingId)) {
      if (this.mode === MODE_STRICT) this.destroy()
      return { state: 'mismatch' }
    }

    this._opened = true
    return { state: 'unlocked', created: false }
  }

  async unlock(): Promise<void> {
    if (!this._opened) throw notOpen()
    if (this._unlocked) return
    const existing = await load(this.path, this.bindingId!)
    if (existing === null) {
      if (this.mode === MODE_STRICT) this.destroy()
      throw bindingMismatch()
    }
    this.data = existing
    this._unlocked = true
  }

  lock(): void {
    this.data = null
    this._unlocked = false
  }

  private async createNew(): Promise<OpenResult> {
    this.data = {}
    this._opened = true
    this._unlocked = true
    await this.save()
    return { state: 'unlocked', created: true }
  }

  isOpen(): boolean { return this._opened }
  isUnlocked(): boolean { return this._unlocked }

  get<T = unknown>(key: string): T | null {
    this.ensureUnlocked()
    return (this.data![key] as T) ?? null
  }

  set(key: string, value: unknown): void {
    this.ensureUnlocked()
    this.data![key] = value
  }

  delete(key: string): void {
    this.ensureUnlocked()
    delete this.data![key]
  }

  has(key: string): boolean {
    this.ensureUnlocked()
    return key in this.data!
  }

  keys(): string[] {
    this.ensureUnlocked()
    return Object.keys(this.data!)
  }

  async save(): Promise<void> {
    if (!this.bindingId) throw new Error('Binding not computed')
    if (!this.data) this.data = {}
    if (!this._opened) this._opened = true
    if (!this._unlocked) this._unlocked = true
    ensureDir(this.path)
    await save(this.path, this.data, this.bindingId, this.mode === MODE_STRICT)
  }

  close(): void {
    this.lock()
    this._opened = false
  }

  destroy(): void {
    this.close()
    try { unlinkSync(this.path) } catch {}
  }

  getBindingId(): string | null {
    return this.bindingId ? this.bindingId.toString('hex') : null
  }

  getPath(): string { return this.path }

  getMode(): Mode { return this.mode }

  private ensureUnlocked(): void {
    if (!this._opened) throw notOpen()
    if (!this._unlocked) throw new Error('Vault is locked. Call vault.unlock() first')
  }
}
