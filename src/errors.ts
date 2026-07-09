export class MrcvError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'MrcvError'
  }
}

export function invalidMode(mode: string): MrcvError {
  return new MrcvError(`Invalid mode "${mode}". Use "bound" or "strict".`, 'ERR_INVALID_MODE')
}

export function invalidConfig(field: string): MrcvError {
  return new MrcvError(`Invalid config: ${field}`, 'ERR_INVALID_CONFIG')
}

export function bindingMismatch(): MrcvError {
  return new MrcvError('Device binding mismatch — vault cannot be opened on this device', 'ERR_BINDING_MISMATCH')
}

export function notOpen(): MrcvError {
  return new MrcvError('Vault is not open. Call vault.tryOpen() first', 'ERR_NOT_OPEN')
}

export function alreadyOpen(): MrcvError {
  return new MrcvError('Vault is already open', 'ERR_ALREADY_OPEN')
}

export function invalidFormat(): MrcvError {
  return new MrcvError('Invalid vault file format', 'ERR_INVALID_FORMAT')
}
