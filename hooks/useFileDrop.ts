'use client'

import { useCallback, useRef, useState } from 'react'
import type { DragEvent } from 'react'

/**
 * Drag-and-drop file handling for an upload surface.
 *
 * Spread `dropProps` onto the container that should accept drops and use
 * `isDragging` to render the highlight. The container still needs its own
 * click-to-browse input — this only adds the drop path.
 */
export function useFileDrop(onFiles: (files: FileList) => void | Promise<void>, disabled = false) {
  const [isDragging, setIsDragging] = useState(false)
  // dragenter/dragleave fire for every child element the pointer crosses, so a
  // naive boolean flickers the highlight off the moment the cursor moves over a
  // table row. Counting enters against leaves keeps it stable.
  const depth = useRef(0)

  const carriesFiles = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files')

  const reset = useCallback(() => {
    depth.current = 0
    setIsDragging(false)
  }, [])

  const onDragEnter = useCallback((event: DragEvent) => {
    if (disabled || !carriesFiles(event)) return
    event.preventDefault()
    depth.current += 1
    setIsDragging(true)
  }, [disabled])

  const onDragOver = useCallback((event: DragEvent) => {
    if (disabled || !carriesFiles(event)) return
    // Without preventDefault on dragover the browser treats the drop as a
    // navigation and opens the file in the tab instead of handing it over.
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [disabled])

  const onDragLeave = useCallback((event: DragEvent) => {
    if (disabled || !carriesFiles(event)) return
    event.preventDefault()
    depth.current -= 1
    if (depth.current <= 0) reset()
  }, [disabled, reset])

  const onDrop = useCallback((event: DragEvent) => {
    if (disabled || !carriesFiles(event)) return
    event.preventDefault()
    reset()
    const files = event.dataTransfer?.files
    if (files && files.length > 0) void onFiles(files)
  }, [disabled, onFiles, reset])

  return {
    isDragging,
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
