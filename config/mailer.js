const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendMail({ to, subject, html }) {
  const { data, error } = await resend.emails.send({
    from: process.env.MAIL_FROM,
    to,
    subject,
    html
  });

  if (error) {
    throw new Error(error.message || JSON.stringify(error));
  }

  return data;
}

module.exports = { sendMail };