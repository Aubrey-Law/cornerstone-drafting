'use client'
import { createContext, useContext } from 'react'
import type { SidebarMattersState } from './useSidebarMatters'

/** The shell owns one fetch shared by both sidebars and the record switcher. */
export const SidebarMattersContext = createContext<SidebarMattersState | null>(null)
export const useSharedSidebarMatters = () => useContext(SidebarMattersContext)
