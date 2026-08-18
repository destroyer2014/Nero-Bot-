import {
  isDiskSpaceError,
  recoverDiskSpace
} from './diskGuard.js'
import { logRuntimeEvent } from './runtimeLog.js'

export function bindSafeCreds(
  sock,
  saveCreds,
  {
    instanceType = 'principal',
    instanceId = 'principal'
  } = {}
) {
  let queue = Promise.resolve()

  sock.ev.on('creds.update', update => {
    queue = queue
      .then(async () => {
        try {
          await saveCreds(update)
        } catch (error) {
          await logRuntimeEvent('auth', {
            event: 'creds-save-failed',
            instanceType,
            instanceId,
            error
          })

          if (!isDiskSpaceError(error)) throw error

          console.error(
            '[AUTH] Disco lleno al guardar credenciales; ' +
            'limpiando temporales y reintentando.'
          )

          await recoverDiskSpace({
            aggressive: true
          }).catch(() => {})

          await saveCreds(update)

          await logRuntimeEvent('auth', {
            event: 'creds-save-recovered',
            instanceType,
            instanceId
          })
        }
      })
      .catch(error => {
        console.error(
          '[AUTH] No pude guardar credenciales:',
          error?.message || error
        )
      })
  })
}
