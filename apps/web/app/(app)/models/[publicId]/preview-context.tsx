'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { MeshFormat } from '@/workers/mesh-loader.worker'

/** A file the rail can show: a mesh in the 3D viewer, or an image as it is. */
export type PreviewItem = {
  id: string
  filename: string
  kind: 'mesh' | 'image'
  /** For meshes only. */
  format?: MeshFormat
  size: number
  triangles: number | null
  dimensions: string | null
  /** For images: the picture itself. For meshes: a render to show while loading. */
  imageUrl: string | null
  canOpenInSlicer: boolean
}

type View = 'image' | 'model'

type PreviewState = {
  items: Map<string, PreviewItem>
  /** The mesh the 3D view shows, or loads when switched to. */
  meshId: string | null
  /** An image picked from the files; null shows the model's own artwork. */
  imageId: string | null
  view: View
  /** Whether the 3D view has been shown, so the viewer stays mounted after. */
  modelVisited: boolean
  setView: (view: View) => void
  /** Show a file in the rail. Files the rail cannot show are ignored. */
  show: (fileId: string) => void
  /** Whether the rail is currently showing this file. */
  isShowing: (fileId: string) => boolean
}

const PreviewContext = createContext<PreviewState | null>(null)

/**
 * What the rail beside the model page shows, shared with the files table so
 * that picking a row puts it in the viewer.
 */
export function PreviewProvider({
  items,
  initialMeshId,
  hasArtwork,
  children,
}: {
  items: PreviewItem[]
  initialMeshId: string | null
  /** With artwork to show, the rail starts on it and loads the mesh on request. */
  hasArtwork: boolean
  children: ReactNode
}) {
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const initialView: View = hasArtwork || !initialMeshId ? 'image' : 'model'
  const [meshId, setMeshId] = useState(initialMeshId)
  const [imageId, setImageId] = useState<string | null>(null)
  const [view, setViewState] = useState<View>(initialView)
  const [modelVisited, setModelVisited] = useState(initialView === 'model')

  const setView = useCallback((next: View) => {
    if (next === 'model') setModelVisited(true)
    setViewState(next)
  }, [])

  const show = useCallback(
    (fileId: string) => {
      const item = byId.get(fileId)
      if (!item) return
      if (item.kind === 'mesh') {
        setMeshId(item.id)
        setView('model')
      } else {
        setImageId(item.id)
        setView('image')
      }
    },
    [byId, setView],
  )

  const isShowing = useCallback(
    (fileId: string) => (view === 'model' ? meshId === fileId : imageId === fileId),
    [view, meshId, imageId],
  )

  const value = useMemo(
    () => ({ items: byId, meshId, imageId, view, modelVisited, setView, show, isShowing }),
    [byId, meshId, imageId, view, modelVisited, setView, show, isShowing],
  )

  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
}

export function usePreview(): PreviewState {
  const value = useContext(PreviewContext)
  if (!value) throw new Error('usePreview must be used inside PreviewProvider')
  return value
}
