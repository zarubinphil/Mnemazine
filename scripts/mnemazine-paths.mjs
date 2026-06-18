import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Single source of truth for the live knowledge vault.
// Canon (per personal constitution structure.md): ~/Мозг.
// Override with --vault <path> or MNEMAZINE_VAULT. Fail loud when the resolved
// directory does not exist — silently writing into a missing/wrong tree loses data.
export const DEFAULT_VAULT = path.join(os.homedir(), 'Мозг')

export function resolveVault({ cli, env = process.env.MNEMAZINE_VAULT, requireExists = true } = {}) {
  const vault = path.resolve(cli || env || DEFAULT_VAULT)
  if (requireExists && !fsSync.existsSync(vault)) {
    throw new Error(
      `Vault not found: ${vault}\n` +
      `Set MNEMAZINE_VAULT or pass --vault <path>. Canon default is ~/Мозг.`,
    )
  }
  return vault
}
