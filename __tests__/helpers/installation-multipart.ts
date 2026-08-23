const boundary = '----walldecor-route-stream-boundary'

export function installationMultipartBody(
  fields: Record<string, string>,
  file: { filename: string; contentType: string; bytes: Uint8Array },
  chunkSize = 16 * 1024,
) {
  const encoder = new TextEncoder()
  const prefix = Object.entries(fields).map(([name, value]) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  ).join('') + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`
  const parts = [encoder.encode(prefix), file.bytes, encoder.encode(`\r\n--${boundary}--\r\n`)]
  let partIndex = 0
  let partOffset = 0
  let consumed = 0
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      while (partIndex < parts.length && partOffset >= parts[partIndex].byteLength) { partIndex += 1; partOffset = 0 }
      if (partIndex >= parts.length) { controller.close(); return }
      const part = parts[partIndex]
      const chunk = part.slice(partOffset, partOffset + chunkSize)
      partOffset += chunk.byteLength
      consumed += chunk.byteLength
      controller.enqueue(chunk)
    },
    cancel() { cancelled = true },
  }, { highWaterMark: 0 })
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
    consumed: () => consumed,
    cancelled: () => cancelled,
  }
}
