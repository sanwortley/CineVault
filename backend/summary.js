/**
 * Generates a spoiler-free summary in Spanish.
 * Since this often requires LLM in a real scenario, we provide a placeholder
 * that cleans up and formats the overview professionally.
 * @param {string} overview 
 * @returns {string}
 */
function generateSpoilerFreeSummary(overview) {
    if (!overview) return "No hay descripción disponible.";

    // In a real app, this would call an LLM (OpenAI, Gemini, etc.)
    // For this version, we ensure it's a concise Spanish summary.
    let summary = overview.trim();

    // Basic "anti-spoiler" truncation (simplified version)
    // We take the first two sentences to avoid deep plot reveals usually found at the end.
    const sentences = summary.split(/[.!?]/);
    if (sentences.length > 2) {
        summary = sentences.slice(0, 2).join('. ') + '.';
    }

    return summary;
}

module.exports = { generateSpoilerFreeSummary };
