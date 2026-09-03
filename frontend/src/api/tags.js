// Mirror of `normalise_tag` in api/utils/tags.py.
//
// Used on exactly one path: the offline substring fallback in LinksView, which
// runs when semantic search is unavailable and there is no server response to
// filter. Everywhere else the server does the matching and topic keys arrive
// pre-normalised from GET /api/topics, so this is not on the primary path.
//
// If the two ever drift the cost is a slightly-wrong fallback list, never wrong
// stored data — but keep them in step anyway.
const SEPARATORS = /[ \t\n\r\f\v_]+/g;
const REPEATED_DASHES = /-{2,}/g;

export function normaliseTag(tag) {
  return String(tag)
    .trim()
    .toLowerCase()
    .replace(SEPARATORS, "-")
    .replace(REPEATED_DASHES, "-")
    .replace(/^-+|-+$/g, "");
}
