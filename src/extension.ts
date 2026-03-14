/**
 * pi-statusbar — Custom status bar for Pi
 *
 * Uses ctx.ui.setStatus() to show live stats in the footer:
 * - Context window %
 * - Token count
 * - Estimated cost
 * - Git branch
 * - Uptime
 * - Message count
 *
 * /statusbar on|off|config
 */

import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from '@mariozechner/pi-coding-agent'
import { execSync } from 'child_process'

interface StatusConfig {
  showContext: boolean
  showTokens: boolean
  showCost: boolean
  showGit: boolean
  showUptime: boolean
  showMsgCount: boolean
}

const config: StatusConfig = {
  showContext: true,
  showTokens: true,
  showCost: true,
  showGit: true,
  showUptime: true,
  showMsgCount: true,
}

const stats = {
  startedAt: Date.now(),
  messages: 0,
  inputTokens: 0,
  outputTokens: 0,
  enabled: true,
}

function getGitBranch(): string {
  try { return execSync('git branch --show-current', { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' }).trim() }
  catch { return '' }
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function estimateCost(): string {
  // Rough estimate: $3/M input, $15/M output (Sonnet-level)
  const cost = (stats.inputTokens * 3 + stats.outputTokens * 15) / 1_000_000
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toFixed(2)}`
}

function uptimeStr(): string {
  const s = Math.round((Date.now() - stats.startedAt) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
}

function updateStatus(ctx: ExtensionContext) {
  if (!stats.enabled) {
    ctx.ui.setStatus('sb-ctx', undefined)
    ctx.ui.setStatus('sb-tok', undefined)
    ctx.ui.setStatus('sb-cost', undefined)
    ctx.ui.setStatus('sb-git', undefined)
    ctx.ui.setStatus('sb-up', undefined)
    ctx.ui.setStatus('sb-msg', undefined)
    return
  }

  const usage = ctx.getContextUsage?.()

  if (config.showContext && usage?.percent != null) {
    const pct = Math.round(usage.percent)
    const icon = pct > 90 ? '🔴' : pct > 70 ? '🟡' : '🟢'
    ctx.ui.setStatus('sb-ctx', `${icon}${pct}%`)
  }

  if (config.showTokens) {
    const total = stats.inputTokens + stats.outputTokens
    ctx.ui.setStatus('sb-tok', `📊${fmtNum(total)}`)
  }

  if (config.showCost) {
    ctx.ui.setStatus('sb-cost', `💰${estimateCost()}`)
  }

  if (config.showGit) {
    const branch = getGitBranch()
    if (branch) ctx.ui.setStatus('sb-git', `⎇ ${branch}`)
    else ctx.ui.setStatus('sb-git', undefined)
  }

  if (config.showUptime) {
    ctx.ui.setStatus('sb-up', `⏱${uptimeStr()}`)
  }

  if (config.showMsgCount) {
    ctx.ui.setStatus('sb-msg', `💬${stats.messages}`)
  }
}

export default function init(pi: ExtensionAPI) {

  pi.on('message_end', (event: any, ctx: ExtensionContext) => {
    stats.messages++
    const msg = event.message as any
    if (msg?.usage) {
      stats.inputTokens += msg.usage.input_tokens || 0
      stats.outputTokens += msg.usage.output_tokens || 0
    }
    updateStatus(ctx)
  })

  pi.on('turn_end', (_event: TurnEndEvent, ctx: ExtensionContext) => {
    updateStatus(ctx)
  })

  pi.on('session_start', (_event: any, ctx: ExtensionContext) => {
    stats.startedAt = Date.now()
    updateStatus(ctx)
  })

  pi.registerCommand('statusbar', {
    description: 'Configure status bar — on/off/config',
    handler: async (args: string, ctx) => {
      const sub = args.trim().toLowerCase()

      if (sub === 'off') {
        stats.enabled = false
        updateStatus(ctx)
        ctx.ui.notify('Status bar OFF', 'info'); return
      }
      if (sub === 'on') {
        stats.enabled = true
        updateStatus(ctx)
        ctx.ui.notify('Status bar ON', 'info'); return
      }
      if (sub === 'config') {
        const options = [
          `Context %: ${config.showContext ? 'ON' : 'OFF'}`,
          `Tokens: ${config.showTokens ? 'ON' : 'OFF'}`,
          `Cost: ${config.showCost ? 'ON' : 'OFF'}`,
          `Git branch: ${config.showGit ? 'ON' : 'OFF'}`,
          `Uptime: ${config.showUptime ? 'ON' : 'OFF'}`,
          `Msg count: ${config.showMsgCount ? 'ON' : 'OFF'}`,
        ]
        const choice = await ctx.ui.select('Toggle status bar item', options)
        if (!choice) return
        if (choice.startsWith('Context')) config.showContext = !config.showContext
        else if (choice.startsWith('Tokens')) config.showTokens = !config.showTokens
        else if (choice.startsWith('Cost')) config.showCost = !config.showCost
        else if (choice.startsWith('Git')) config.showGit = !config.showGit
        else if (choice.startsWith('Uptime')) config.showUptime = !config.showUptime
        else if (choice.startsWith('Msg')) config.showMsgCount = !config.showMsgCount
        updateStatus(ctx)
        return
      }

      // Toggle
      stats.enabled = !stats.enabled
      updateStatus(ctx)
      ctx.ui.notify(stats.enabled ? 'Status bar ON' : 'Status bar OFF', 'info')
    },
  })
}
