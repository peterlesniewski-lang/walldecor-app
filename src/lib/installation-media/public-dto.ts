type PublicInstallationFile = {
  id: string
  originalFilename: string
  contentType: string
  byteSize: number | null
  sha256: string | null
  createdAt: Date | string
}

/** Explicit allowlist for anonymous responses. Never spread a database row. */
export function publicInstallationFileDto(file: PublicInstallationFile) {
  return {
    id: file.id,
    originalFilename: file.originalFilename,
    contentType: file.contentType,
    byteSize: file.byteSize,
    sha256: file.sha256,
    createdAt: file.createdAt instanceof Date ? file.createdAt.toISOString() : file.createdAt,
  }
}
