// api/subscribe.js — Capture email + stockage Vercel KV
// Reçoit : { email, nom_guerre, domaine, autosuggestion }
// Stocke dans Vercel KV pour les rappels cron

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, nom_guerre, domaine, autosuggestion } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email invalide' });
  }

  // ── Stockage Vercel KV ──
  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  if (KV_URL && KV_TOKEN) {
    try {
      const key = `sub:${email.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const payload = {
        email,
        nom_guerre: nom_guerre || '',
        domaine: domaine || '',
        autosuggestion: autosuggestion || '',
        subscribed_at: new Date().toISOString(),
        reminders_sent: [],
      };

      await fetch(`${KV_URL}/set/${key}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${KV_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      // Ajouter l'email à la liste globale des abonnés
      await fetch(`${KV_URL}/lpush/subscribers`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${KV_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(email.toLowerCase()),
      });

    } catch (e) {
      console.error('KV storage error:', e);
      // Ne pas bloquer — l'inscription est quand même confirmée côté user
    }
  }

  // ── Email de bienvenue via Resend ──
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (RESEND_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'MonPlan90 <noreply@monplan90j.vercel.app>',
          to: [email],
          subject: `✦ Ton plan est prêt, ${nom_guerre || 'Guerrier'}`,
          html: `
            <div style="background:#080808;color:#F0EAD6;padding:2rem;font-family:Georgia,serif;max-width:580px;margin:0 auto">
              <div style="text-align:center;margin-bottom:1.5rem">
                <div style="color:#8B6914;letter-spacing:.3em;font-size:.75rem;text-transform:uppercase">Mon Plan de Vie</div>
                <div style="color:#C9A84C;font-size:2rem;margin:.5rem 0">90 Jours</div>
              </div>
              <p style="color:#C9A84C;font-size:1.1rem">Bienvenue, <strong>${nom_guerre || ''}</strong>.</p>
              <p style="color:#A89880;line-height:1.8">Tu viens de créer ton plan de transformation sur 90 jours. Les prochains messages arriveront aux moments clés : J3, J7, J14, J30, J60, J90.</p>
              ${autosuggestion ? `
              <div style="border-left:3px solid #C9A84C;padding:.75rem 1rem;margin:1.5rem 0;background:#C9A84C0A">
                <div style="color:#8B6914;font-size:.65rem;letter-spacing:.2em;text-transform:uppercase;margin-bottom:.3rem">Ton autosuggestion — 3× chaque matin</div>
                <div style="color:#E8C97A;font-style:italic;line-height:1.6">${autosuggestion}</div>
              </div>` : ''}
              <p style="color:#7A7060;font-size:.8rem;margin-top:2rem">Créé par Lamine Diabaté · Auteur de "90 Jours pour Renaître"</p>
            </div>
          `,
        }),
      });
    } catch (e) {
      console.error('Resend error:', e);
    }
  }

  return res.status(200).json({ ok: true });
}
