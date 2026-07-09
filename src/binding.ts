import { execSync } from 'child_process'
import { networkInterfaces } from 'os'
import { readFileSync } from 'fs'
import type { BindingSource, Platform } from './types'

const PLATFORM: Platform = process.platform as Platform

function readFile(path: string): string {
  try { return readFileSync(path, 'utf8').trim() } catch { return '' }
}

function exec(cmd: string): string {
  try { return execSync(cmd, { timeout: 5000, encoding: 'utf8' }).trim() } catch { return '' }
}

// ── Motherboard UUID ──

function moboUuidLinux(): string {
  return readFile('/sys/class/dmi/id/product_uuid')
}

async function moboUuidWindows(): Promise<string> {
  const pwsh = exec('powershell -NoProfile -Command "Get-CimInstance Win32_ComputerSystemProduct | Select-Object -ExpandProperty UUID" 2>nul')
  if (pwsh) return pwsh
  const wmic = exec('wmic csproduct get uuid /format:value 2>nul').split('=').pop()
  return wmic || ''
}

// ── System disk serial ──

function getSystemDisk(): string {
  try {
    const mounts = readFile('/proc/self/mountinfo')
    for (const line of mounts.split('\n')) {
      if (line.includes(' / ')) {
        const parts = line.split(/\s+/)
        const path = parts[4]
        if (path.startsWith('/')) return path.replace('/dev/', '').replace(/p\d+$/, '').replace(/\d+$/, '')
      }
    }
  } catch {}
  return ''
}

function diskSerialLinux(): string {
  const disk = getSystemDisk()
  if (!disk) return ''
  return readFile('/sys/block/' + disk + '/device/serial')
}

async function diskSerialWindows(): Promise<string> {
  const result = exec('powershell -NoProfile -Command "Get-CimInstance Win32_DiskDrive | Select-Object -First 1 -ExpandProperty SerialNumber" 2>nul')
  if (result) return result.trim()
  const wmic = exec('wmic diskdrive get serialnumber /format:value 2>nul')
  const lines = wmic.split('\n').filter(Boolean)
  if (lines.length > 0) return lines[0].split('=').pop() || ''
  return ''
}

// ── VM detection + anti-clone guard ──

const VM_VENDORS = ['qemu', 'vmware', 'virtualbox', 'innotek', 'microsoft corporation', 'xen']

function detectVm(): boolean {
  const vendor = readFile('/sys/class/dmi/id/sys_vendor').toLowerCase()
  return VM_VENDORS.some(v => vendor.includes(v))
}

function getMac(): string {
  const ifaces = networkInterfaces()
  for (const name of Object.keys(ifaces).sort()) {
    for (const iface of ifaces[name] || []) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        return iface.mac.replace(/:/g, '').toLowerCase()
      }
    }
  }
  return ''
}

let vmCache: boolean | null = null

export function isVM(): boolean {
  if (vmCache === null) vmCache = detectVm()
  return vmCache
}

// ── Source definitions (async-compatible wrappers) ──

export const BINDING_SOURCES: BindingSource[] = [
  { name: 'mobo_uuid', os: 'linux', getter: moboUuidLinux },
  { name: 'disk_serial', os: 'linux', getter: diskSerialLinux },
]

export function getWindowsSources(): { name: string; getter: () => Promise<string> }[] {
  return [
    { name: 'mobo_uuid', getter: moboUuidWindows },
    { name: 'disk_serial', getter: diskSerialWindows },
  ]
}

function matchOs(source: BindingSource): boolean {
  if (!source.os) return true
  const targets = Array.isArray(source.os) ? source.os : [source.os]
  return targets.includes(PLATFORM)
}

export async function computeBinding(sources?: BindingSource[]): Promise<Buffer> {
  const list = (sources || BINDING_SOURCES).filter(s => matchOs(s))
  const crypto = require('crypto')
  const hash = crypto.createHash('sha256')
  let hasData = false

  for (const s of list) {
    let val: string | Buffer = ''
    try { val = await Promise.resolve(s.getter()) } catch {}
    if (val) hasData = true
    hash.update(val || '')
    hash.update('|')
  }

  // Windows async sources
  if (PLATFORM === 'win32') {
    for (const s of getWindowsSources()) {
      let val = ''
      try { val = await Promise.resolve(s.getter()) } catch {}
      if (val) hasData = true
      hash.update(val || '')
      hash.update('|')
    }
  }

  // VM guard: on cloned VMs, motherboard UUID + disk serial are identical.
  // MAC address changes on clone → this differentiates cloned instances.
  if (process.platform === 'linux' && isVM()) {
    const mac = getMac()
    if (mac) {
      hash.update(mac)
      hash.update('|')
    }
  }

  if (!hasData) hash.update(PLATFORM)
  return hash.digest()
}

export function getDefaultBinding(): BindingSource[] {
  return BINDING_SOURCES.filter(s => matchOs(s))
}

export function getPlatform(): Platform {
  return PLATFORM
}
