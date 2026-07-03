import { sendEmail } from './outbound-email'

export interface PasswordResetEmailInput {
  to: string
  name: string
  username: string | null
  temporaryPassword: string
  loginUrl: string
}

export async function sendPasswordResetEmail(input: PasswordResetEmailInput) {
  const usernameLine = input.username ? `Login: ${input.username}\n` : ''
  const text = [
    `Cześć ${input.name},`,
    '',
    'Wygenerowaliśmy tymczasowe hasło do panelu WallDecor.',
    '',
    usernameLine.trimEnd(),
    `Hasło tymczasowe: ${input.temporaryPassword}`,
    `Link do logowania: ${input.loginUrl}`,
    '',
    'Po zalogowaniu aplikacja poprosi Cię o ustawienie własnego hasła.',
    '',
    'Jeśli to nie Ty prosiłeś/prosiłaś o reset hasła, skontaktuj się z administratorem.',
  ].filter(Boolean).join('\n')

  const html = `
    <p>Cześć ${escapeHtml(input.name)},</p>
    <p>Wygenerowaliśmy tymczasowe hasło do panelu WallDecor.</p>
    <p>
      ${input.username ? `<strong>Login:</strong> ${escapeHtml(input.username)}<br>` : ''}
      <strong>Hasło tymczasowe:</strong> ${escapeHtml(input.temporaryPassword)}
    </p>
    <p><a href="${escapeHtml(input.loginUrl)}">Przejdź do logowania</a></p>
    <p>Po zalogowaniu aplikacja poprosi Cię o ustawienie własnego hasła.</p>
    <p>Jeśli to nie Ty prosiłeś/prosiłaś o reset hasła, skontaktuj się z administratorem.</p>
  `

  await sendEmail({
    to: input.to,
    subject: 'Reset hasła do panelu WallDecor',
    text,
    html,
  })
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
