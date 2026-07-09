import { decrypt, encrypt, deriveKey } from './crypto'
import { FLAG_STRICT, FLAG_PAYLOAD_CBOR } from './types'

const crypto = require('crypto')

const MAGIC = Buffer.from([0x4D, 0x52, 0x43, 0x56])
const VERSION = 1
const SALT_LEN = 16
const NONCE_LEN = 24
const BINDING_ID_LEN = 32
const HEADER_LEN = 84
const TAG_LEN = 16

export type VaultFile = {
  strict: boolean
  salt: Buffer
  nonce: Buffer
  bindingId: Buffer
  ciphertext: Buffer
  tag: Buffer
}

function buildHeader(file: VaultFile): Buffer {
  const buf = Buffer.alloc(HEADER_LEN)
  MAGIC.copy(buf, 0)
  buf.writeUInt16LE(VERSION, 4)
  let flags = 0
  if (file.strict) flags |= FLAG_STRICT
  buf.writeUInt16LE(flags, 6)
  file.salt.copy(buf, 8)
  file.nonce.copy(buf, 8 + SALT_LEN)
  file.bindingId.copy(buf, 8 + SALT_LEN + NONCE_LEN)
  return buf
}

export function readFile(path: string): VaultFile | null {
  const fs = require('fs')
  try {
    const buf = fs.readFileSync(path)
    if (buf.length < HEADER_LEN + TAG_LEN) return null
    if (!buf.slice(0, 4).equals(MAGIC)) return null
    const flags = buf.readUInt16LE(6)
    const salt = buf.slice(8, 8 + SALT_LEN)
    const nonce = buf.slice(8 + SALT_LEN, 8 + SALT_LEN + NONCE_LEN)
    const bindingId = buf.slice(8 + SALT_LEN + NONCE_LEN, 8 + SALT_LEN + NONCE_LEN + BINDING_ID_LEN)
    const tag = buf.slice(buf.length - TAG_LEN)
    const ciphertext = buf.slice(HEADER_LEN, buf.length - TAG_LEN)
    return { strict: (flags & FLAG_STRICT) !== 0, salt, nonce, bindingId, ciphertext, tag }
  } catch { return null }
}

export function bindingMatches(file: VaultFile, bindingId: Buffer): boolean {
  return bindingId.equals(file.bindingId)
}

export async function load(path: string, bindingId: Buffer): Promise<Record<string, unknown> | null> {
  const file = readFile(path)
  if (!file) return null
  const key = await deriveKey(bindingId, file.salt)
  const aad = buildHeader(file)
  try {
    const plaintext = await decrypt(key, file.ciphertext, file.nonce, file.tag, aad)
    return JSON.parse(plaintext.toString('utf8'))
  } catch { return null }
}

export async function save(
  path: string,
  data: Record<string, unknown>,
  bindingId: Buffer,
  strict: boolean,
): Promise<void> {
  const salt = crypto.randomBytes(SALT_LEN)
  const nonce = crypto.randomBytes(NONCE_LEN)
  const key = await deriveKey(bindingId, salt)
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8')
  const file: VaultFile = { strict, salt, nonce, bindingId, ciphertext: Buffer.alloc(0), tag: Buffer.alloc(0) }
  const aad = buildHeader(file)
  const { ciphertext, tag } = await encrypt(key, plaintext, aad, nonce)
  file.ciphertext = ciphertext
  file.tag = tag
  writeFile(path, file)
}

function writeFile(path: string, file: VaultFile): void {
  const header = buildHeader(file)
  const buf = Buffer.alloc(HEADER_LEN + file.ciphertext.length + TAG_LEN)
  header.copy(buf, 0)
  file.ciphertext.copy(buf, HEADER_LEN)
  file.tag.copy(buf, HEADER_LEN + file.ciphertext.length)
  require('fs').writeFileSync(path, buf)
}
