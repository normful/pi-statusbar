/**
 * pi-statusbar — Custom status bar for Pi
 *
 * Uses ctx.ui.setStatus() to show live stats in the footer:
 * - Context window % (gradient blue→pink)
 * - Git branch
 * - Tmux window ID (if in tmux)
 * - Message runtimes (4 slots, peach→purple gradient)
 *
 * /statusbar
 */

import type { ExtensionAPI, ExtensionContext, TurnEndEvent, TurnStartEvent } from '@mariozechner/pi-coding-agent'
import { execSync } from 'child_process'

const stats = {
  // Track message runtimes (most recent first)
  messageRuntimes: [] as number[],
  // Map of turnIndex -> start timestamp for tracking runtimes
  turnStartTimes: new Map<number, number>(),
}

// True Color ANSI utilities
function trueColor(red: number, green: number, blue: number): string {
  return `\x1b[38;2;${red};${green};${blue}m`;
}

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

// Context % gradient: blue → pink
const BLUE: [number, number, number] = [63, 94, 251];
const PINK: [number, number, number] = [252, 70, 107];

function interpolate2(
  factor: number,
  colorStart: [number, number, number],
  colorEnd: [number, number, number],
): [number, number, number] {
  return [
    Math.round(colorStart[0] + (colorEnd[0] - colorStart[0]) * factor),
    Math.round(colorStart[1] + (colorEnd[1] - colorStart[1]) * factor),
    Math.round(colorStart[2] + (colorEnd[2] - colorStart[2]) * factor),
  ];
}

function gradientColorContext(pct: number): string {
  const factor = Math.max(0, Math.min(1, pct / 100));
  const [red, green, blue] = interpolate2(factor, BLUE, PINK);
  return trueColor(red, green, blue);
}

// Message runtime colors (purple → mauve → coral → peach)
const MSG_COLORS = [
  [108, 91, 124],   // #6c5b7c - purple (oldest)
  [192, 108, 132],  // #c06c84 - mauve
  [246, 114, 128],  // #f67280 - coral
  [248, 181, 149],  // #f8b595 - peach (most recent)
];

function colorForMessageSlot(index: number): string {
  const colorIndex = Math.min(index, MSG_COLORS.length - 1);
  const [red, green, blue] = MSG_COLORS[colorIndex];
  return trueColor(red, green, blue);
}

function getGitBranch(): string {
  try { return execSync('git branch --show-current', { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' }).trim() }
  catch { return '' }
}

function getTmuxWindowId(): string | undefined {
  if (!process.env.TMUX) return undefined;
  try {
    const winId = execSync('tmux display-message -p \'#{window_id}\'', { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' }).trim();
    return winId;
  } catch {
    return undefined;
  }
}

function formatRuntime(seconds: number): string {
  if (seconds < 5) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.round(seconds)}s`;
}

function updateStatus(ctx: ExtensionContext) {
  const usage = ctx.getContextUsage?.();

  // Context %
  if (usage?.percent != null) {
    const pct = Math.round(usage.percent);
    const color = gradientColorContext(pct);
    ctx.ui.setStatus('sb-ctx', `${color}${pct}%${RESET}`);
  } else {
    ctx.ui.setStatus('sb-ctx', `${DIM}--%${RESET}`);
  }

  // Git branch
  {
    const branch = getGitBranch();
    if (branch) {
      ctx.ui.setStatus('sb-git', `${DIM}⎇ ${branch}${RESET}`);
    } else {
      ctx.ui.setStatus('sb-git', undefined);
    }
  }

  // Tmux window ID
  {
    const winId = getTmuxWindowId();
    if (winId) {
      ctx.ui.setStatus('sb-win', `${DIM}${winId}${RESET}`);
    } else {
      ctx.ui.setStatus('sb-win', undefined);
    }
  }

  // Message runtimes
  {
    const slots = ['sb-msg-1', 'sb-msg-2', 'sb-msg-3', 'sb-msg-4'];
    slots.forEach((slotId, slotIndex) => {
      const runtime = stats.messageRuntimes[slotIndex];
      if (runtime !== undefined) {
        const color = colorForMessageSlot(slotIndex);
        ctx.ui.setStatus(slotId, `${color}${formatRuntime(runtime)}${RESET}`);
      } else {
        ctx.ui.setStatus(slotId, undefined);
      }
    });
  }
}

export default function init(pi: ExtensionAPI) {

  pi.on('turn_start', (_event: TurnStartEvent, ctx: ExtensionContext) => {
    // Track turn start time by turnIndex
    stats.turnStartTimes.set(_event.turnIndex, _event.timestamp);
    updateStatus(ctx);
  });

  pi.on('turn_end', (_event: TurnEndEvent, ctx: ExtensionContext) => {
    // Calculate runtime for completed turn
    const startTime = stats.turnStartTimes.get(_event.turnIndex);
    if (startTime !== undefined) {
      const runtime = (Date.now() - startTime) / 1000;
      // Add to front of array, keep only 4
      stats.messageRuntimes.unshift(runtime);
      if (stats.messageRuntimes.length > 4) {
        stats.messageRuntimes.pop();
      }
      // Clean up
      stats.turnStartTimes.delete(_event.turnIndex);
    }
    updateStatus(ctx);
  });

  pi.on('session_start', (_event: any, ctx: ExtensionContext) => {
    stats.messageRuntimes = [];
    stats.turnStartTimes.clear();
    updateStatus(ctx);
  });

  pi.registerCommand('statusbar', {
    description: 'Show status bar status',
    handler: async (_args: string, ctx) => {
      ctx.ui.notify('Status bar ON', 'info');
    },
  });
}
