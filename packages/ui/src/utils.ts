import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind class lists, later classes winning on conflict. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
