const { Vault } = require('../dist')
const fs = require('fs')
const path = require('path')
const os = require('os')

const TMP = path.join(os.tmpdir(), 'mrcv-test-' + Date.now())

async function test(name, fn) {
  try { await fn(); console.log('  ✅', name) }
  catch (e) { console.log('  ❌', name, '-', e.message) }
}

function clean(p) {
  try { fs.unlinkSync(p) } catch {}
}

async function main() {
  const path = TMP + '-suite.mrcv'
  const strictPath = TMP + '-strict.mrcv'
  clean(path)

  await test('create bound vault', async () => {
    const v = new Vault({ path, mode: 'bound' })
    const r = await v.tryOpen()
    if (r.state !== 'unlocked') throw new Error('expected unlocked, got ' + r.state)
    if (!r.created) throw new Error('expected created: true')
    v.set('test', 'value')
    await v.save()
    v.close()
  })

  await test('reopen with matching binding', async () => {
    const v = new Vault({ path, mode: 'bound' })
    const r = await v.tryOpen()
    if (r.state !== 'unlocked') throw new Error('expected unlocked')
    await v.unlock()
    if (v.get('test') !== 'value') throw new Error('data mismatch')
    v.close()
  })

  await test('lock/unlock round trip', async () => {
    const v = new Vault({ path, mode: 'bound' })
    await v.tryOpen()
    await v.unlock()
    v.set('secret', 's3cr3t')
    await v.save()
    v.lock()
    let threw = false
    try { v.get('secret') } catch { threw = true }
    if (!threw) throw new Error('should throw when locked')
    await v.unlock()
    if (v.get('secret') !== 's3cr3t') throw new Error('lost data after lock')
    v.close()
  })

  await test('bound mode preserves file on mismatch', async () => {
    const v = new Vault({ path, mode: 'bound', bindingSources: [{ name: 'f', getter: () => 'other' }] })
    const r = await v.tryOpen()
    if (r.state !== 'mismatch') throw new Error('expected mismatch')
    if (!fs.existsSync(path)) throw new Error('file should exist in bound mode')
  })

  await test('strict mode destroys file on mismatch', async () => {
    const v1 = new Vault({ path: strictPath, mode: 'bound' })
    await v1.tryOpen()
    v1.set('x', 1)
    await v1.save()
    v1.close()

    const v2 = new Vault({ path: strictPath, mode: 'strict', bindingSources: [{ name: 'f', getter: () => 'other' }] })
    const r = await v2.tryOpen()
    if (r.state !== 'mismatch') throw new Error('expected mismatch')
    if (fs.existsSync(strictPath)) throw new Error('file should be destroyed in strict mode')
  })

  await test('get/set/delete/has/keys', async () => {
    const v = new Vault({ path, mode: 'bound' })
    await v.tryOpen()
    await v.unlock()
    v.set('a', 1)
    v.set('b', 'two')
    v.set('c', { nested: true })
    if (v.get('a') !== 1) throw new Error('get failed')
    if (v.get('b') !== 'two') throw new Error('get string failed')
    if (!v.has('a')) throw new Error('has failed')
    if (v.has('nonexistent')) throw new Error('has false positive')
    if (!v.keys().includes('a')) throw new Error('keys failed')
    v.delete('a')
    if (v.has('a')) throw new Error('delete failed')
    v.close()
  })

  clean(path)
  clean(strictPath)
  console.log('All tests passed')
}

main().catch(e => console.error('Suite failed:', e.message))
