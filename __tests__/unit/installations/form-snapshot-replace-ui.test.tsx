import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { InstallationFormSnapshotPanel } from '@/components/installations/form-snapshot-panel'

afterEach(() => vi.unstubAllGlobals())
it('keeps the proposed choice on conflict and allows cancelling without changing the summary', async () => {
  const snapshot = { id: 'old', templateId: 't1', templateVersion: 1, schemaJson: JSON.stringify({ name: 'Pierwszy', questions: [] }) }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Formularz został zmieniony w innym oknie.' }), { status: 409 })))
  const selected = vi.fn()
  render(<InstallationFormSnapshotPanel orderId="o1" initialSnapshot={snapshot} publishedTemplates={[{ id: 't2', name: 'Drugi', version: 1 }]} canEdit isArchived={false} onSelected={selected} />)
  fireEvent.click(screen.getByRole('button', { name: 'Zmień formularz' }))
  fireEvent.change(screen.getByLabelText('Wersja formularza dla zlecenia'), { target: { value: 't2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Zapisz wybór formularza' }))
  expect(await screen.findByRole('alert')).not.toBeNull()
  expect((screen.getByLabelText('Wersja formularza dla zlecenia') as HTMLSelectElement).value).toBe('t2')
  expect(selected).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }))
  expect(screen.getByText('Pierwszy · wersja 1')).not.toBeNull()
})
it('explicitly replaces an unused choice with its current snapshot identity and updates the summary', async () => {
  const snapshot = { id: 'old', templateId: 't1', templateVersion: 1, schemaJson: JSON.stringify({ name: 'Pierwszy', questions: [] }) }
  const changed = { ...snapshot, id: 'new', templateId: 't2', schemaJson: JSON.stringify({ name: 'Drugi', questions: [] }) }
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(changed)))
  vi.stubGlobal('fetch', fetchMock)
  const selected = vi.fn()
  render(<InstallationFormSnapshotPanel orderId="o1" initialSnapshot={snapshot} publishedTemplates={[{ id: 't2', name: 'Drugi', version: 1 }]} canEdit isArchived={false} onSelected={selected} />)
  fireEvent.click(screen.getByRole('button', { name: 'Zmień formularz' }))
  fireEvent.change(screen.getByLabelText('Wersja formularza dla zlecenia'), { target: { value: 't2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Zapisz wybór formularza' }))
  await waitFor(() => expect(selected).toHaveBeenCalledWith(changed))
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ templateId: 't2', expectedSnapshotId: 'old' })
  expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
  expect(screen.getByText('Drugi · wersja 1')).not.toBeNull()
})
