/**
 * Shared email helper for notifications (favourite room available, etc.)
 */
function getTransporter() {
    const hasMail = !!(process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS);
    if (!hasMail) return null;
    const nodemailer = require('nodemailer');
    return nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        port: Number(process.env.MAIL_PORT) || 587,
        secure: process.env.MAIL_SECURE === 'true',
        auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    });
}

async function sendEmail(to, subject, text, html) {
    const transporter = getTransporter();
    if (!transporter) return false;
    try {
        await transporter.sendMail({
            from: process.env.MAIL_FROM || process.env.MAIL_USER,
            to,
            subject,
            text,
            html: html || text,
        });
        return true;
    } catch (err) {
        console.error('Send email error:', err);
        return false;
    }
}

module.exports = { getTransporter, sendEmail };
