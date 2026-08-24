import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstallationFormRevisionPanel } from '@/components/installations/form-revision-panel'

const revision = {
  formSubmissionId: 'submission-1',
  revisionNumber: 1,
  status: 'SUBMITTED',
  submittedAt: '2026-08-23T10:30:00.000Z',
  templateVersion: 1,
  questions: [
    { key: 'drzwi_ukryte', type: 'YES_NO_UNKNOWN' as const, label: 'Czy są drzwi ukryte?', required: true },
    { key: 'zdjecie', type: 'FILE' as const, label: 'Zdjęcie referencyjne' },
    { key: 'brak-pliku', type: 'FILE' as const, label: 'Plan pomieszczenia' },
  ],
  answers: [{
    questionKey: 'drzwi_ukryte',
    label: 'Czy są drzwi ukryte?',
    type: 'YES_NO_UNKNOWN' as const,
    value: 'NO',
    displayValue: 'Nie',
    isUnknown: false,
  }],
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('InstallationFormRevisionPanel', () => {
  it('shows readable historical rows and previews the immutable client layout without network or mutation controls', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<InstallationFormRevisionPanel revisions={[revision]} files={[]} />)

    expect(screen.getByText('Czy są drzwi ukryte?')).not.toBeNull()
    expect(screen.getByText('Nie')).not.toBeNull()
    expect(screen.queryByText('drzwi_ukryte')).toBeNull()
    const opener = screen.getByRole('button', { name: 'Podgląd jak klient · wersja 1' })
    await user.click(opener)

    expect(screen.getByText('Podgląd jak klient · wersja 1')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Wyślij formularz' })).toBeNull()
    expect(screen.queryByText('Wybierz plik')).toBeNull()
    expect(screen.queryByText('drzwi_ukryte')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Zamknij podgląd' }))
    expect(document.activeElement).toBe(opener)
  })

  it('uses only exact READY file metadata for a revision preview and otherwise keeps files in documents', async () => {
    const user = userEvent.setup()
    render(<InstallationFormRevisionPanel revisions={[revision]} files={[
      { id: 'file-ready', formSubmissionId: 'submission-1', questionKey: 'zdjecie', originalFilename: 'właściwy.pdf', status: 'READY', softDeletedAt: null },
      { id: 'file-old', formSubmissionId: 'submission-old', questionKey: 'zdjecie', originalFilename: 'stary.pdf', status: 'READY', softDeletedAt: null },
      { id: 'file-deleted', formSubmissionId: 'submission-1', questionKey: 'zdjecie', originalFilename: 'usunięty.pdf', status: 'READY', softDeletedAt: '2026-08-23T11:00:00.000Z' },
    ]} />)

    await user.click(screen.getByRole('button', { name: 'Podgląd jak klient · wersja 1' }))

    expect(screen.getByText('właściwy.pdf')).not.toBeNull()
    expect(screen.queryByText('stary.pdf')).toBeNull()
    expect(screen.queryByText('usunięty.pdf')).toBeNull()
    expect(screen.getByText('Pliki są zapisane w sekcji dokumentów')).not.toBeNull()
  })

  it('keeps labels from two immutable revisions instead of replacing the old schema with the new one', () => {
    render(<InstallationFormRevisionPanel revisions={[
      revision,
      {
        ...revision,
        formSubmissionId: 'submission-2',
        revisionNumber: 2,
        templateVersion: 2,
        questions: [{ key: 'drzwi_ukryte', type: 'YES_NO_UNKNOWN', label: 'Czy drzwi są ukryte po zmianie?' }],
        answers: [{ ...revision.answers[0], label: 'Czy drzwi są ukryte po zmianie?' }],
      },
    ]} files={[]} />)

    expect(screen.getByText('Czy są drzwi ukryte?')).not.toBeNull()
    expect(screen.getByText('Czy drzwi są ukryte po zmianie?')).not.toBeNull()
  })

  it('associates each revision disclosure with its preview and moves focus into the active preview', async () => {
    const user = userEvent.setup()
    const newerRevision = { ...revision, formSubmissionId: 'submission-2', revisionNumber: 2 }
    render(<InstallationFormRevisionPanel revisions={[revision, newerRevision]} files={[]} />)

    const firstOpener = screen.getByRole('button', { name: 'Podgląd jak klient · wersja 1' })
    const secondOpener = screen.getByRole('button', { name: 'Podgląd jak klient · wersja 2' })
    await user.click(secondOpener)

    const preview = screen.getByRole('region', { name: 'Podgląd formularza klienta, wersja 2' })
    expect(secondOpener.getAttribute('aria-controls')).toBe(preview.id)
    expect(firstOpener.getAttribute('aria-controls')).not.toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Zamknij podgląd' }))
  })

  it('renders two same-name files without a duplicate React key warning', async () => {
    const user = userEvent.setup()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<InstallationFormRevisionPanel revisions={[revision]} files={[
      { id: 'file-1', formSubmissionId: 'submission-1', questionKey: 'zdjecie', originalFilename: 'ściana.pdf', status: 'READY', softDeletedAt: null },
      { id: 'file-2', formSubmissionId: 'submission-1', questionKey: 'zdjecie', originalFilename: 'ściana.pdf', status: 'READY', softDeletedAt: null },
    ]} />)

    await user.click(screen.getByRole('button', { name: 'Podgląd jak klient · wersja 1' }))

    expect(screen.getAllByText('ściana.pdf')).toHaveLength(2)
    expect(consoleError.mock.calls.some(([message]) => String(message).includes('same key'))).toBe(false)
  })
})
