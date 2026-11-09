import { describe, expect, it } from 'vitest';
import { fileResultRoute } from '@/Function/shared/attachments/openOwner';

describe('a picked file result lands on the file (⌘K)', () => {
  it('opens the Files view with the file open — at its latest version, not the found one', () => {
    // The found row was an older version; the resolved head is what opens,
    // because the Files list holds latest versions only.
    expect(fileResultRoute({ id: 'head-2' })).toEqual({ files: { fileId: 'head-2' } });
  });

  it('a file gone since it was found has no route — its host opens instead', () => {
    expect(fileResultRoute(null)).toBeNull();
  });
});
