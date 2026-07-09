# MRCV — MineRouter Crypto Vault

**Device-Bound Cryptocontainer**

[![CI](https://img.shields.io/github/actions/workflow/status/WooonderkinG33/MineRouter-MRCV/release.yml?branch=main&label=CI&logo=github)](https://github.com/WooonderkinG33/MineRouter-MRCV/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/@minerouter/mrcv?logo=npm)](https://www.npmjs.com/package/@minerouter/mrcv)
[![License](https://img.shields.io/npm/l/@minerouter/mrcv)](LICENSE)
[![Node](https://img.shields.io/node/v/@minerouter/mrcv)](package.json)
[![TypeScript](https://img.shields.io/badge/types-TypeScript-blue.svg)](src/)

```
XChaCha20-Poly1305 + Argon2id encrypted KV storage
Cryptographically bound to a device
```

---

## keytar is dead. safeStorage is unreliable. MRCV works.

**keytar** — archived by Microsoft in 2023. Native bindings (`node-gyp`) break on every Node/Electron upgrade.
**Electron safeStorage** — on Linux requires libsecret + D-Bus + running GNOME Keyring/KWallet. Fails silently on headless, minimal DE, immutable distros, and CI environments.

**MRCV** has zero OS dependencies:

- No D-Bus. No libsecret. No GNOME Keyring. No KWallet.
- Works on any Linux — with or without desktop environment
- Single binary `.mrcv` file — no OS keychain blobs
- WASM-based (libsodium) — no native bindings, no `node-gyp`

---

## Overview

Traditional encrypted files can be copied and opened anywhere if the decryption key is available. MRCV solves this by introducing **device binding** — a vault is cryptographically bound to the device it was created for and cannot be opened on any other machine.

```
┌──────────────────────────────────────────────┐
│  .mrcv file                                  │
│                                              │
│  Header (84 bytes, AEAD-protected)           │
│  ├─ BindingId (SHA-256 of device binding)    │
│  ├─ Salt + Nonce                             │
│  └─ Flags (mode, format)                     │
├──────────────────────────────────────────────┤
│  Payload (XChaCha20-Poly1305 encrypted JSON) │
└──────────────────────────────────────────────┘
```

**Key properties:**

- **Device-bound** — opens only on the device with matching BindingId
- **Two modes** — `bound` (error on mismatch, file preserved) or `strict` (self-destruct on mismatch)
- **No user passwords** — the encryption key is derived internally from the device binding
- **Single file** — everything in one `.mrcv` file
- **AEAD protected** — header is bound to ciphertext via Poly1305 tag

---

## Installation

```bash
npm install @minerouter/mrcv
```

**Dependencies:** `libsodium-wrappers-sumo` (WASM, cross-platform)

---

## Quick Start

```typescript
import { Vault } from '@minerouter/mrcv'

const vault = new Vault({ path: './secrets.mrcv', mode: 'strict' })
const result = await vault.tryOpen()

if (result.state === 'mismatch') {
  console.log('Wrong device — vault destroyed')
  process.exit(1)
}

await vault.unlock()

vault.set('private_key', 'ed25519:abc123...')
vault.set('api_token', 'ghp_xxxxxxxx')
vault.set('username', 'admin')

const key = vault.get<string>('private_key')
await vault.save()

vault.lock()
// ... later ...
await vault.unlock()
vault.close()
```

---

## Using with Electron

```typescript
import { Vault } from '@minerouter/mrcv'
import { app } from 'electron'
import path from 'path'

const vault = new Vault({
  path: path.join(app.getPath('userData'), 'storage.mrcv'),
  mode: 'strict',
})

// Keep vault operations in the main process only.
// Never expose decrypted keys to the renderer.
// Use IPC (contextBridge) to pass only non-sensitive data.
```

**Security note:** Always create and unlock the vault in the **main process**. The renderer (web page) should never have access to decrypted private keys. Use `contextBridge` + `ipcRenderer.invoke` to expose only specific values to the renderer.

---

## API Reference

### Constructor

```typescript
const vault = new Vault(config: VaultConfig)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `path` | `string` | — | Path to `.mrcv` file |
| `mode` | `'bound' \| 'strict'` | `'bound'` | Device binding mode |
| `bindingSources` | `BindingSource[]` | motherboard UUID + disk serial | Custom device binding sources |
| `memory` | `number` | `268435456` (256MB) | Argon2id memory cost |
| `iterations` | `number` | `3` | Argon2id time cost |

### tryOpen()

```typescript
const result = await vault.tryOpen()
// => { state: 'unlocked', created: boolean } | { state: 'mismatch' }
```

Never throws — returns `mismatch` on binding mismatch.

### unlock() / lock()

```typescript
await vault.unlock()   // Argon2id + XChaCha20-Poly1305 decrypt
vault.lock()           // zeros decrypted data from memory
```

### Data access

```typescript
vault.get<T>(key: string): T | null
vault.set(key: string, value: unknown): void
vault.delete(key: string): void
vault.has(key: string): boolean
vault.keys(): string[]
```

### save() / close() / destroy()

```typescript
await vault.save()
vault.close()
vault.destroy()        // close + delete .mrcv file
```

---

## Modes

### `bound` — safe binding

```typescript
new Vault({ path: 'data.mrcv', mode: 'bound' })
```

| Binding match | Result |
|---|---|
| ✅ Same device | Opens normally |
| ❌ Different device | `mismatch` — file preserved |

**Use for:** applications where accidental data loss is unacceptable.

### `strict` — self-destruct on mismatch

```typescript
new Vault({ path: 'data.mrcv', mode: 'strict' })
```

| Binding match | Result |
|---|---|
| ✅ Same device | Opens normally |
| ❌ Different device | `mismatch` — **file is deleted immediately** |

**Use for:** cryptocurrency wallets, private keys, seed phrases.

---

## .mrcv File Format

```
Offset  Size  Field
0       4     Magic "MRCV"
4       2     Version (1, LE)
6       2     Flags (LE)
                bit 0: STRICT mode
                bit 1: reserved (payload format)
8       16    Salt (Argon2id)
24      24    Nonce (XChaCha20)
48      32    BindingId (SHA-256)
80      4     Reserved
─────────────────
84      N     Ciphertext (XChaCha20-Poly1305)
+N      16    Poly1305 Tag (AEAD: AAD = entire header)
```

BindingId is stored in plaintext but covered by AEAD — any tampering with the header (including flags or BindingId) invalidates the authentication tag.

---

## Device Binding

### Default binding

```
BindingId = SHA-256(Motherboard UUID + System Disk Serial [+ MAC on VMs])
```

On **physical machines**, motherboard UUID + disk serial uniquely identify the device.
On **virtual machines**, motherboard UUID and disk serial are often identical across clones (same template). In this case, MAC address is automatically appended to the binding — MAC changes on each clone, differentiating instances.

### Platform sources

| Platform | Motherboard UUID | Disk Serial |
|---|---|---|
| **Linux** | `/sys/class/dmi/id/product_uuid` | `/sys/block/<disk>/device/serial` |
| **Windows** | `Get-CimInstance Win32_ComputerSystemProduct` | `Get-CimInstance Win32_DiskDrive` |
| macOS | `ioreg` (🔜) | `diskutil info` (🔜) |

### Custom binding

```typescript
import { Vault } from '@minerouter/mrcv'
import type { BindingSource } from '@minerouter/mrcv'

const myBinding: BindingSource[] = [
  { name: 'tpm', getter: () => readTpmPublicKey() },
  { name: 'usb_token', getter: () => readUsbTokenSerial() },
]
const vault = new Vault({ path: 'data.mrcv', bindingSources: myBinding })
```

---

## Security Model

### Protected against

| Threat | Protection |
|---|---|
| **File copied to another machine** | BindingId mismatch → cannot decrypt |
| **Vault copied from backup** | BindingId mismatch on different hardware |
| **Hex editor manipulation of flags** | AEAD tag covers entire header |
| **Offline brute force (stolen file)** | Argon2id (256MB, 3 passes) |
| **VM cloning** | MAC guard appended to binding on VMs |
| **Accidental vault access from wrong device** | `bound` → error; `strict` → self-destruct |

### NOT protected against

| Threat | Reason |
|---|---|
| **Malware on the same machine** | BindingId is available (same hardware) |
| **Physical device theft** | Attacker has full access to hardware |
| **OS-level compromise** | Same as above |

### VM cloning — details

MRCV detects virtualized environments (QEMU, VMware, VirtualBox, Hyper-V, Xen) and **automatically appends MAC address** to the binding. Since MAC changes on each VM clone, cloned instances produce different BindingIds and cannot open the same vault.

If you need additional binding sources in VM environments (e.g., a manually provisioned machine-specific identifier), use custom `bindingSources`.

```typescript
// Check if running in a VM
import { isVM } from '@minerouter/mrcv'
console.log(isVM()) // true or false
```

### MRCV vs alternatives

| | Plain JSON | OS Keychain | safeStorage | **MRCV** |
|---|---|---|---|---|
| **Encryption** | None | OS-managed | OS-managed | XChaCha20-Poly1305 |
| **Key derivation** | None | OS-managed | OS-managed | **Argon2id** (256MB) |
| **Device binding** | None | Tied to OS user | Tied to OS user | **Hardware Binding** |
| **Linux without DE** | ✅ | ❌ needs D-Bus | ❌ needs libsecret | **✅ always works** |
| **VM clone protection** | ❌ | ❌ | ❌ | **✅ MAC guard** |
| **Native bindings** | None | Requires OS | Electron built-in | **❌ none (WASM)** |
| **Dependencies** | None | Electron / OS | Electron | **WASM (libsodium)** |

---

## Cross-platform

| Feature | Linux | Windows | macOS |
|---|---|---|---|
| Default binding | ✅ DMI + sysfs | ✅ PowerShell (wmic fallback) | 🔜 IOKit + diskutil |
| VM guard (MAC) | ✅ sys_vendor + MAC | 🔜 | 🔜 |
| XChaCha20-Poly1305 | ✅ WASM | ✅ WASM | ✅ WASM |
| Argon2id | ✅ WASM | ✅ WASM | ✅ WASM |
| Filesystem | ✅ | ✅ | ✅ |

---

## Roadmap

- ✅ XChaCha20-Poly1305
- ✅ Argon2id (256MB, 3 passes)
- ✅ Device Binding
- ✅ Two modes (bound / strict)
- ✅ AEAD-protected header
- ✅ lock() / unlock()
- ✅ TypeScript
- ✅ VM clone protection (MAC guard)
- 🔜 macOS binding (IOKit)
- 🔜 Benchmark suite
- 🔜 Fuzz testing

---

## Platform Disclaimer

**Tested on:** Linux (Ubuntu 22.04+, kernel 6.8+).  
**Windows:** Compiles and passes core tests on Win10+. Full integration testing in progress.  
**macOS:** Binding support coming soon (IOKit + diskutil).

Windows and macOS users: feedback and bug reports are welcome.

---

## Why not...

### keytar?
Archived. `node-gyp` breaks on every platform/Node upgrade. Native bindings are a constant maintenance burden. MRCV uses WASM — zero native code.

### safeStorage?
On Linux, safeStorage wraps libsecret, which requires a running D-Bus session + GNOME Keyring or KWallet. In headless environments, CI, Docker, or minimal desktop setups (i3, sway, etc.), safeStorage silently fails.

### OS Keychain (DPAPI / Keychain)?
Proprietary formats, OS-specific, cannot be backed up as a single file, no device binding, no self-destruct.

---

## License

MIT
