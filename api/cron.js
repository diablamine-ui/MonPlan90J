// api/cron.js — Rappels automatiques J3/J7/J14/J30/J60/J90
// Déclenché chaque matin à 7h par Vercel Cron (voir vercel.json)

const REMINDER_DAYS = [3, 7, 14, 30, 60, 90];

const REMINDER_MESSAGES = {
  3:  { subject: "J3 — Le danger commence maintenant", body: "Le danger maintenant : croire que comprendre suffit. Comprendre sans agir est la forme d'abandon la plus subtile. Qu'est-ce que tu as fait aujourd'hui ?" },
  7:  { subject: "J7 — Ton ancien système revient", body: "7 jours. Ton ancien système essaie déjà de revenir. Pas violemment — juste par l'habitude, par le confort. Tu vois ça ? Tiens." },
  14: { subject: "J14 — La motivation baisse. C'est normal.", body: "La motivation baisse. C'est exactement ici que commence réellement la transformation. Pas quand c'était facile." },
  30: { subject: "J30 — Un mois. Pas d'euphorie.", body: "Un mois. Pas d'euphorie — juste du travail fait. C'est la preuve la plus solide : tu tiens sans avoir besoin de te sentir inspiré." },
  60: { subject: "J60 — Ton identité a changé", body: "60 jours de vie différente. Ton identité a changé même si tu ne le vois pas encore clairement. La clarté arrive à 90." },
  90: { subject: "J90 — Tu as tenu.", body: "90 jours. Peu de gens peuvent dire ça. Tu as tenu. Qu'est-ce qui a changé ? Qui es-tu maintenant ?" },
};

export default async function handler(req, res) {
  // Sécurité : vérifier le header Vercel Cron
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  const RESEND_KEY = process.env.RESEND_API_KEY;

  if (!KV_URL || !KV_TOKEN || !RESEND_KEY) {
    return res.status(500).json({ error: 'Variables d\'environnement manquantes' });
  }

  let sent = 0;
  let errors = 0;

  try {
    // Récupérer tous les abonnés
    const listRes = await fetch(`${KV_URL}/lrange/subscribers/0/-1`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const listData = await listRes.json();
    const emails = listData.result || [];

    for (const email of emails) {
      try {
        const key = `sub:${email.replace(/[^a-z0-9]/g, '_')}`;
        const subRes = await fetch(`${KV_URL}/get/${key}`, {
          headers: { Authorization: `Bearer ${KV_TOKEN}` },
        });
        const subData = await subRes.json();
        const sub = subData.result ? JSON.parse(subData.result) : null;
        if (!sub) continue;

        const daysSince = Math.floor((Date.now() - new Date(sub.subscribed_at)) / (1000 * 60 * 60 * 24));
        const toSend = REMINDER_DAYS.filter(d => d === daysSince && !sub.reminders_sent.includes(d));

        for (const day of toSend) {
          const msg = REMINDER_MESSAGES[day];
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${RESEND_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'MonPlan90 <noreply@monplan90j.vercel.app>',
              to: [email],
              subject: `✦ ${msg.subject}`,
              html: `
                <div style="background:#080808;color:#F0EAD6;padding:2rem;font-family:Georgia,serif;max-width:580px;margin:0 auto">
                  <div style="color:#8B6914;letter-spacing:.2em;font-size:.7rem;text-transform:uppercase;margin-bottom:1rem">Jour ${day} · ${sub.nom_guerre || ''}</div>
                  <p style="color:#C9A84C;font-size:1.1rem;line-height:1.8">${msg.body}</p>
                  ${sub.autosuggestion ? `<div style="border-left:3px solid #C9A84C;padding:.75rem 1rem;margin:1.5rem 0;background:#C9A84C0A;color:#E8C97A;font-style:italic">${sub.autosuggestion}</div>` : ''}
                  <a href="https://mon-plan90j.vercel.app" style="display:inline-block;margin-top:1.5rem;padding:.75rem 1.5rem;background:#C9A84C;color:#080808;text-decoration:none;font-size:.8rem;letter-spacing:.15em">OUVRIR MON PLAN →</a>
                  <p style="color:#7A7060;font-size:.75rem;margin-top:2rem">Créé par Lamine Diabaté · <a href="https://mon-plan90j.vercel.app" style="color:#8B6914">mon-plan90j.vercel.app</a></p>
                </div>
              `,
            }),
          });

          // Marquer le rappel comme envoyé dans KV
          sub.reminders_sent.push(day);
          await fetch(`${KV_URL}/set/${key}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(sub),
          });

          sent++;
        }
      } catch (e) {
        console.error(`Erreur pour ${email}:`, e);
        errors++;
      }
    }
  } catch (e) {
    console.error('Cron crash:', e);
    return res.status(500).json({ error: e.message });
  }

  return res.status(200).json({ ok: true, sent, errors, timestamp: new Date().toISOString() });
}
