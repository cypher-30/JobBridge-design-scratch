// Milestone 4 stub: pluggable email sender interface.
// Swap ConsoleEmailSender for an SMTP/SES/Resend implementation without
// touching callers — they only depend on send({to, subject, text}).
class ConsoleEmailSender {
  async send({ to, subject, text }) {
    console.log(`[email:stub] to=${to} subject="${subject}"\n${text}`);
  }
}

export function getEmailSender() {
  // Future: switch on process.env.EMAIL_PROVIDER.
  return new ConsoleEmailSender();
}
