import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '@/lib/apiClient';
import { AdminNicknameEditor } from './AdminNicknameEditor';

afterEach(cleanup);

vi.mock('@/lib/apiClient', () => ({ apiRequest: vi.fn() }));

const ada = { id: 'ada', display_name: 'Ada', nicknames: ['Ace'] };
const ben = { id: 'ben', display_name: 'Ben', nicknames: ['Bullseye'] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(apiRequest).mockResolvedValueOnce({ players: [ada, ben] });
});

async function selectBen() {
  await screen.findByRole('option', { name: 'Ben' });
  fireEvent.change(screen.getByLabelText('Player'), { target: { value: 'ben' } });
  return screen.getByLabelText('Nicknames for Ben');
}

describe('AdminNicknameEditor', () => {
  it('saves only the selected player and displays normalized nicknames', async () => {
    const onSaved = vi.fn();
    render(<AdminNicknameEditor onSaved={onSaved} />);
    const input = await selectBen();
    expect(input).toHaveValue('Bullseye');
    fireEvent.change(input, { target: { value: ' The Hammer,  B ' } });
    const updated = { ...ben, nicknames: ['The Hammer', 'B'] };
    vi.mocked(apiRequest).mockResolvedValueOnce({ player: updated });
    fireEvent.click(screen.getByRole('button', { name: 'Save nicknames' }));
    await screen.findByText('Nicknames saved for Ben.');
    expect(apiRequest).toHaveBeenLastCalledWith('/api/admin/players/ben', {
      method: 'PATCH', body: { nicknames: ' The Hammer,  B ' },
    });
    expect(input).toHaveValue('The Hammer, B');
    expect(onSaved).toHaveBeenCalledWith(updated);
    fireEvent.change(screen.getByLabelText('Player'), { target: { value: 'ada' } });
    expect(screen.getByLabelText('Nicknames for Ada')).toHaveValue('Ace');
  });

  it('allows all nicknames to be cleared', async () => {
    render(<AdminNicknameEditor onSaved={vi.fn()} />);
    fireEvent.change(await selectBen(), { target: { value: '' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ player: { ...ben, nicknames: [] } });
    fireEvent.click(screen.getByRole('button', { name: 'Save nicknames' }));
    await screen.findByRole('status');
    expect(apiRequest).toHaveBeenLastCalledWith('/api/admin/players/ben', { method: 'PATCH', body: { nicknames: '' } });
    expect(screen.getByLabelText('Nicknames for Ben')).toHaveValue('');
  });

  it('retains the draft after a rejected save so the admin can retry', async () => {
    const onSaved = vi.fn();
    render(<AdminNicknameEditor onSaved={onSaved} />);
    fireEvent.change(await selectBen(), { target: { value: 'B' } });
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Forbidden'));
    fireEvent.click(screen.getByRole('button', { name: 'Save nicknames' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
    expect(screen.getByLabelText('Nicknames for Ben')).toHaveValue('B');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save nicknames' })).toBeEnabled());
    expect(onSaved).not.toHaveBeenCalled();
  });
});
