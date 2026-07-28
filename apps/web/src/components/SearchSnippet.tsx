import type { TextSnippet } from '@manager/shared'

/**
 * Zeigt die Fundstelle im erkannten Text und hebt den gesuchten Begriff hervor.
 *
 * Beantwortet in der Trefferliste die Frage „warum ist das ein Treffer?" –
 * besonders wenn der Begriff nirgends im Titel steht, sondern tief im Text
 * einer eingescannten Rechnung.
 */
export function SearchSnippet({ snippet }: { snippet: TextSnippet }) {
  const before = snippet.text.slice(0, snippet.matchStart)
  const match = snippet.text.slice(snippet.matchStart, snippet.matchEnd)
  const after = snippet.text.slice(snippet.matchEnd)

  return (
    <span className="mt-1 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
      {before}
      {match ? (
        <mark className="rounded bg-amber-200 px-0.5 text-slate-900 dark:bg-amber-500/40 dark:text-amber-100">
          {match}
        </mark>
      ) : null}
      {after}
    </span>
  )
}
