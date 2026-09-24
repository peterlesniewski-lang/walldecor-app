import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { jsPDF } from 'jspdf'
import sharp from 'sharp'
import { Prisma, type PrismaClient } from '@/generated/prisma'
import { privateMediaClientFromEnvironment, type PrivateMediaClient } from '@/lib/installation-media/client'
import { AcceptanceProtocolError, type AcceptanceResult, type AcceptanceSnapshot } from './acceptance-protocol'
import { formatWarsawDateTime } from './visit-time'

export type AcceptancePdfKind = 'ACCEPTANCE' | 'UNILATERAL'
const fontPath = path.join(process.cwd(), 'src/lib/installations/fonts/SplineSans-wght.ttf')
let fontPromise: Promise<Buffer> | null = null
function fontBytes() { return fontPromise ??= readFile(fontPath) }
const resultNames = { DONE: 'Wykonano', PARTIAL: 'Wykonano częściowo', NOT_DONE: 'Nie wykonano' }
const decisionNames: Record<string, string> = { ACCEPTED: 'Odebrano bez uwag', ACCEPTED_WITH_REMARKS: 'Odebrano z uwagami', REFUSED: 'Odmowa odbioru', UNILATERAL: 'Brak odbioru klienta' }
const unilateralNames: Record<string, string> = { REFUSAL: 'Odmowa odbioru', ABSENT: 'Nieobecność klienta', NO_RESPONSE: 'Brak odpowiedzi na miejscu' }

type PdfPhoto = { id: string; originalFilename: string; contentType: string; byteSize: number | null; sha256: string | null }

