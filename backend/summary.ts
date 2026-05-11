function generateSpoilerFreeSummary(overview: string | null | undefined): string {
  if (!overview) return 'No hay descripción disponible.'

  let summary = overview.trim()

  const sentences = summary.split(/[.!?]/)
  if (sentences.length > 2) {
    summary = sentences.slice(0, 2).join('. ') + '.'
  }

  return summary
}

export { generateSpoilerFreeSummary }
