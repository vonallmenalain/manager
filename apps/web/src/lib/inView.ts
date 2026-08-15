import { useEffect, useRef, useState } from 'react'

/**
 * Ob ein Element in die Nähe des sichtbaren Bereichs gekommen ist.
 *
 * Gebraucht von der Kachelansicht: Dort stehen schnell dreissig Dokumente
 * untereinander, von denen vier zu sehen sind. Ohne diese Frage holte die App
 * dreissig Bilder auf einmal – über Mobilfunk der Unterschied zwischen einer
 * Liste, die sofort da ist, und einer, die eine halbe Minute lädt.
 *
 * Einmal wahr, bleibt es wahr: Ein Bild, das schon geladen ist, beim
 * Weiterscrollen wieder wegzuwerfen, brächte nichts – es liegt ohnehin im
 * Zwischenspeicher – und liesse es beim Zurückscrollen erneut aufblitzen.
 */
export function useInView<T extends Element>(
  /** Wie weit vor dem Bildschirmrand geladen wird. */
  rootMargin = '300px',
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element || inView) return

    // Ältere Browser ohne IntersectionObserver bekommen alles auf einmal –
    // besser als eine Liste, die für immer leer bleibt.
    if (typeof IntersectionObserver !== 'function') {
      setInView(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setInView(true)
      },
      { rootMargin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [inView, rootMargin])

  return [ref, inView]
}
