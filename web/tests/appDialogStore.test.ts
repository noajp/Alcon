import { afterEach, describe, expect, it } from 'vitest';
import { answerAppDialog, appDialog, cancelAppDialogs, getAppDialog, subscribeAppDialog } from '../src/Function/shared/appDialogStore';
afterEach(cancelAppDialogs);
describe('in-app dialogs', () => {
  it('fails closed when there is no dialog host', async () => {
    expect(await appDialog.confirm('Delete?')).toBe(false);
    expect(await appDialog.prompt('URL')).toBeNull();
  });
  it('keeps queued confirmations separate and ignores stale answers', async () => {
    const unsubscribe=subscribeAppDialog(()=>{});
    const first=appDialog.confirm('Delete Object A?');
    const id=getAppDialog()!.id;
    const second=appDialog.confirm('Delete Object B?');
    answerAppDialog(id,false);
    expect(await first).toBe(false);
    const next=getAppDialog()!.id;
    answerAppDialog(id,true);
    expect(getAppDialog()!.id).toBe(next);
    answerAppDialog(next,true);
    expect(await second).toBe(true);
    expect(getAppDialog()).toBeNull();unsubscribe();
  });
  it('cancels active and queued work on teardown', async () => {
    const unsubscribe=subscribeAppDialog(()=>{});
    const confirm=appDialog.confirm('Remove?');
    const prompt=appDialog.prompt('URL','https://');
    cancelAppDialogs();
    expect(await confirm).toBe(false);expect(await prompt).toBeNull();unsubscribe();
  });
  it('shows the same alert once while it is showing or waiting', async () => {
    const unsubscribe=subscribeAppDialog(()=>{});
    const first=appDialog.alert('Could not save.');
    const other=appDialog.alert('Something else.');
    const repeat=appDialog.alert('Could not save.');
    const again=appDialog.alert('Something else.');
    answerAppDialog(getAppDialog()!.id,null);
    await first;await repeat;
    expect(getAppDialog()?.message).toBe('Something else.');
    answerAppDialog(getAppDialog()!.id,null);
    await other;await again;
    expect(getAppDialog()).toBeNull();unsubscribe();
  });
  it('distinguishes a cancelled prompt from an entered value', async () => {
    const unsubscribe=subscribeAppDialog(()=>{});
    const result=appDialog.prompt('URL','https://');
    expect(getAppDialog()?.initialValue).toBe('https://');
    answerAppDialog(getAppDialog()!.id,'https://example.com');
    expect(await result).toBe('https://example.com');unsubscribe();
  });
});