async function photoThumbnail(media: Pick<PrivateMediaClient, 'download'>, file: PdfPhoto) {
  const response = await media.download(file.id, { byteSize: file.byteSize, sha256: file.sha256 })
  const source = Buffer.from(await response.arrayBuffer())
  return sharp(source).rotate().resize(640, 440, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer()
}

export async function renderAcceptancePdf(input: {
  snapshot: AcceptanceSnapshot
  results: AcceptanceResult[]
  status: string
  installerSignature: Uint8Array
  installerSignedAt: Date
  clientDecision: string | null
  clientFirstName: string | null
  clientLastName: string | null
  clientRelationship: string | null
  clientNote: string | null
  clientSignature: Uint8Array | null
  clientRespondedAt: Date | null
  unilateral: { reason: string; circumstances: string; signature: Uint8Array; signedAt: Date } | null
  contentHash: string
  clientResponseHash: string | null
  kind: AcceptancePdfKind
  photos: Array<{ name: string; bytes: Uint8Array }>
}) {
  const font = await fontBytes()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  doc.addFileToVFS('SplineSans.ttf', font.toString('base64'))
  doc.addFont('SplineSans.ttf', 'SplineSans', 'normal')
  doc.setFont('SplineSans', 'normal')
  const left = 18, right = 192, width = right - left
  let y = 0
  function newPage() { doc.addPage(); y = 22 }
  function need(height: number) { if (y + height > 272) newPage() }
  function text(value: string, size = 10, color: [number, number, number] = [27, 48, 41], lineHeight = 5.3) {
    doc.setFontSize(size); doc.setTextColor(...color)
    const lines = doc.splitTextToSize(value || '—', width) as string[]
    need(lines.length * lineHeight + 1)
    doc.text(lines, left, y)
    y += lines.length * lineHeight + 1
  }
  function label(value: string) { need(14); y += 5; text(value.toUpperCase(), 9, [151, 82, 30], 4.8) }
  function rule() { need(8); y += 2; doc.setDrawColor(203, 208, 197); doc.line(left, y, right, y); y += 5 }
  function signature(bytes: Uint8Array, name: string, date: Date, title: string) {
    need(49)
    label(title)
    doc.setDrawColor(170, 180, 169); doc.rect(left, y, 78, 28)
    doc.addImage(Buffer.from(bytes).toString('base64'), 'PNG', left + 2, y + 2, 74, 24)
    y += 32
    text(`${name} · ${formatWarsawDateTime(date)}`, 9)
  }

  doc.setFillColor(27, 48, 41)
  doc.rect(0, 0, 210, 49, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(9); doc.text('WALLDECOR  /  DOKUMENT MONTAŻOWY', left, 17)
  doc.setFontSize(20); doc.text(input.kind === 'UNILATERAL' ? 'Protokół jednostronny' : 'Protokół odbioru prac', left, 32)
  y = 59
  text(`${input.snapshot.orderNumber}  ·  ${input.snapshot.workType}`, 14)
  text(input.snapshot.address, 10)
  text(`Klient: ${input.snapshot.clientName}`, 10)
  text(`Wizyta: ${input.snapshot.visitStartsAt ? formatWarsawDateTime(input.snapshot.visitStartsAt) : 'data nieustalona'}`, 10)
  rule()
  label('Planowany i rzeczywisty zakres')
  for (const [index, item] of input.snapshot.items.entries()) {
    const result = input.results.find((entry) => entry.scopeId === item.scopeId)
    need(22)
    text(`${index + 1}. ${item.roomName} / ${item.scopeName}`, 11)
    if (item.products.length) text(`Produkty: ${item.products.map((product) => [product.name, product.code].filter(Boolean).join(' / ')).join('; ')}`, 9, [76, 92, 81])
    text(`Wynik: ${result ? resultNames[result.result] : 'Brak danych'}`, 10)
    if (result?.note) text(`Opis: ${result.note}`, 9)
    rule()
  }
  label('Stanowisko klienta')
  text(decisionNames[input.status] ?? 'Podpis wykonawcy', 11)
  if (input.clientFirstName && input.clientLastName) text(`Osoba: ${input.clientFirstName} ${input.clientLastName} (${input.clientRelationship ?? 'nie podano'})`, 9)
  if (input.clientNote) text(`Uwagi lub powód: ${input.clientNote}`, 9)
  if (input.kind === 'UNILATERAL' && input.unilateral) {
    text(`Przyczyna: ${unilateralNames[input.unilateral.reason] ?? input.unilateral.reason}`, 10)
    text(`Okoliczności: ${input.unilateral.circumstances}`, 9)
    text('Ten dokument jest oświadczeniem wykonawcy. Nie stanowi odbioru prac przez klienta.', 9, [138, 68, 26])
  } else if (input.status === 'UNILATERAL') {
    text('Brak podpisu klienta. Etap pozostaje otwarty.', 9, [138, 68, 26])
  }
  rule()
  signature(input.installerSignature, input.snapshot.installerName, input.installerSignedAt, 'Podpis wykonawcy pod zakresem prac')
  if (input.kind === 'UNILATERAL' && input.unilateral) signature(input.unilateral.signature, input.snapshot.installerName, input.unilateral.signedAt, 'Podpis wykonawcy pod protokołem jednostronnym')
  else if (input.clientSignature && input.clientRespondedAt) signature(input.clientSignature, `${input.clientFirstName} ${input.clientLastName}`, input.clientRespondedAt, 'Podpis klienta lub przedstawiciela')
  else { label('Podpis klienta'); text('Nie złożono podpisu klienta.', 9) }
  if (input.photos.length) {
    label('Zdjęcia dokumentacyjne')
    for (const [index, photo] of input.photos.entries()) {
      need(83)
      text(`${index + 1}. ${photo.name}`, 9)
      const metadata = await sharp(photo.bytes).metadata()
      const ratio = (metadata.width ?? 1) / (metadata.height ?? 1)
      const thumbWidth = Math.min(110, 65 * ratio)
      const thumbHeight = thumbWidth / ratio
      doc.addImage(Buffer.from(photo.bytes).toString('base64'), 'JPEG', left, y, thumbWidth, thumbHeight)
      y += thumbHeight + 7
    }
  }
  rule()
  text(`Skrót treści: ${input.contentHash}`, 7, [76, 92, 81])
  if (input.clientResponseHash) text(`Skrót odpowiedzi: ${input.clientResponseHash}`, 7, [76, 92, 81])
  for (let page = 1; page <= doc.getNumberOfPages(); page += 1) {
    doc.setPage(page)
    doc.setFontSize(8); doc.setTextColor(100, 111, 102)
    doc.text(`WallDecor · ${input.snapshot.orderNumber} · strona ${page}/${doc.getNumberOfPages()}`, left, 289)
  }
  return Buffer.from(doc.output('arraybuffer'))
}

export async function getOrCreateAcceptancePdf(db: PrismaClient, protocolId: string, kind: AcceptancePdfKind, media?: Pick<PrivateMediaClient, 'download'>) {
  const existing = await db.installationAcceptanceDocument.findUnique({ where: { protocolId_kind: { protocolId, kind } } })
  if (existing) return existing
  const protocol = await db.installationAcceptanceProtocol.findUnique({ where: { id: protocolId }, include: {
    photoFiles: { where: { status: 'READY', softDeletedAt: null }, orderBy: { createdAt: 'asc' } },
    unilateral: { include: { photoFiles: { where: { status: 'READY', softDeletedAt: null }, orderBy: { createdAt: 'asc' } } } },
  } })
  if (!protocol || !protocol.installerSignature || !protocol.installerSignedAt || !protocol.contentHash || !protocol.resultsJson) throw new AcceptanceProtocolError('NOT_FOUND', 'Nie znaleziono podpisanego protokołu.')
  if (kind === 'ACCEPTANCE' && !['ACCEPTED', 'ACCEPTED_WITH_REMARKS', 'REFUSED', 'UNILATERAL'].includes(protocol.status)) {
    throw new AcceptanceProtocolError('CONFLICT', 'PDF będzie dostępny po zakończeniu odpowiedzi klienta lub protokołu jednostronnego.')
  }
  if (kind === 'UNILATERAL' && (protocol.unilateral?.status !== 'SIGNED' || !protocol.unilateral.signature || !protocol.unilateral.signedAt || !protocol.unilateral.reason || !protocol.unilateral.circumstances)) {
    throw new AcceptanceProtocolError('CONFLICT', 'Protokół jednostronny nie został podpisany.')
  }
  const photoFiles = kind === 'UNILATERAL' ? protocol.unilateral!.photoFiles : protocol.photoFiles
  const photoMedia = photoFiles.length > 0 ? (media ?? privateMediaClientFromEnvironment()) : null
  const photos = photoMedia
    ? await Promise.all(photoFiles.map(async (file) => ({ name: file.originalFilename, bytes: await photoThumbnail(photoMedia, file) })))
    : []
  const bytes = await renderAcceptancePdf({
    snapshot: JSON.parse(protocol.snapshotJson) as AcceptanceSnapshot,
    results: JSON.parse(protocol.resultsJson) as AcceptanceResult[], status: protocol.status,
    installerSignature: protocol.installerSignature, installerSignedAt: protocol.installerSignedAt,
    clientDecision: protocol.clientDecision, clientFirstName: protocol.clientFirstName, clientLastName: protocol.clientLastName,
    clientRelationship: protocol.clientRelationship, clientNote: protocol.clientNote,
    clientSignature: protocol.clientSignature, clientRespondedAt: protocol.clientRespondedAt,
    unilateral: kind === 'UNILATERAL' ? { reason: protocol.unilateral!.reason!, circumstances: protocol.unilateral!.circumstances!, signature: protocol.unilateral!.signature!, signedAt: protocol.unilateral!.signedAt! } : null,
    contentHash: protocol.contentHash, clientResponseHash: protocol.clientResponseHash, kind, photos,
  })
  try {
    return await db.installationAcceptanceDocument.create({ data: { protocolId, kind, bytes, sha256: createHash('sha256').update(bytes).digest('hex') } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return db.installationAcceptanceDocument.findUniqueOrThrow({ where: { protocolId_kind: { protocolId, kind } } })
    throw error
  }
}
