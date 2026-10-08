'use client'

import { createContext, useContext } from 'react'

/**
 * Lets nested workspaces avoid docking a second right rail beside the global
 * admin rail. The false default keeps standalone surfaces and tests unchanged.
 */
export const AdminRailVisibilityContext = createContext(false)

export function useAdminRailVisible(): boolean {
  return useContext(AdminRailVisibilityContext)
}
