const RESPONSE_DELAY_MS = Math.max(
  0,
  Math.min(
    30_000,
    Number(process.env.COMMAND_RESPONSE_DELAY_MS ?? 5000)
  )
)

export async function waitCommandResponseDelay() {
  if (!RESPONSE_DELAY_MS) return
  await new Promise(resolve =>
    setTimeout(resolve, RESPONSE_DELAY_MS)
  )
}

export const commandResponseDelayMs = RESPONSE_DELAY_MS
