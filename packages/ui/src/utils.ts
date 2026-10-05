import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge only knows Tailwind's stock font sizes, so it reads the theme's
 * own `text-micro` / `text-compact` (tailwind-bridge.css) as text *colors* and
 * drops a real color beside them — `cn('text-primary-foreground', 'text-micro')`
 * lost the color, leaving e.g. a dark badge with dark text. Registering them as
 * font sizes keeps both.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['micro', 'compact'],
    },
  },
})

/** Merge Tailwind class lists, later classes winning on conflict. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
