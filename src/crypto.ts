let sodium: any = null
let ready = false

async function ensureSodium(): Promise<void> {
  if (ready) return
  const libsodium = require('libsodium-wrappers-sumo')
  await libsodium.ready
  sodium = libsodium
  ready = true
}

export async function deriveKey(
  password: Buffer,
  salt: Buffer,
  memory: number = 256 * 1024 * 1024,
  iterations: number = 3,
): Promise<Buffer> {
  await ensureSodium()
  return Buffer.from(sodium.crypto_pwhash(32, password, salt, iterations, memory, sodium.crypto_pwhash_ALG_ARGON2ID13))
}

export async function encrypt(
  key: Buffer,
  plaintext: Buffer,
  additionalData?: Buffer,
  nonce?: Buffer,
): Promise<{ ciphertext: Buffer; nonce: Buffer; tag: Buffer }> {
  await ensureSodium()
  const n = nonce || Buffer.from(sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES))
  const combined = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, additionalData || null, null, n, key)
  const tagLen = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES
  return {
    ciphertext: Buffer.from(combined.slice(0, combined.length - tagLen)),
    nonce: n,
    tag: Buffer.from(combined.slice(combined.length - tagLen)),
  }
}

export async function decrypt(
  key: Buffer,
  ciphertext: Buffer,
  nonce: Buffer,
  tag: Buffer,
  additionalData?: Buffer,
): Promise<Buffer> {
  await ensureSodium()
  const combined = Buffer.concat([ciphertext, tag])
  try {
    return Buffer.from(sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, combined, additionalData || null, nonce, key))
  } catch {
    throw new Error('Decryption failed')
  }
}
