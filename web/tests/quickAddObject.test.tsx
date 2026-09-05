/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuickAddObjectPopup } from '@/alcon/object/QuickAddObjectPopup';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const domains = [{id:'active',name:'Active domain'}, {id:'other',name:'Other domain'}];

it('keeps multi-domain selection and sends the active primary Domain first', async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  render(<QuickAddObjectPopup open onClose={()=>{}} onSubmit={submit} domains={domains} defaultDomainId="active" />);
  fireEvent.keyDown(screen.getByRole('button', {name:'Active domain'}), {key:'Enter'});
  const other = await screen.findByRole('menuitemcheckbox', {name:'Other domain'});
  fireEvent.click(other);
  expect(screen.getByRole('menuitemcheckbox', {name:'Active domain'}).getAttribute('aria-checked')).toBe('true');
  expect(other.getAttribute('aria-checked')).toBe('true');
  fireEvent.keyDown(other, {key:'Escape'});
  const title = screen.getByPlaceholderText(/Object name/);
  fireEvent.change(title, {target:{value:'Shared response'}});
  fireEvent.keyDown(title, {key:'Enter'});
  await vi.waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({domainId:'active',domainIds:['active','other']})));
});

it('retains the input and shows the failure when creation rejects', async () => {
  vi.spyOn(console, 'error').mockImplementation(()=>{});
  const close=vi.fn();
  render(<QuickAddObjectPopup open onClose={close} onSubmit={async()=>{throw new Error('Connection lost');}} />);
  const title=screen.getByPlaceholderText(/Object name/) as HTMLTextAreaElement;
  fireEvent.change(title,{target:{value:'Keep this draft'}});
  fireEvent.keyDown(title,{key:'Enter'});
  expect((await screen.findByRole('alert')).textContent).toBe('Connection lost');
  expect(title.value).toBe('Keep this draft');
  expect(close).not.toHaveBeenCalled();
});

it('does not create a duplicate while the first submission is unresolved', async () => {
  let finish!: () => void;
  const submit=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const close=vi.fn();
  render(<QuickAddObjectPopup open onClose={close} onSubmit={submit} />);
  const title=screen.getByPlaceholderText(/Object name/);
  fireEvent.change(title,{target:{value:'One Object'}});
  act(()=>{fireEvent.keyDown(title,{key:'Enter'});fireEvent.keyDown(title,{key:'Enter'});});
  expect(submit).toHaveBeenCalledTimes(1);
  await act(async()=>finish());
  expect(close).toHaveBeenCalledTimes(1);
});
