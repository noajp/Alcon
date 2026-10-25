// The analysis (operationsModel) writes its findings in English so its tests
// and the saved evidence read the same everywhere. This turns one finding into
// the reader's language at display time: each sentence shape maps to a
// dictionary key with its values, and the field names inside are translated too.

type Translate = (message: string, values?: Record<string, string | number>) => string;

const SHAPES: { pattern: RegExp; key: string; names: string[] }[] = [
  { pattern: /^The mapped column for (.+) no longer exists\.$/, key: 'The mapped column for {field} no longer exists.', names: ['field'] },
  { pattern: /^Map a column for (.+)\.$/, key: 'Map a column for {field}.', names: ['field'] },
  { pattern: /^(.+) requires a (.+) column\.$/, key: '{field} requires a {types} column.', names: ['field', 'types'] },
  { pattern: /^(.+) must be a finite number from 0 to (\d+)\.$/, key: '{field} must be a finite number from 0 to {max}.', names: ['field', 'max'] },
  { pattern: /^(.+) must be a valid YYYY-MM-DD date\.$/, key: '{field} must be a valid YYYY-MM-DD date.', names: ['field'] },
  { pattern: /^(.+) must be text\.$/, key: '{field} must be text.', names: ['field'] },
  { pattern: /^(.+) is missing\.$/, key: '{field} is missing.', names: ['field'] },
  { pattern: /^Close date (\S+) has passed; confirm the outcome or revise the date\.$/, key: 'Close date {date} has passed; confirm the outcome or revise the date.', names: ['date'] },
  { pattern: /^Next action was due (\S+); follow up and update the plan\.$/, key: 'Next action was due {date}; follow up and update the plan.', names: ['date'] },
  { pattern: /^(\d+) days since contact \(threshold (\d+)\); confirm progress\.$/, key: '{n} days since contact (threshold {threshold}); confirm progress.', names: ['n', 'threshold'] },
];

/** One issue or signal message from the analysis, in the reader's language. */
export function operationsText(message: string, t: Translate): string {
  for (const { pattern, key, names } of SHAPES) {
    const match = pattern.exec(message);
    if (!match) continue;
    return t(key, Object.fromEntries(names.map((name, index) => [name, name === 'field' ? t(match[index + 1]) : match[index + 1]])));
  }
  return t(message);
}
