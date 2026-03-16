'use strict';
const nodemailer = require('nodemailer');

const transport = nodemailer.createTransport({
  host:   process.env.MAILER_HOST,
  port:   parseInt(process.env.MAILER_PORT || '587'),
  secure: process.env.MAILER_PORT === '465',
  auth: {
    user: process.env.MAILER_USER,
    pass: process.env.MAILER_PASS,
  }
});

const FROM = process.env.MAILER_FROM || `noreply@${process.env.APP_DOMAIN || 'segstation.org'}`;
const DOMAIN = process.env.APP_DOMAIN || 'segstation.org';

async function sendWelcome(email, tempPassword, orgName) {
  await transport.sendMail({
    from:    FROM,
    to:      email,
    subject: `Accès à SegStation — ${orgName}`,
    html: `
      <p>Bonjour,</p>
      <p>Votre compte SegStation pour <strong>${orgName}</strong> a été créé.</p>
      <p><strong>Email :</strong> ${email}<br>
         <strong>Mot de passe temporaire :</strong> <code>${tempPassword}</code></p>
      <p>Connectez-vous sur <a href="https://${DOMAIN}/login">https://${DOMAIN}/login</a></p>
      <p>Vous serez invité à changer votre mot de passe à la première connexion.</p>
      <p>— L'équipe SegStation</p>
    `
  });
}

async function sendPasswordReset(email, token) {
  const url = `https://${DOMAIN}/reset-password?token=${token}`;
  await transport.sendMail({
    from:    FROM,
    to:      email,
    subject: 'Réinitialisation de votre mot de passe SegStation',
    html: `
      <p>Une demande de réinitialisation a été effectuée pour ce compte.</p>
      <p><a href="${url}">Cliquez ici pour choisir un nouveau mot de passe</a></p>
      <p>Ce lien est valable 1 heure. Ignorez cet email si vous n'êtes pas à l'origine de cette demande.</p>
    `
  });
}

module.exports = { sendWelcome, sendPasswordReset };
