export default function ClientFormLoading() {
  return <main aria-busy="true" aria-label="Wczytywanie formularza" style={{ minHeight: '100vh', background: '#f6f1e9', padding: '28px max(16px, calc((100vw - 760px) / 2))' }}>
    <div style={{ height: 12, width: 94, background: '#e9dfd0', borderRadius: 99 }} />
    <div style={{ height: 64, maxWidth: 460, marginTop: 18, background: '#e9dfd0', borderRadius: 14 }} />
    <div style={{ height: 210, marginTop: 30, background: '#fffdf8', borderRadius: 18, border: '1px solid #dfd3c2' }} />
  </main>
}
