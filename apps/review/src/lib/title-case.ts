/**
 * Title case for control labels: buttons, links and disclosure summaries.
 *
 * Every word is capitalised except articles, coordinating conjunctions and
 * short prepositions, which stay lower case unless they are the first or last
 * word. That is the style the console's headings already follow ("Keep an Eye
 * on It", "Send Alerts to Your Own System"), applied to the things people click.
 */

const MINOR = new Set([
  "a", "an", "the",
  "and", "but", "or", "nor", "for", "so", "yet",
  "as", "at", "by", "in", "of", "off", "on", "per", "to", "up", "via",
  "from", "into", "with", "over", "than",
]);

/** Words that are not written in title case at all: names, handles, codes. */
function exempt(word: string): boolean {
  return !/[a-z]/i.test(word) || /^[#@]/.test(word) || /[._/:]/.test(word) || /\d/.test(word);
}

export function toTitleCase(text: string): string {
  const words = text.split(/(\s+)/);
  const real = words.map((w, i) => ({ w, i })).filter(({ w }) => w.trim().length > 0);
  const first = real[0]?.i;
  const last = real[real.length - 1]?.i;
  return words
    .map((word, index) => {
      if (word.trim().length === 0 || exempt(word)) return word;
      const bare = word.replace(/^[^a-z]+|[^a-z']+$/gi, "").toLowerCase();
      if (index !== first && index !== last && MINOR.has(bare)) return word.toLowerCase();
      return word.replace(/[a-z]/i, (ch) => ch.toUpperCase());
    })
    .join("");
}

export function isTitleCase(text: string): boolean {
  return toTitleCase(text) === text;
}
