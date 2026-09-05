// Validate an explicit narrative before any board access can occur.
export function readReportPost(args, readText) {
  const index = args.indexOf('--post')
  if (index === -1) return null
  const path = args[index + 1]
  if (!path || path.startsWith('--')) {
    throw new Error('--post requires a UTF-8 file containing a decision or retrospective; view current state in Campaign Situation / Risk')
  }
  const authorIndex = args.indexOf('--author')
  const author = authorIndex === -1 ? '' : (args[authorIndex + 1] ?? '').trim()
  if (!author || author.startsWith('--')) throw new Error('--post requires --author NAME')
  const content = readText(path).trim()
  if (!content) throw new Error('--post file must not be empty')
  return { author, content }
}
