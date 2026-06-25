// api/generate.js — Proxy Groq pour MonPlan90
// Reçoit : { prompt, system, max_tokens }
// Renvoie : { content: "texte brut" }
export default async function handler(req, res) {
  // CORS — autorise les appels depuis la version artifact Claude
  // (autre origine que mon-plan90j.vercel.app). À resserrer plus tard
  // si abus constaté (le quota Groq gratuit est limité).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, system, max_tokens = 2000 } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'prompt requis' });
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY non configurée' });
  }

  // Timeout 8s pour rester dans les limites Vercel (10s)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b', // Remplace llama-3.1-8b-instant (déprécié par Groq le 17/06/2026) — encore plus rapide (1000 tok/s)
        max_tokens: Math.min(max_tokens, 4000),
        temperature: 0.5, // Plus bas = JSON plus stable
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: prompt },
        ],
      }),
    });

    clearTimeout(timeout);

    if (!groqRes.ok) {
      const err = await groqRes.json().catch(() => ({}));
      const msg = err.error?.message || `Groq HTTP ${groqRes.status}`;
      console.error('Groq error:', msg);
      return res.status(groqRes.status).json({ error: msg });
    }

    const data = await groqRes.json();
    const content = data.choices?.[0]?.message?.content || '';
    return res.status(200).json({ content });

  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') {
      console.error('Groq timeout après 8s');
      return res.status(504).json({ error: 'Timeout — réessaie' });
    }
    console.error('generate.js crash:', e);
    return res.status(500).json({ error: e.message || 'Erreur serveur' });
  }
}
