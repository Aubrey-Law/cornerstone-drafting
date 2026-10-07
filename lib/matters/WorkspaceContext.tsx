'use client'
import { createContext, useContext } from 'react'
export const MatterWorkspaceContext = createContext<{ matterId: string | null; setMatterId: (id: string | null) => void } | null>(null)
export const useMatterWorkspaceContext = () => useContext(MatterWorkspaceContext)
