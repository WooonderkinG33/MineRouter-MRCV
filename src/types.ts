export type Platform = 'linux' | 'win32' | 'darwin'

export type Mode = 'bound' | 'strict'

export const MODE_BOUND = 'bound' as const
export const MODE_STRICT = 'strict' as const

export const FLAG_STRICT = 0x0001
export const FLAG_PAYLOAD_CBOR = 0x0002

export type BindingSource = {
  name: string
  os?: Platform | Platform[]
  getter: () => string | Buffer
}

export type VaultConfig = {
  path: string
  mode?: Mode
  bindingSources?: BindingSource[]
  memory?: number
  iterations?: number
}

export type VaultData = Record<string, unknown>

export type OpenResult =
  | { state: 'unlocked'; created: boolean }
  | { state: 'mismatch' }
