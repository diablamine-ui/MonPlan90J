import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';

// ══════════════════════════════════════════════════════════════
// fetchWithRetry — réessaie automatiquement sur 429 (rate limit Groq)
// avec backoff exponentiel, au lieu d'échouer immédiatement.
// ══════════════════════════════════════════════════════════════
async function fetchWithRetry(url, opts, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, opts);
    if (res.status !== 429) return res;
    if (attempt === maxRetries) return res; // épuisé — on laisse l'appelant gérer l'erreur
    const wait = 1500 * Math.pow(2, attempt); // 1.5s, 3s, 6s, 12s
    await new Promise(r => setTimeout(r, wait));
  }
}

// ══════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════
const CODES = ["LD-MAI26","LD-TEST1","LD-BETA2","LD-VIP01","LD-AMIS5","LD-VIP06"];
const STORAGE_KEY = "plan90_v10";
const WEEKLY_KEY = "plan90_weekly_v1";
// Multi-plans : clés par domaine
const DOMAIN_KEYS = {
  "Finances": "plan90_finances_v1",
  "Comportement": "plan90_comportement_v1",
  "Mental": "plan90_mental_v1"
};
const LAST_DOMAIN_KEY = "plan90_last_domain";
const getDomainKey = (d) => DOMAIN_KEYS[d] || STORAGE_KEY;
const saveByDomain = (d, data) => { try{ localStorage.setItem(getDomainKey(d), JSON.stringify(data)); localStorage.setItem(LAST_DOMAIN_KEY, d); }catch(e){} };
const loadByDomain = (d) => { try{ const k=getDomainKey(d); const x=localStorage.getItem(k); return x?JSON.parse(x):null; }catch(e){return null;} };
const loadAllDomains = () => {
  const result = {};
  Object.keys(DOMAIN_KEYS).forEach(d => {
    const data = loadByDomain(d);
    if(data?.plan) result[d] = data;
  });
  // Fallback: chercher aussi dans le storage générique
  if(Object.keys(result).length===0){
    try{
      const gen=localStorage.getItem(STORAGE_KEY);
      if(gen){const data=JSON.parse(gen);if(data?.plan){const d=data.answers?.q_domaine_principal||"Finances";result[d]=data;}}
    }catch(e){}
  }
  return result;
};
const getLastDomain = () => { try{ return localStorage.getItem(LAST_DOMAIN_KEY)||null; }catch{return null;} };
const FONT = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=DM+Mono:wght@300;400&family=Jost:wght@200;300;400;500&display=swap";
const SHEETJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

// ══════════════════════════════════════════════════════════════
// SUPABASE CONFIG
// ══════════════════════════════════════════════════════════════
const SB_URL = "https://mjsqkejxnanexokfdfca.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qc3FrZWp4bmFuZXhva2ZkZmNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxNDM5NTYsImV4cCI6MjA5NDcxOTk1Nn0.KRSdylbMaBwkFYWG441IOGjlTXDlodBE4R-UhdA9OZY";
const sbHeaders = {"Content-Type":"application/json","apikey":SB_KEY,"Authorization":`Bearer ${SB_KEY}`};

// Sauvegarde cloud Supabase (upsert)
const sbSave = async(userKey, domain, data) => {
  try{
    const payload = {
      user_key: userKey,
      domain: domain,
      data: JSON.stringify(data),
      updated_at: new Date().toISOString()
    };
    await fetch(`${SB_URL}/rest/v1/plans`, {
      method: "POST",
      headers: {...sbHeaders, "Prefer": "resolution=merge-duplicates"},
      body: JSON.stringify(payload)
    });
  }catch(e){ console.warn("Supabase save error:", e); }
};

// Chargement cloud Supabase
const sbLoad = async(userKey, domain) => {
  try{
    const res = await fetch(
      `${SB_URL}/rest/v1/plans?user_key=eq.${encodeURIComponent(userKey)}&domain=eq.${encodeURIComponent(domain)}&select=data`,
      { headers: sbHeaders }
    );
    const rows = await res.json();
    if(rows?.length > 0) return JSON.parse(rows[0].data);
    return null;
  }catch(e){ console.warn("Supabase load error:", e); return null; }
};

// Charger tous les domaines depuis Supabase
const sbLoadAll = async(userKey) => {
  try{
    const res = await fetch(
      `${SB_URL}/rest/v1/plans?user_key=eq.${encodeURIComponent(userKey)}&select=domain,data`,
      { headers: sbHeaders }
    );
    const rows = await res.json();
    const result = {};
    (rows||[]).forEach(r => { try{ result[r.domain] = JSON.parse(r.data); }catch{} });
    return result;
  }catch(e){ console.warn("Supabase loadAll error:", e); return {}; }
};

// ══════════════════════════════════════════════════════════════
// PALETTE
// ══════════════════════════════════════════════════════════════
const C = {
  bg:"#FAF7F0",bg1:"#F5F0E6",bg2:"#EFE8D8",bg3:"#E5DCC5",
  border:"#D4C8A8",gold:"#6E5824",goldL:"#6E5420",goldD:"#6E5212",
  text:"#2A2118",textDim:"#564D3C",textMid:"#6B5D45",
  red:"#A8362A",green:"#1A6B3C",blue:"#1F5E8C",purple:"#6B3380",
};

// ══════════════════════════════════════════════════════════════
// DONNÉES STATIQUES
// ══════════════════════════════════════════════════════════════
const CONTINUATION_MSGS = [
  {day:3,  msg:"Le danger maintenant : croire que comprendre suffit. Comprendre sans agir est la forme d'abandon la plus subtile."},
  {day:7,  msg:"Ton ancien système essaie déjà de revenir. Pas violemment — juste par l'habitude, par le confort. Tu vois ça ?"},
  {day:14, msg:"La motivation baisse. C'est exactement ici que commence réellement la transformation. Pas quand c'était facile."},
  {day:21, msg:"21 jours. Le vieux circuit neuronal résiste encore. Mais chaque action répétée l'affaiblit. Tu es dans la zone de friction maximale — continue."},
  {day:30, msg:"Un mois. Pas d'euphorie — juste du travail fait. C'est la preuve la plus solide : tu tiens sans avoir besoin de te sentir inspiré."},
  {day:45, msg:"Mi-parcours. La question n'est plus 'suis-je capable ?' Elle est : 'qui suis-je en train de devenir ?'"},
  {day:60, msg:"60 jours de vie différente. Ton identité a changé même si tu ne le vois pas encore clairement. La clarté arrive à 90."},
  {day:75, msg:"15 jours. Pas le moment de ralentir. C'est maintenant que certains abandonnent en croyant que c'est gagné. Ce n'est pas gagné — c'est ancré."},
];

const WEEK_ROLES = {
  1:"Réduction friction",2:"Stabilisation",3:"Première preuve",4:"Confrontation sabotage",
  5:"Renforcement identité",6:"Accélération",7:"Discipline émotionnelle",8:"Momentum",
  9:"Résilience",10:"Consolidation",11:"Projection",12:"Nouvelle identité",
};

const LEVELS = [
  {min:0, max:14, label:"Éveil",           color:C.blue,   desc:"Tu poses les fondations."},
  {min:15,max:29, label:"Stabilisation",   color:C.gold,   desc:"Les habitudes s'installent."},
  {min:30,max:44, label:"Construction",    color:C.goldL,  desc:"Tu construis du concret."},
  {min:45,max:59, label:"Momentum",        color:C.purple, desc:"L'élan est là."},
  {min:60,max:74, label:"Consolidation",   color:C.green,  desc:"Tu ancres les changements."},
  {min:75,max:90, label:"Nouvelle identité",color:"#F39C12",desc:"Tu es devenu quelqu'un d'autre."},
];

// ══════════════════════════════════════════════════════════════
// ADAPTATION PAR DOMAINE — exemples et placeholders contextuels
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// 3 DOMAINES — Finances · Comportement · Mental
// ══════════════════════════════════════════════════════════════
const DOMAIN_CONFIG = {
  "Finances": {
    icon:"💰",
    color:"#C9A84C",
    desc:"Revenus, indépendance, entrepreneuriat",
    q_etat_now_label:"En 3 mots — décris ta situation financière actuelle.",
    q_etat_now_ph:"Dettes, stagnation, bloqué",
    q_etat_now_ex:"Serré, stable, croissance — ta réalité financière maintenant",
    q_objectif_label:"Ton objectif financier précis dans 90 jours — et pourquoi tu veux vraiment l'atteindre ?",
    q_objectif_ph:"Générer 300 000 FCFA / mois avec mon activité. Je veux l'atteindre pour ne plus dépendre d'un salaire.",
    q_objectif_ex:"Lancer mon activité freelance et avoir 5 clients payants.",
    q_sacrifice_label:"Pour atteindre cet objectif financier — qu'es-tu prêt à sacrifier concrètement ?",
    q_sacrifice_ph:"Moins de sorties, moins de dépenses inutiles. 2h de réseaux en moins chaque soir.",
    q_bloquants_label:"Qu'est-ce qui t'a concrètement empêché de progresser financièrement jusqu'ici ?",
    q_bloquants_ph:"Peur de ne pas être assez compétent. Je ne sais pas par où commencer.",
    q_mensonge_label:"Quel mensonge te racontes-tu pour justifier de ne pas encore agir sur tes finances ?",
    q_mensonge_ph:"Je me dis que je n'ai pas encore assez d'argent pour commencer.",
    q_si_pas_label:"Dans 3 ans, si ta situation financière ne change pas — décris une journée ordinaire.",
    q_si_pas_ph:"Je serai encore à rembourser mes dettes. Ma famille continuera à manquer. Même frustration.",
    q_perte_label:"Qu'est-ce que tu perdrais si tu devenais vraiment libre financièrement ?",
    q_perte_ph:"Je perdrais l'excuse de ne pas avoir réussi. Certains proches pourraient être jaloux.",
    q_adaptive_label:"Quel comportement te fait perdre le plus d'argent ou d'opportunités sans que tu t'en rendes vraiment compte ?",
    q_adaptive_ph:"J'achète impulsivement quand je suis stressé. Je rate des opportunités par peur de demander.",
    q_adaptive_ex:"Je dépense pour compenser mes émotions. Je n'ose pas négocier ni vendre.",
    q_env_label:"Ton environnement proche te pousse davantage vers la progression ou la distraction financière ?",
    q_env_ph:"Mon entourage ne parle pas d'argent. Personne autour de moi n'entreprend vraiment.",
    q_charge_ph:"Une dette. La peur de ne pas payer les fins de mois. Le regard de ma famille.",
    q_pari_ph:"60/100. Pas plus parce que j'ai déjà essayé et abandonné. Pas moins parce que cette fois j'ai un système.",
    q_engagement_label:"Si tu tiens 90 jours — qu'est-ce que tu ne tolèreras plus jamais concernant tes finances ?",
    q_engagement_ph:"Je ne tolérerai plus de finir le mois à zéro. Je ne tolérerai plus d'éviter de regarder mes comptes.",
    q_phrase_neg_label:"Quelle croyance sur l'argent ou les gens riches as-tu héritée — et en quoi elle te freine encore aujourd'hui ?",
    q_phrase_neg_ph:"On m'a toujours dit que l'argent corrompt. Dans ma famille parler d'argent était tabou.",
    q_phrase_neg_ex:"'Les riches sont malhonnêtes.' / 'L'argent ne fait pas le bonheur.' / 'Ce n'est pas pour nous.'",
  },
  "Comportement": {
    icon:"⚡",
    color:"#8E44AD",
    desc:"Habitudes, discipline, relations, impulsions",
    q_etat_now_label:"En 3 mots — décris ton comportement dominant ces dernières semaines.",
    q_etat_now_ph:"Dispersé, impulsif, conscient",
    q_etat_now_ex:"Procrastinateur, réactif, en mode survie — ta réalité comportementale",
    q_objectif_label:"Quel comportement précis veux-tu transformer en 90 jours — et pourquoi c'est urgent ?",
    q_objectif_ph:"Arrêter de procrastiner mes tâches importantes. C'est urgent parce que ça détruit mes projets depuis des années.",
    q_objectif_ex:"Installer une routine matinale et tenir mes engagements envers moi-même.",
    q_sacrifice_label:"Pour transformer ce comportement — qu'es-tu prêt à lâcher concrètement ?",
    q_sacrifice_ph:"Mon confort du soir. Les habitudes qui me font fuir l'inconfort. Le besoin d'approbation.",
    q_bloquants_label:"Qu'est-ce qui t'a empêché jusqu'ici de changer ce comportement ?",
    q_bloquants_ph:"Je recommence à chaque fois dès que c'est inconfortable. Je manque de structure.",
    q_mensonge_label:"Quel mensonge te racontes-tu pour justifier ce comportement que tu veux changer ?",
    q_mensonge_ph:"Je me dis que je suis comme ça. Que je changerai 'quand les conditions seront meilleures'.",
    q_si_pas_label:"Dans 3 ans, si ce comportement ne change pas — décris une journée ordinaire.",
    q_si_pas_ph:"Je serai encore à subir mes impulsions. Mes projets seront encore à moitié faits. Même paralysie.",
    q_perte_label:"Qu'est-ce que tu perdrais si tu transformais vraiment ce comportement ?",
    q_perte_ph:"Je perdrais la familiarité du chaos. Certaines personnes ne me reconnaîtraient plus.",
    q_adaptive_label:"Quel comportement aimerais-tu arrêter définitivement — celui qui sabote le plus souvent la version de toi que tu veux devenir ?",
    q_adaptive_ph:"Je cède à mes impulsions dès que je ressens une émotion forte. Je fuis la discipline dès que c'est dur.",
    q_adaptive_ex:"Je cède au téléphone. Je mange sous le stress. Je réponds par la colère.",
    q_env_label:"Ton environnement proche te pousse davantage vers la progression comportementale ou la distraction ?",
    q_env_ph:"Les gens autour de moi ont les mêmes habitudes que moi. Personne ne me pousse vraiment à changer.",
    q_charge_ph:"Un comportement que je n'arrive pas à changer. Une habitude qui me fait honte. Un schéma répétitif.",
    q_pari_ph:"55/100. Pas plus parce que j'ai déjà essayé de changer et rechuté. Pas moins parce que cette fois j'ai compris le mécanisme.",
    q_engagement_label:"Si tu tiens 90 jours — qu'est-ce que tu ne tolèreras plus jamais dans ton comportement ?",
    q_engagement_ph:"Je ne tolérerai plus de fuir l'inconfort. Je ne tolérerai plus de me mentir sur mes habitudes.",
  },
  "Mental": {
    icon:"🧠",
    color:"#3498DB",
    desc:"Clarté, focus, paix intérieure, confiance",
    q_etat_now_label:"En 3 mots — décris ton état émotionnel actuel.",
    q_etat_now_ph:"Anxieux, épuisé, déterminé",
    q_etat_now_ex:"Agité, vide, serein — ton état intérieur réel maintenant",
    q_objectif_label:"Quelle transformation intérieure veux-tu vivre en 90 jours — et pourquoi maintenant ?",
    q_objectif_ph:"Retrouver la paix intérieure et arrêter d'être gouverné par mes pensées négatives. Maintenant parce que ça affecte tout.",
    q_objectif_ex:"Installer une pratique de méditation et apprendre à gérer mon anxiété.",
    q_sacrifice_label:"Pour transformer ton état mental — qu'es-tu prêt à lâcher concrètement ?",
    q_sacrifice_ph:"Les distractions numériques. Les ruminations inutiles. Les conversations qui me vident.",
    q_bloquants_label:"Qu'est-ce qui t'a empêché jusqu'ici de trouver la clarté ou la paix que tu cherches ?",
    q_bloquants_ph:"Mon mental s'emballe dès que je m'arrête. Je n'arrive pas à tenir une pratique régulière.",
    q_mensonge_label:"Quel mensonge te racontes-tu pour éviter de travailler sur ton état mental ?",
    q_mensonge_ph:"Je me dis que je serai mieux quand ma situation extérieure s'améliorera. Que ce n'est pas urgent.",
    q_si_pas_label:"Dans 3 ans, si ton état mental reste le même — décris une journée ordinaire dans cet état.",
    q_si_pas_ph:"Même anxiété au réveil. Même agitation. Même impression de subir mes pensées plutôt que de les diriger.",
    q_perte_label:"Qu'est-ce que tu perdrais si tu trouvais vraiment la clarté et la paix intérieure ?",
    q_perte_ph:"Je perdrais l'agitation qui me donne l'impression d'être actif. La familiarité de mes pensées négatives.",
    q_adaptive_label:"Quelle pensée revient le plus souvent quand ton énergie mentale chute — et vers quoi ton cerveau fuit immédiatement ?",
    q_adaptive_ph:"'À quoi ça sert ?' revient souvent. Mon cerveau fuit vers les réseaux ou le sommeil.",
    q_adaptive_ex:"'Je ne suis pas capable.' Fuite vers la nourriture, les séries, le scroll infini.",
    q_env_label:"Ton environnement proche nourrit-il ton mental ou l'épuise-t-il davantage ?",
    q_env_ph:"Les conversations autour de moi sont souvent négatives ou superficielles. Ça m'épuise sans que je le réalise.",
    q_charge_ph:"Des pensées qui tournent en boucle. Une anxiété de fond. Une question existentielle non résolue.",
    q_pari_ph:"60/100. Pas plus parce que mon mental résiste depuis longtemps. Pas moins parce que je comprends enfin pourquoi.",
    q_engagement_label:"Si tu tiens 90 jours — qu'est-ce que tu ne tolèreras plus jamais dans ta vie mentale ?",
    q_engagement_ph:"Je ne tolérerai plus de laisser mes pensées me gouverner. Je ne tolérerai plus de fuir l'inconfort mental.",
  },
};

function getDomainCfg(answers) {
  const d = answers?.q_domaine_principal || "";
  return DOMAIN_CONFIG[d] || null;
}

// ══════════════════════════════════════════════════════════════
// SEGMENTS — 22 questions finales
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// 3 PARCOURS DISTINCTS — Finances · Comportement · Mental
// ══════════════════════════════════════════════════════════════

const SEGMENT_TRANSITIONS_F = {
  identite:{title:"Profil identifié.",sub:"On sait d'où tu pars financièrement.",next:"Maintenant : ton objectif concret et ce que tu es prêt à faire pour l'atteindre.",cta:"Passer à l'Objectif →",warn:""},
  objectif:{title:"Objectif posé.",sub:"Tu sais ce que tu veux changer — et pourquoi c'est urgent.",next:"Maintenant on touche aux vrais blocages. Ce bloc est le plus inconfortable. C'est aussi le plus utile.",cta:"Passer aux Blocages →",warn:"Tu es seul avec toi-même. Reste honnête."},
  blocages:{title:"Blocages nommés.",sub:"Peu de gens vont aussi loin dans l'honnêteté.",next:"On regarde maintenant ton énergie et tes habitudes quotidiennes.",cta:"Passer à l'Énergie →",warn:""},
  environnement:{title:"Profil complet.",sub:"On a tout ce qu'il faut pour construire ton plan financier sur mesure.",next:"Dernier bloc — il calibre le plan sur ta réalité concrète.",cta:"Passer à l'Exécution →",warn:"Sois précis ici. C'est ici que le plan devient applicable."},
};

const SEGMENT_TRANSITIONS_C = {
  identite:{title:"Profil comportemental établi.",sub:"On sait quel schéma tu répètes.",next:"Maintenant : ton objectif de transformation et ce que tu es prêt à lâcher.",cta:"Passer à l'Objectif →",warn:""},
  objectif:{title:"Objectif posé.",sub:"Tu sais quel comportement transformer — et pourquoi c'est urgent.",next:"On touche maintenant aux vrais mécanismes de sabotage.",cta:"Passer aux Blocages →",warn:"Reste honnête — pas la réponse noble, la réponse vraie."},
  blocages:{title:"Schémas identifiés.",sub:"Tu as nommé ce qui te sabote. C'est déjà rare.",next:"On regarde maintenant tes déclencheurs et ton environnement.",cta:"Passer à l'Énergie →",warn:""},
  environnement:{title:"Profil complet.",sub:"On a tout pour construire ton système de transformation.",next:"Dernier bloc — il calibre le plan sur ta vie réelle.",cta:"Passer à l'Exécution →",warn:""},
};

const SEGMENT_TRANSITIONS_M = {
  identite:{title:"État mental identifié.",sub:"On sait d'où tu pars intérieurement.",next:"Maintenant : ta transformation mentale et ce que tu es prêt à changer.",cta:"Passer à l'Objectif →",warn:""},
  objectif:{title:"Objectif posé.",sub:"Tu sais quelle transformation tu veux vivre.",next:"On touche maintenant aux vraies résistances mentales.",cta:"Passer aux Blocages →",warn:"Pas la réponse que tu voudrais donner — celle qui est vraie."},
  blocages:{title:"Résistances identifiées.",sub:"Tu as nommé ce qui pèse. C'est déjà beaucoup.",next:"On regarde maintenant tes habitudes mentales et ton environnement.",cta:"Passer à l'Énergie →",warn:""},
  environnement:{title:"Profil complet.",sub:"On a tout pour construire ton système de paix mentale.",next:"Dernier bloc — court et décisif.",cta:"Passer à l'Exécution →",warn:""},
};

const SEGMENTS_FINANCES = [
  { id:"identite", label:"IDENTITÉ", icon:"◈", subtitle:"Qui tu es financièrement", questions:[
    {id:"q_profil",label:"Ton prénom, ton âge et ton activité principale ?",type:"text",ph:"Kofi, 32 ans, vendeur en ligne",minLen:5,
     reward:"Chaque phrase de ton plan sera personnalisée à ta réalité.",
     aide:{ex:"Fatou, 28 ans, employée RH et vendeuse le week-end."}},
    {id:"q_domaine_principal",label:"Quel domaine veux-tu transformer en 90 jours ?",type:"select",
     opts:["Finances","Comportement","Mental"],
     reward:"✦ Ton parcours est 100% dédié à ta situation financière.",
     aide:{ex:"Finances — revenus, indépendance, entrepreneuriat."}},
    {id:"q_frustration",label:"Qu'est-ce qui te frustre le plus dans ta situation financière aujourd'hui ?",type:"textarea",ph:"Je travaille sans cesse mais mon compte reste vide. Je vois les autres avancer et je stagne depuis 2 ans.",minLen:15,
     reward:"Cette frustration devient le moteur de ton plan.",
     aide:{ex:"Je génère de l'argent mais je ne sais pas où il part."}},
    {id:"q_profil_financier",label:"Lequel décrit le mieux ta réalité financière aujourd'hui ?",type:"select",
     opts:["Je travaille beaucoup sans vraie progression","Je suis instable financièrement","Je procrastine les actions importantes","Je suis dispersé sur trop de projets","Je manque de clients ou d'opportunités","J'ai peur de vendre ou de me montrer","Je commence beaucoup mais termine peu","Je ne sais plus quoi essayer"],
     reward:"Ce profil est au cœur de ton diagnostic.",
     aide:{ex:"Si tu lances des projets sans les finir → 'Je commence beaucoup mais termine peu'."}},
    {id:"q_visibilite",label:"Quand tu dois vendre ou te rendre visible — que se passe-t-il dans ta tête ?",type:"textarea",ph:"Je remets à plus tard. J'ai peur du refus. Je n'ose pas relancer mes clients ou augmenter mes prix.",minLen:15,
     reward:"Ce mécanisme est identifié. Le plan le désamorce concrètement.",
     aide:{ex:"Je préfère baisser mes prix plutôt que de négocier."}},
  ]},
  { id:"objectif", label:"OBJECTIF", icon:"✦", subtitle:"Ce que tu veux changer concrètement", questions:[
    {id:"q_objectif",label:"Quel résultat financier concret doit changer en 90 jours ?",type:"text",ph:"Ex : Atteindre 300 000 FCFA/mois en revenus nets",minLen:10,
     reward:"Objectif ancré. Toutes les 12 semaines pointent vers ça.",
     aide:{ex:"Générer 500 000 FCFA/mois. Avoir 3 clients réguliers."}},
    {id:"q_urgence",label:"Pourquoi c'est urgent maintenant — et pas dans 2 ans ?",type:"textarea",ph:"Parce que mes dettes augmentent. Parce que ma famille attend depuis trop longtemps. Chaque mois qui passe coûte.",minLen:15,
     reward:"Cette urgence tient quand la motivation lâche.",
     aide:{ex:"Parce que j'ai déjà perdu 3 ans à procrastiner."}},
    {id:"q_activite_repoussee",label:"Quelle action pourrait augmenter tes revenus — mais que tu repousses constamment ?",type:"textarea",ph:"Je sais que je dois prospecter mais je remets chaque semaine. Je sais que je dois augmenter mes prix mais j'ai peur.",minLen:15,
     reward:"Le levier principal est identifié. Le plan va t'y forcer.",
     aide:{ex:"Créer du contenu, appeler des prospects, lancer ma boutique."}},
    {id:"q_cout_statu_quo",label:"Si rien ne change dans 3 ans — que vas-tu perdre concrètement ? Et à qui cela fera-t-il du tort ?",type:"textarea",ph:"Je serai encore dans les mêmes dettes. Ma famille continuera d'attendre. Je perdrai leur confiance.",minLen:20,
     reward:"Ce coût réel est ton levier anti-abandon le plus puissant.",
     aide:{ex:"Dans 3 ans : même salaire, mêmes dettes. Ma famille aura perdu confiance en moi."}},
  ]},
  { id:"blocages", label:"BLOCAGES", icon:"⚠", subtitle:"Ce qui freine vraiment ta progression", questions:[
    {id:"q_mensonge",label:"Quel mensonge ton cerveau utilise-t-il pour éviter d'agir ?",type:"select",
     opts:["Je ne suis pas encore prêt","Je manque de capital","Ce n'est pas le bon moment","Je dois encore apprendre","Je n'ai pas le temps","Les conditions ne sont pas réunies","Je vais commencer bientôt","Autre"],
     reward:"Ce mensonge est nommé. Il perd son pouvoir.",
     aide:{ex:"'Je vais commencer quand j'aurai économisé.' / 'Je dois d'abord finir ma formation.'"}},
    {id:"q_perte_succes",label:"Si tu réussissais vraiment ces 90 jours — que risques-tu de perdre ? Et quelle relation à l'argent refuses-tu de continuer après ça ?",type:"textarea",ph:"Je perdrais l'excuse de ne pas avoir réussi. Et je refuse de continuer à finir le mois à zéro.",minLen:15,
     reward:"Les résistances au succès sont identifiées. Ta ligne rouge est posée.",
     aide:{ex:"Je perdrais le confort de me plaindre. Je refuse de dépenser avant d'épargner."}},
    {id:"q_echec_historique",label:"La dernière fois que tu as échoué financièrement — que s'est-il passé exactement et quelle conclusion as-tu tirée sur toi ?",type:"textarea",ph:"En 2021 j'ai lancé un business qui a échoué. J'ai conclu que je n'étais pas fait pour entreprendre. Depuis j'hésite à tout.",minLen:20,
     reward:"Ce schéma est identifié. Le plan est construit pour le désamorcer.",
     aide:{ex:"Mon projet a échoué. J'ai pensé : 'Je suis nul en gestion.' C'est depuis que j'évite de recommencer."}},
  ]},
  { id:"energie", label:"ÉNERGIE", icon:"◉", subtitle:"Ta relation à l'argent et ton environnement", questions:[
    {id:"q_argent_env",label:"Que représente l'argent pour toi — et ton entourage te pousse-t-il vers la richesse ou la limitation ?",type:"textarea",ph:"L'argent c'est la liberté. Mais mon entourage pense que vouloir beaucoup d'argent c'est être avare.",minLen:15,
     reward:"Ta relation à l'argent et ton environnement sont dans le diagnostic.",
     aide:{ex:"L'argent = sécurité. Mais mes proches me découragent quand j'ai des idées."}},
    {id:"q_stress_financier",label:"Quand tu es stressé financièrement — que fais-tu en premier ?",type:"select",
     opts:["Je scrolle les réseaux sociaux","Je dors ou j'évite d'y penser","Je travaille dans tous les sens sans stratégie","Je mange pour compenser","Je procrastine et remets à demain","Je regarde des vidéos ou séries","Je coupe les contacts","Je cherche une solution immédiatement"],
     reward:"Ce comportement de fuite est dans le protocole anti-rechute.",
     aide:{ex:"Quand j'ai des problèmes d'argent, je scrolle Instagram pendant des heures."}},
  ]},
  { id:"execution", label:"EXÉCUTION", icon:"▶", subtitle:"Ton engagement concret sur 90 jours", questions:[
    {id:"q_pari",label:"Tu paries combien sur 100 que tu réussis ces 90 jours — et pourquoi pas plus, pourquoi pas moins ?",type:"textarea",ph:"65/100. Pas plus parce que j'ai déjà essayé et abandonné. Pas moins parce que cette fois j'ai un vrai système.",minLen:20,
     reward:"Ton niveau de conviction est calibré. Le plan anti-abandon est construit dessus.",
     aide:{ex:"60/100. Pas plus : j'ai échoué avant. Pas moins : je suis plus préparé qu'avant."}},
    {id:"q_rythme",label:"Combien de minutes peux-tu protéger chaque jour — même les mauvais jours ?",type:"dual_select",
     selects:[{id:"heures",label:"Minutes / jour",opts:["15 à 30 minutes","30 à 60 minutes","1 à 2 heures","Plus de 2 heures"]},{id:"moment",label:"Moment naturel",opts:["Matin (avant 12h)","Après-midi (12h–18h)","Soir (après 20h)","Variable"]}],
     reward:"Les actions du plan sont calées sur ton minimum réel.",
     aide:{ex:"30 minutes le soir après 20h, même épuisé."}},
    {id:"q_montant",label:"Quel revenu mensuel exact changerait concrètement ta vie ?",type:"text",ph:"Ex : 450 000 FCFA / mois",minLen:3,
     reward:"Cet ancrage calibre toutes les 12 semaines.",
     aide:{ex:"300 000 FCFA me permettrait de quitter mon emploi et vivre sereinement."}},
  ]},
];
const SEGMENTS_COMPORTEMENT = [
  { id:"identite", label:"IDENTITÉ", icon:"◈", subtitle:"Ton schéma comportemental actuel", questions:[
    {id:"q_profil",label:"Ton prénom, ton âge et ton activité principale ?",type:"text",ph:"Aminata, 27 ans, assistante commerciale",minLen:5,
     reward:"Chaque recommandation sera ancrée dans ta réalité concrète.",
     aide:{ex:"Moussa, 34 ans, enseignant et entrepreneur le week-end."}},
    {id:"q_domaine_principal",label:"Quel domaine veux-tu transformer en 90 jours ?",type:"select",
     opts:["Finances","Comportement","Mental"],
     reward:"✦ Ton parcours est 100% dédié à ta transformation comportementale.",
     aide:{ex:"Comportement — habitudes, discipline, relations, impulsions."}},
    {id:"q_comportement_reccurent",label:"Quel comportement revient malgré tes promesses — et lequel te fait perdre le plus de respect envers toi-même ?",type:"textarea",ph:"Je procrastine constamment malgré mes promesses. Et je me déçois le plus quand je cède à mon téléphone au lieu de travailler.",minLen:15,
     reward:"Ce schéma et cette auto-trahison sont au centre du diagnostic.",
     aide:{ex:"Je commence puis j'abandonne. Et je perds le plus de respect quand je promets et ne tiens pas."}},
    {id:"q_profil_comportemental",label:"Lequel décrit le mieux ton fonctionnement actuel ?",type:"select",
     opts:["Je procrastine beaucoup","Je manque de constance","Je commence puis j'abandonne","Je me disperse facilement","Je manque de discipline","Je fuis l'inconfort","Je retombe toujours dans les mêmes habitudes"],
     reward:"Ce profil comportemental est au cœur de ton diagnostic.",
     aide:{ex:"Si tu lances des projets sans les finir → 'Je commence puis j'abandonne'."}},
  ]},
  { id:"objectif", label:"OBJECTIF", icon:"✦", subtitle:"La transformation que tu veux vraiment", questions:[
    {id:"q_objectif",label:"Quel comportement précis veux-tu transformer en 90 jours ?",type:"textarea",ph:"Arrêter de procrastiner mes tâches importantes. Tenir mes engagements envers moi-même. Installer une routine quotidienne.",minLen:20,
     reward:"Objectif comportemental ancré. Les 12 semaines sont construites pour l'y amener.",
     aide:{ex:"Travailler 2h sans téléphone chaque matin. Tenir mon planning sans exception."}},
    {id:"q_urgence_projection",label:"Pourquoi c'est urgent maintenant — et si rien ne change dans 3 ans, qu'est-ce qui se dégradera le plus dans ta vie ?",type:"textarea",ph:"Urgent parce que j'ai perdu trop d'opportunités. Dans 3 ans : mêmes schémas, projets inachevés, confiance en moi perdue.",minLen:20,
     reward:"Ce déclencheur et cette projection sont dans le plan anti-abandon.",
     aide:{ex:"Urgent : j'ai 30 ans et rien ne change. Dans 3 ans : mêmes regrets, même immobilisme."}},
    {id:"q_cout_inaction",label:"La dernière fois que tu as abandonné un engagement — c'était quand, où, et qu'est-ce qui s'est passé juste avant ?",type:"textarea",ph:"Il y a 2 mois, un lundi soir. J'étais fatigué après le travail. J'ai regardé mon téléphone et je n'ai plus rien fait.",minLen:20,
     reward:"Ce moment précis est maintenant dans ton protocole anti-rechute.",
     aide:{ex:"Il y a 3 semaines, un mercredi. J'avais eu une mauvaise journée et j'ai tout arrêté."}},
    {id:"q_sacrifice",label:"Qu'es-tu prêt à supprimer ou limiter fortement pendant 90 jours pour changer réellement ?",type:"textarea",ph:"Limiter les réseaux à 30 minutes par jour. Arrêter les séries en semaine. Réduire les sorties inutiles.",minLen:15,
     reward:"Ton niveau de conviction réel est dans le plan.",
     aide:{ex:"Supprimer Netflix 30 jours. Couper les notifications pendant les heures de travail."}},
  ]},
  { id:"blocages", label:"BLOCAGES", icon:"⚠", subtitle:"Tes mécanismes de sabotage", questions:[
    {id:"q_mensonge",label:"Quel mensonge utilises-tu pour justifier tes mauvaises habitudes ?",type:"select",
     opts:["Je changerai quand ma situation s'améliorera","C'est plus fort que moi — c'est ma nature","J'ai essayé mais ça ne marche pas pour moi","Je n'ai pas le temps","Je manque de volonté","C'est à cause de mon entourage","Je le ferai demain","Autre"],
     reward:"Ce mensonge est nommé. Il perd son pouvoir.",
     aide:{ex:"'Je changerai quand j'aurai moins de stress.' / 'Je suis comme ça de nature.'"}},
    {id:"q_resistance_abandon",label:"Si tu changeais vraiment — que perdrais-tu ? Et quelle est la vraie raison derrière tes abandons ?",type:"textarea",ph:"Je perdrais le confort de me plaindre. Et j'abandonne toujours quand c'est inconfortable ou quand je ne vois pas de résultats rapides.",minLen:15,
     reward:"Les résistances inconscientes et le mécanisme d'abandon sont identifiés.",
     aide:{ex:"Je perdrais la familiarité du chaos. J'abandonne quand une émotion forte arrive."}},
    {id:"q_emotion_declencheur",label:"Quelle émotion déclenche le plus souvent tes comportements destructeurs ?",type:"select",
     opts:["Stress et pression","Ennui et vide","Solitude","Frustration","Anxiété","Fatigue","Colère","Honte ou culpabilité"],
     reward:"Ce déclencheur émotionnel est dans le protocole anti-saboteur.",
     aide:{ex:"Quand je suis stressé je procrastine. Quand je m'ennuie je mange."}},
  ]},
  { id:"energie", label:"ÉNERGIE", icon:"◉", subtitle:"Tes déclencheurs et ton environnement", questions:[
    {id:"q_voix_neg_fuite",label:"Quelle phrase négative tourne en boucle dans ta tête — et vers quoi tu fuis automatiquement quand tu te sens mal ?",type:"textarea",ph:"Je me dis 'je n'arrive jamais à finir ce que je commence'. Et je fuis vers mon téléphone ou la nourriture.",minLen:15,
     reward:"Ton autosuggestion sera l'opposé exact de cette phrase. Ta fuite est dans le protocole anti-rechute.",
     aide:{ex:"Phrase : 'Je suis faible.' Fuite : Instagram ou dormir."}},
    {id:"q_moment_fuite",label:"À quel moment de la journée es-tu le plus vulnérable à l'auto-sabotage ?",type:"select",
     opts:["Le matin — j'ai du mal à démarrer","Après le déjeuner — l'après-midi je décroche","Le soir — je cède aux distractions","Dès que quelque chose devient difficile","Quand je suis seul face à une tâche importante"],
     reward:"Le rituel sera calé pour contrer exactement ce moment.",
     aide:{ex:"Le soir après 20h — je sais que je vais procrastiner."}},
    {id:"q_environnement",label:"Quel environnement renforce le plus tes mauvaises habitudes ?",type:"textarea",ph:"À la maison sans structure je procrastine tout. Mon entourage a les mêmes habitudes que moi.",minLen:15,
     reward:"L'environnement est maintenant dans les stratégies du plan.",
     aide:{ex:"Le salon avec la télé. Mon téléphone sur le bureau. Mes amis qui ne font rien le week-end."}},
  ]},
  { id:"execution", label:"EXÉCUTION", icon:"▶", subtitle:"Ton engagement concret", questions:[
    {id:"q_pari",label:"Tu paries combien sur 100 que tu réussis ces 90 jours — et pourquoi pas plus, pourquoi pas moins ?",type:"textarea",ph:"60/100. Pas plus parce que j'ai déjà échoué plusieurs fois. Pas moins parce que cette fois j'ai un vrai système.",minLen:20,
     reward:"Ton niveau de conviction est calibré. Le plan anti-abandon est construit dessus.",
     aide:{ex:"55/100. Pas plus : rechutes fréquentes. Pas moins : meilleure compréhension de mes schémas."}},
    {id:"q_rythme",label:"Combien de minutes peux-tu protéger chaque jour — même les mauvais jours ?",type:"dual_select",
     selects:[{id:"heures",label:"Minutes / jour",opts:["15 à 30 minutes","30 à 60 minutes","1 à 2 heures","Plus de 2 heures"]},{id:"moment",label:"Moment naturel",opts:["Matin (avant 12h)","Après-midi (12h–18h)","Soir (après 20h)","Variable"]}],
     reward:"Les actions sont calées sur ton minimum réel.",
     aide:{ex:"20 minutes le matin, même épuisé."}},
    {id:"q_engagement",label:"Si ce comportement devenait automatique dans 90 jours — qu'est-ce qui changerait concrètement dans ta vie ? Qui es-tu quand tu obtiens ça ?",type:"textarea",ph:"Si je tenais mes engagements, mes projets aboutiraient, ma confiance exploserait. Je suis quelqu'un qui finit ce qu'il commence et qui ne se ment plus.",minLen:20,
     reward:"La vision et l'identité future sont posées. C'est ce qu'on relit au moment de tout lâcher.",
     aide:{ex:"Si j'arrêtais de procrastiner, j'aurais lancé mon projet. Je suis quelqu'un de discipliné qui agit même sans motivation."}},
  ]},
];
const SEGMENTS_MENTAL = [
  { id:"identite", label:"IDENTITÉ", icon:"◈", subtitle:"Ton état mental actuel", questions:[
    {id:"q_profil",label:"Ton prénom, ton âge et ton activité principale ?",type:"text",ph:"Ibrahim, 29 ans, ingénieur",minLen:5,
     reward:"Chaque recommandation sera ancrée dans ta réalité.",
     aide:{ex:"Mariama, 31 ans, infirmière et mère de famille."}},
    {id:"q_domaine_principal",label:"Quel domaine veux-tu transformer en 90 jours ?",type:"select",
     opts:["Finances","Comportement","Mental"],
     reward:"✦ Ton parcours est 100% dédié à ta transformation mentale.",
     aide:{ex:"Mental — clarté, paix intérieure, confiance, stabilité."}},
    {id:"q_pensee_dominante",label:"Quelle pensée revient le plus souvent quand tu es seul — et quel mensonge ton cerveau utilise-t-il pour rester dans cet état ?",type:"textarea",ph:"La pensée : 'Je ne suis pas à la hauteur.' Le mensonge : 'Ça va aller avec le temps, c'est pas si grave.'",minLen:20,
     reward:"Cette pensée et ce mécanisme sont dans le diagnostic et l'autosuggestion.",
     aide:{ex:"Pensée : 'Je suis en retard sur tout le monde.' Mensonge : 'Je gère, c'est la vie.'"}},
    {id:"q_etat_mental",label:"Lequel décrit le mieux ton état mental en ce moment ?",type:"select",
     opts:["Anxieux en permanence","Épuisé mentalement","Dispersé — du mal à me concentrer","Perdu — je ne sais plus où j'en suis","Sous pression constante","Démotivé et vide","Émotionnellement instable","Mentalement fatigué de tout"],
     reward:"Cet état est au cœur du diagnostic.",
     aide:{ex:"Si tu te réveilles déjà fatigué → 'Épuisé mentalement'."}},
    {id:"q_peur_dominante",label:"Quelle peur influence silencieusement la majorité de tes décisions aujourd'hui ?",type:"textarea",ph:"La peur d'échouer. La peur du jugement. La peur de décevoir ma famille. La peur de ne pas être à la hauteur.",minLen:15,
     reward:"Cette peur est identifiée. Le plan est construit pour la désarmer.",
     aide:{ex:"Peur du rejet. Peur d'être insuffisant. Peur de prendre la mauvaise décision."}},
  ]},
  { id:"objectif", label:"OBJECTIF", icon:"✦", subtitle:"La transformation intérieure que tu veux", questions:[
    {id:"q_objectif",label:"Quelle transformation mentale ou émotionnelle veux-tu vivre en 90 jours ?",type:"textarea",ph:"Retrouver la paix intérieure. Arrêter d'être gouverné par mes pensées négatives. Avoir plus de clarté.",minLen:20,
     reward:"Objectif de transformation intérieure ancré.",
     aide:{ex:"Arrêter de ruminer. Développer ma confiance. Trouver un calme stable."}},
    {id:"q_urgence_version_stable",label:"Pourquoi c'est urgent maintenant — et à quoi ressemble ta version mentalement stable au quotidien ?",type:"textarea",ph:"Urgent parce que mon mental affecte tout. Version stable : je me lève sans anxiété, je décide sans me torturer, je dors bien.",minLen:20,
     reward:"Ce déclencheur et cette vision sont dans le plan.",
     aide:{ex:"Urgent : je n'arrive plus à fonctionner. Version stable : je reste calme sous pression."}},
    {id:"q_cout_statu_quo",label:"Si rien ne change dans 3 ans — qu'est-ce qui t'épuisera le plus ? Et à qui cela fera-t-il du tort ?",type:"textarea",ph:"Je serai encore dans la même anxiété. Mes relations vont se dégrader. Ma famille souffrira de mon état.",minLen:20,
     reward:"Ce coût réel est ton levier anti-abandon le plus puissant.",
     aide:{ex:"Dans 3 ans : même épuisement, même anxiété. Et mes proches en pâtiront."}},
  ]},
  { id:"blocages", label:"BLOCAGES", icon:"⚠", subtitle:"Ce qui pèse réellement", questions:[
    {id:"q_resistance_perte",label:"Si tu trouvais la paix intérieure — que risques-tu de perdre ? Et quel échec t'a le plus fragilisé mentalement ?",type:"textarea",ph:"Je perdrais l'identité de celui qui souffre. Et en 2020 quand tout s'est effondré, j'ai conclu que je n'étais pas fait pour réussir.",minLen:20,
     reward:"Les résistances inconscientes et le schéma fragilisant sont identifiés.",
     aide:{ex:"Je perdrais la familiarité de mon anxiété. Échec : mon divorce, conclusion : je ne mérite pas mieux."}},
    {id:"q_reaction_pression",label:"Quand tu es sous pression — tu deviens plutôt ?",type:"select",
     opts:["Silencieux et fermé — je me retire","Agressif — je m'énerve facilement","Anxieux et agité — je n'arrive plus à me calmer","Dispersé — je saute d'une chose à l'autre","Paralysé — je ne fais plus rien","Hyperactif — je m'occupe pour ne pas penser","Irritable — tout m'agace"],
     reward:"Ce comportement sous pression est dans le protocole anti-rechute.",
     aide:{ex:"Sous pression je deviens silencieux et je ferme tous les contacts."}},
    {id:"q_croyance_limitante",label:"Quelle croyance sur toi-même aimerais-tu enfin arrêter de porter ?",type:"textarea",ph:"'Je ne suis pas assez bien.' / 'Je suis en retard sur tout le monde.' / 'Je ne mérite pas mieux que ça.'",minLen:10,
     reward:"Cette croyance est dans le diagnostic. L'autosuggestion en est l'opposé exact.",
     aide:{ex:"'Je suis une déception.' / 'Je n'arriverai jamais à rien.'"}},
  ]},
  { id:"energie", label:"ÉNERGIE", icon:"◉", subtitle:"Ta charge mentale et tes habitudes", questions:[
    {id:"q_fuite_charge",label:"Qu'est-ce qui surcharge le plus ton esprit — et vers quoi tu fuis automatiquement quand c'est trop lourd ?",type:"textarea",ph:"Des décisions en attente et des conflits non résolus. Je fuis vers mon téléphone ou je dors.",minLen:15,
     reward:"Ta charge mentale et ta fuite sont dans le rituel et le protocole anti-rechute.",
     aide:{ex:"Charge : un problème financier. Fuite : Instagram ou isolement."}},
    {id:"q_moment_fuite",label:"À quel moment de la journée ton mental devient-il le plus fragile ?",type:"select",
     opts:["Le matin — je me réveille déjà épuisé","Après le déjeuner — je décroche","Le soir — les pensées s'intensifient","Dès que je suis inactif","Quand je suis seul face au silence"],
     reward:"Le rituel sera calé pour contrer exactement ce moment.",
     aide:{ex:"Le soir après 20h — les pensées négatives arrivent."}},
    {id:"q_habitude_calmante",label:"Quelle habitude calme vraiment ton cerveau — et quand l'as-tu pratiquée pour la dernière fois ?",type:"textarea",ph:"La marche me calme. Mais je ne l'ai pas faite depuis 3 semaines. La prière aussi — mais j'ai arrêté.",minLen:15,
     reward:"Cette habitude calmante entre dans le rituel quotidien.",
     aide:{ex:"La méditation. Le sport. La lecture. Dernière fois : il y a 2 semaines."}},
  ]},
  { id:"execution", label:"EXÉCUTION", icon:"▶", subtitle:"Ton engagement concret", questions:[
    {id:"q_pari",label:"Tu paries combien sur 100 que tu vis cette transformation en 90 jours — et pourquoi pas plus, pourquoi pas moins ?",type:"textarea",ph:"62/100. Pas plus parce que mon mental résiste depuis longtemps. Pas moins parce que je comprends enfin pourquoi.",minLen:20,
     reward:"Ton niveau de conviction est calibré.",
     aide:{ex:"65/100. Pas plus : rechutes émotionnelles fréquentes. Pas moins : meilleure lucidité."}},
    {id:"q_rythme",label:"Combien de minutes peux-tu protéger chaque jour pour ton équilibre mental ?",type:"dual_select",
     selects:[{id:"heures",label:"Minutes / jour",opts:["15 à 30 minutes","30 à 60 minutes","1 à 2 heures","Plus de 2 heures"]},{id:"moment",label:"Moment naturel",opts:["Matin (avant 12h)","Après-midi (12h–18h)","Soir (après 20h)","Variable"]}],
     reward:"Les pratiques sont calées sur ton minimum réel.",
     aide:{ex:"15 minutes le matin avant que la journée commence."}},
  ]},
];
function getSegments(domaine) {
  if(domaine==="Finances") return SEGMENTS_FINANCES;
  if(domaine==="Comportement") return SEGMENTS_COMPORTEMENT;
  if(domaine==="Mental") return SEGMENTS_MENTAL;
  return null;
}

function getTransitions(domaine) {
  if(domaine==="Finances") return SEGMENT_TRANSITIONS_F;
  if(domaine==="Comportement") return SEGMENT_TRANSITIONS_C;
  if(domaine==="Mental") return SEGMENT_TRANSITIONS_M;
  return SEGMENT_TRANSITIONS_F;
}

function validateAnswer(q, val) {
  if (!q) return { valid: false, msg: "Réponds à cette question." };
  switch(q.type) {
    case "text":
      if (!val || val.trim().length < (q.minLen||3))
        return { valid:false, msg: q.aide?.erreur || `Minimum ${q.minLen||3} caractères.` };
      return { valid:true };
    case "textarea":
      if (!val || val.trim().length < (q.minLen||10))
        return { valid:false, msg: q.aide?.erreur || "Développe un peu plus ta réponse." };
      return { valid:true };
    case "select":
      if (!val) return { valid:false, msg: q.aide?.erreur || "Sélectionne une option." };
      return { valid:true };
    case "multi":
      if (!val || val.length === 0) return { valid:false, msg: q.aide?.erreur || "Choisis au moins une option." };
      return { valid:true };
    case "adaptive_select": {
      const av = val || {};
      if (!av.choice) return { valid:false, msg: "Sélectionne une option." };
      if (!av.follow_answer || av.follow_answer.trim().length < (q.follow?.[av.choice]?.minLen||5))
        return { valid:false, msg: "Développe ta réponse." };
      if (!av.fixed_answer || av.fixed_answer.trim().length < (q.fixed?.minLen||10))
        return { valid:false, msg: q.aide?.erreur || "Réponds à la deuxième partie." };
      return { valid:true };
    }
    case "dual_select": {
      const ds = val || {};
      if (!ds.heures || !ds.moment) return { valid:false, msg: q.aide?.erreur || "Sélectionne les deux options." };
      return { valid:true };
    }
    case "combo":
      const cv = val || {};
      if (!cv.domaines || cv.domaines.length === 0 || !cv.montant || cv.montant.trim().length < 2)
        return { valid:false, msg: q.aide?.erreur || "Choisis les domaines ET indique le montant." };
      return { valid:true };
    default:
      return { valid:true };
  }
}

// ══════════════════════════════════════════════════════════════
// EXTRACT FLAT ANSWERS — pour les prompts
// ══════════════════════════════════════════════════════════════
function flatAnswers(answers) {
  const a = {};
  Object.entries(answers).forEach(([k, v]) => { a[k] = sanitize(v); });
  if (answers.q_rythme) {
    a.q_heures = sanitize(answers.q_rythme.heures);
    a.q_moment = sanitize(answers.q_rythme.moment);
  }
  if (answers.q_pari && answers.q_pari_plus && answers.q_pari_moins) {
    a.q_pari_complet = `${answers.q_pari}/100. Pas plus : ${sanitize(answers.q_pari_plus)}. Pas moins : ${sanitize(answers.q_pari_moins)}.`;
  }
  if (answers.q_urgence && answers.q_cout_statu_quo) {
    a.q_projection_urgence = `Urgent : ${sanitize(answers.q_urgence)}. Coût inaction : ${sanitize(answers.q_cout_statu_quo)}`;
  }
  if (!a.q_montant && answers.q_ancrage) {
    a.q_montant = sanitize(answers.q_ancrage.montant);
  }
  if (answers.q_vision_10ans) {
    const v = answers.q_vision_10ans;
    a.q_vision_10ans = `${v.choice||'?'} — ${v.follow_answer||''} | Vérité: ${v.fixed_answer||''}`;
  }
  return a;
}

// ══════════════════════════════════════════════════════════════
// PROMPTS IA
// ══════════════════════════════════════════════════════════════
function buildPrompt1(answers) {
  const a = flatAnswers(answers);
  const g = id => a[id] || "Non renseigné";
  const domaine = answers.q_domaine_principal || "Non précisé";
  return `TU ES UN ARCHITECTE DE TRANSFORMATION COMPORTEMENTALE.
INTERDICTIONS : "crois en toi" | conseils génériques | jargon coaching | "tu peux le faire"
TEST : chaque phrase doit être impossible à donner à quelqu'un d'autre.
DIAGNOSTIC : MAUVAIS="Tu manques de discipline." BON="Tu relies ton exécution à ton état émotionnel."

DOMAINE : ${domaine}
PROFIL :
${g('q_profil')}
DOMAINE: ${domaine}
Frustration/État: ${g('q_frustration')||g('q_comportement_reccurent')||g('q_pensee_dominante')||g('q_etat_now')}
Profil: ${g('q_profil_financier')||g('q_profil_comportemental')||g('q_etat_mental')||g('q_version_dominante')}
Objectif: ${g('q_objectif')} | Urgence: ${g('q_urgence')||g('q_urgence_projection')||g('q_urgence_version_stable')||g('q_pourquoi_maintenant')}
Sacrifice/Action repoussée: ${g('q_sacrifice')||g('q_activite_repoussee')}
Coût inaction: ${g('q_cout_statu_quo')||g('q_cout_inaction')||g('q_si_pas')}
Niveaux revenus: ${g('q_niveaux_revenus')||''}
Mensonge: ${g('q_mensonge')} | Perte si succès: ${g('q_perte_succes')}
Ligne rouge: ${g('q_ligne_rouge')||g('q_engagement')||''}
Echec historique/Abandon: ${g('q_echec_historique')||g('q_cout_inaction')||''}
Résistance abandon: ${g('q_resistance_abandon')||''}
Emotion déclencheur/Réaction pression: ${g('q_emotion_declencheur')||g('q_reaction_pression')||''}
Phrase négative+Fuite: ${g('q_voix_neg_fuite')||g('q_phrase_neg')||g('q_croyance_limitante')} | Argent: ${g('q_argent_env')||g('q_argent_signifie')||''}
Fuite: ${g('q_fuite')||g('q_fuite_charge')||g('q_stress_financier')} | Moment: ${g('q_moment_fuite')}
Habitude destructrice: ${g('q_habitude_destructrice')||''} | Environnement: ${g('q_environnement')||''}
Charge mentale+Fuite: ${g('q_fuite_charge')||''} | Croyance limitante: ${g('q_croyance_limitante')||''}
Peur dominante: ${g('q_peur_dominante')||''} | Visibilité: ${g('q_visibilite')||''}
Consommation vs construction: ${g('q_consommation_vs_construction')||''} | Discipline réelle: ${g('q_discipline_reelle')||''}
Habitude calmante: ${g('q_habitude_calmante')||''}
Identité cible: ${g('q_identite_cible')||''} | Croyance transformée: ${g('q_croyance_transformation')||''}
Pari: ${g('q_pari_complet')||g('q_pari')||''} | Temps: ${g('q_heures')} | Moment: ${g('q_moment')}
Montant libérateur: ${g('q_montant')||''} | Engagement: ${g('q_engagement')||''}

Génère ce JSON valide EXACTEMENT — sans texte avant ni après, sans backticks :
{"nom_guerre":"string — surnom puissant lié à son profil PRÉCIS, pas générique","pourquoi_ce_nom":"string — explication directe en 1-2 phrases qui fait mouche","identite_future":{"comment_pense":"string — pensée concrète liée au domaine","comment_agit":"string — comportement observable","ne_tolere_plus":"string — lié à ses réponses réelles","nouveaux_standards":"string — ancré dans son objectif"},"diagnostic":{"resume":"3 phrases MAX. Confrontantes. Basées sur VERSION DOMINANTE + COMPORTEMENT D'ÉVITEMENT. Impossible à donner à quelqu'un d'autre.","bloquant_central":"1 seule phrase. Doit faire légèrement mal parce qu'elle est vraie.","schema_sabotage":"Mécanisme précis. Commence par 'Quand tu...' ou 'Dès que...'","lecon_echec":"Ce que l'échec passé révèle sur le mécanisme de sabotage FUTUR.","qualites_cachees":"2 forces réelles cachées derrière les blocages déclarés."},"scorecard":{"discipline":{"score":55,"lecture":"string — 1 phrase confrontante liée au profil"},"focus":{"score":50,"lecture":"string"},"energie":{"score":60,"lecture":"string"},"clarte":{"score":45,"lecture":"string"},"constance":{"score":40,"lecture":"string"},"risque_abandon":"Modéré","facteur_risque":"string — circonstance précise d'abandon probable","levier_principal":"string — point fort exploitable immédiatement","mission_centrale":"string — 1 phrase personnelle qui donne envie d'agir"},"citations_personnelles":["phrase construite à partir de SES PROPRES MOTS des réponses — reconnaissable par lui","phrase — liée à son objectif précis","phrase — liée à sa peur profonde transformée en force"]}
Scores contrastés (écart min 10pts entre scores). Français. Aucun texte hors du JSON.`;
}

function buildPrompt2(answers, nom_guerre) {
  const a = flatAnswers(answers);
  const g = id => a[id] || "Non renseigné";
  const domaine = answers.q_domaine_principal || "";
  return `Coach comportemental. ${g('q_profil')} — Nom de Guerre: ${nom_guerre}
Domaine: ${domaine}
Profil: ${g('q_profil_financier')||g('q_profil_comportemental')||g('q_etat_mental')||g('q_version_dominante')}
Phrase négative/Croyance: ${g('q_phrase_neg')||g('q_croyance_limitante')||g('q_argent_signifie')}
Charge mentale: ${g('q_charge_mentale')||g('q_habitude_destructrice')||''} | Fuite: ${g('q_fuite')||g('q_stress_financier')||''}
Moment de fuite: ${g('q_moment_fuite')} | Objectif: ${g('q_objectif')}
Abandon/Echec: ${g('q_echec_historique')} | Engagement: ${g('q_engagement')}
Point fort/Discipline réelle: ${g('q_point_fort')||g('q_discipline_reelle')||''}
${g('q_moment')} | ${g('q_heures')} | Montant: ${g('q_montant')}
ACTIONS : QUOI + QUAND (heure précise) + DURÉE + CONTEXTE. Jamais vague.

Génère ce JSON valide EXACTEMENT — sans texte avant ni après, sans backticks :
{"rituel":{"autosuggestion":"RÈGLE AUTOSUGGESTION : phrase au présent, première personne, 15-25 mots MAX. Doit utiliser des éléments PRÉCIS du profil (objectif, domaine, point fort). Doit être l'opposé EXACT de la phrase négative avec SES propres mots transformés. EXEMPLES si phrase négative='je n'arrive jamais à finir ce que je commence' → 'Je suis quelqu'un qui termine ce qu'il commence — chaque action complétée me prouve qui je suis vraiment.' JAMAIS générique. JAMAIS 'je suis fort et courageux'.","matin":[{"etape":"Respiration","duree":"5 min","action":"4-7-8"},{"etape":"Recentrage","duree":"2 min","action":"visualisation objectif"},{"etape":"Autosuggestion","duree":"1 min","action":"3 fois à voix haute"}],"premiere_action_du_jour":"1 action dans les 2 min","soir":{"duree":"5 min","action":"révision"}},"anti_saboteur":{"racine":"string","declencheur":"string","strategie_1":"string","strategie_2":"string","strategie_3":"string"},"protocole_rechute":{"contexte":"string","5_minutes":"string","24h":"string","48h":"string","regle_non_zero":"string","jour_difficile":"string","motivation_basse":"string","rechute_emotionnelle":"string","fatigue_mentale":"string"},"anti_abandon":{"regles":["string","string","string"],"version_minimale":"string"},"lectures":[{"titre":"string","auteur":"string","pourquoi":"string"},{"titre":"string","auteur":"string","pourquoi":"string"},{"titre":"string","auteur":"string","pourquoi":"string"}],"message_final":"string","contrat":"string"}
Français direct. Aucun texte hors du JSON.`;
}

function _weeksContext(answers, nom_guerre) {
  const a = flatAnswers(answers);
  const g = id => a[id] || "?";
  const domaine = answers.q_domaine_principal || "Finances";
  const moment = (g('q_moment')||'soir').split('(')[0].trim();
  const heure = moment==='matin'?'07h00':'20h00';
  const heureDim = moment==='matin'?'09h00':'17h00';
  const dur = g('q_heures')||'30 min';
  return { g, domaine, moment, heure, heureDim, dur, nom_guerre };
}

function buildPromptWeeksA(answers, nom_guerre) {
  const {g,domaine,moment,heure,heureDim,dur} = _weeksContext(answers, nom_guerre);
  return `Plan 90j pour ${nom_guerre}. Domaine: ${domaine}. Objectif: ${g('q_objectif')}. Bloquant: ${g('q_bloquants')||g('q_mensonge')}. Temps: ${dur} le ${moment}.
4 jours/semaine: Lundi(lancement), Mercredi(milieu), Vendredi(consolidation), Dimanche(bilan+brainstorming). Tâches: verbe+durée+contexte. Seuil:6.
Génère UNIQUEMENT S1 à S6. JSON strict commence par {:
{"semaines":[{"s":1,"ph":"ÉVEIL","t":"titre percutant","o":"objectif","seuil":6,"lundi":{"h":"${heure}","dur":"${dur}","tache":"tâche concrète"},"mercredi":{"h":"${heure}","dur":"${dur}","tache":"tâche concrète"},"vendredi":{"h":"${heure}","dur":"${dur}","tache":"tâche concrète"},"dimanche":{"h":"${heureDim}","dur":"45 min","tache":"Bilan S1 + planifier S2"},"m":"métrique","r":"risque","v":"victoire"},{"s":2,"ph":"ÉVEIL",...},{"s":3,"ph":"ÉVEIL",...},{"s":4,"ph":"ÉVEIL",...},{"s":5,"ph":"CONSTRUCTION",...},{"s":6,"ph":"CONSTRUCTION",...}]}
Exactement 6 semaines S1-S6. Français concis.`
}

function buildPromptWeeksB(answers, nom_guerre) {
  const {g,domaine,moment,heure,heureDim,dur} = _weeksContext(answers, nom_guerre);
  return `Plan 90j pour ${nom_guerre}. Domaine: ${domaine}. Objectif: ${g('q_objectif')}. Bloquant: ${g('q_bloquants')||g('q_mensonge')}. Temps: ${dur} le ${moment}.
4 jours/semaine: Lundi(lancement), Mercredi(milieu), Vendredi(consolidation), Dimanche(bilan+brainstorming). Tâches: verbe+durée+contexte. Seuil:6.
Génère UNIQUEMENT S7 à S12. JSON strict commence par {:
{"semaines":[{"s":7,"ph":"CONSTRUCTION","t":"titre percutant","o":"objectif","seuil":6,"lundi":{"h":"${heure}","dur":"${dur}","tache":"tâche concrète"},"mercredi":{"h":"${heure}","dur":"${dur}","tache":"tâche concrète"},"vendredi":{"h":"${heure}","dur":"${dur}","tache":"tâche concrète"},"dimanche":{"h":"${heureDim}","dur":"45 min","tache":"Bilan S7 + planifier S8"},"m":"métrique","r":"risque","v":"victoire"},{"s":8,"ph":"CONSTRUCTION",...},{"s":9,"ph":"RÉCOLTE",...},{"s":10,"ph":"RÉCOLTE",...},{"s":11,"ph":"RÉCOLTE",...},{"s":12,"ph":"RÉCOLTE",...}]}
Exactement 6 semaines S7-S12. Français concis.`
}

function buildPromptCoach(plan, plan2, weeks, dailyLogs, question, history) {
  const logs = Object.values(dailyLogs||{}).sort((a,b)=>a.day-b.day);
  const streak = computeStreak(dailyLogs);
  const recentLogs = logs.slice(-7);
  const avgE = recentLogs.length > 0 ? Math.round(recentLogs.reduce((s,l)=>s+(l.energie||3),0)/recentLogs.length*10)/10 : null;
  const execRate = logs.length > 0 ? Math.round((logs.filter(l=>l.action_done).length/logs.length)*100) : null;
  const relapses = logs.filter(l=>l.rechute).length;
  const lastRelapse = [...logs].reverse().find(l=>l.rechute);
  const actionDays = logs.filter(l=>l.action_done).length;
  const missedDays = logs.filter(l=>!l.action_done&&!l.rechute).length;

  const patterns = [];
  if(logs.length >= 5) {
    const streaks = [];
    let cur = 0;
    logs.forEach(l => { if(l.action_done) cur++; else { if(cur>0) streaks.push(cur); cur=0; } });
    if(streaks.length >= 2) {
      const avgStreak = Math.round(streaks.reduce((s,v)=>s+v,0)/streaks.length);
      if(avgStreak <= 5) patterns.push(`Tu abandonnes souvent après ${avgStreak} jours consécutifs — c'est ton seuil de résistance actuel.`);
    }
    const lowEnergyMissed = recentLogs.filter(l=>l.energie<=2&&!l.action_done).length;
    if(lowEnergyMissed >= 2) patterns.push(`Quand ton énergie passe sous 3, tu rates l'action dans ${Math.round(lowEnergyMissed/recentLogs.filter(l=>l.energie<=2).length*100)||0}% des cas — ton énergie gouverne encore ton exécution.`);
    if(lastRelapse && logs.indexOf(lastRelapse) >= logs.length - 3) patterns.push(`Tu as rechuté récemment — surveille les 48h qui suivent, c'est là que l'abandon s'installe.`);
    if(missedDays > actionDays && logs.length >= 7) patterns.push(`Tu manques plus de jours que tu n'en tiens — l'irrégularité est ton vrai adversaire, pas le manque de volonté.`);
  }

  const memoireNarrative = logs.length > 0 ? `
DONNÉES COMPORTEMENTALES (${logs.length} jours trackés) :
— Streak actuel : ${streak} jours consécutifs
— Énergie moyenne récente : ${avgE||'?'}/5
— Taux d'exécution global : ${execRate!=null?execRate+'%':'?'}
— Actions faites : ${actionDays} jours | Manqués : ${missedDays} jours | Rechutes : ${relapses}
— Derniers 7 jours : ${recentLogs.map(l=>`J${l.day}[E:${l.energie||'?'} F:${l.focus||'?'} action:${l.action_done?'✓':'✗'}${l.rechute?' RECHUTE':''}]`).join(' ')}
${patterns.length > 0 ? `\nPATTERNS DÉTECTÉS :\n${patterns.map(p=>`— ${p}`).join('\n')}` : ''}` : "\n(Aucun log encore — l'utilisateur démarre.)";

  const hist = history.slice(-6).map(m=>`${m.role==="user"?"Lui":"Toi"}: ${m.content}`).join("\n");

  return `Tu es le coach de ${plan?.nom_guerre||"cette personne"}. Tu n'es pas un assistant — tu es un système stratégique qui connaît ses patterns profonds.

PROFIL PSYCHOLOGIQUE :
— Bloquant central : ${plan?.diagnostic?.bloquant_central||'?'}
— Schéma de sabotage : ${plan?.diagnostic?.schema_sabotage||'?'}
— Circonstance d'abandon : ${plan2?.protocole_rechute?.contexte||'?'}
— Mission 90j : ${plan?.scorecard?.mission_centrale||'?'}
— Version dominante : ${plan?.diagnostic?.resume?.split('.')[0]||'?'}
${memoireNarrative}

HISTORIQUE RÉCENT :
${hist}

Question : ${question}

RÈGLES ABSOLUES :
— Tu es un coach comportemental socratique — tu POSES UNE QUESTION avant de donner un conseil
— Exception : si l'utilisateur pose une question directe sur son plan ou ses données, réponds directement
— Si on te demande qui tu es : présente-toi comme coach qui connaît les patterns et le plan
— JAMAIS "crois en toi" / "tu peux le faire" / encouragements génériques
— JAMAIS de conseil immédiat sans d'abord diagnostiquer : "Qu'est-ce qui s'est passé exactement ?" / "Quand précisément ?" / "Qu'est-ce que tu ressentais juste avant ?"
— Si pattern détecté → nomme-le directement sans diplomatie
— Si énergie < 3 sur 3 jours consécutifs → anticipe la rechute : "Ton énergie est basse depuis 3 jours. Qu'est-ce qui se passe ?"
— Termine toujours par UNE action concrète avec heure et durée
— Ton : direct, stratégique, parfois confrontant — pas thérapeute
— 3-4 phrases maximum. 1 question. 1 action.`;
}

// ══════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════
function sanitize(v) {
  if (!v) return "Non renseigné";
  if (Array.isArray(v)) return v.join(", ");
  return String(v)
    .replace(/\\/g, " ")
    .replace(/"/g, "'")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/\t/g, " ")
    .trim()
    .slice(0, 300);
}

function repairJSON(raw) {
  if (!raw) return null;

  let text = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try { return JSON.parse(text); } catch(e) {}

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(text.slice(firstBrace, lastBrace + 1)); } catch(e) {}
  }

  try {
    const closers = [];
    let inStr = false, esc = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (esc) { esc = false; continue; }
      if (c === '\\' && inStr) { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{' || c === '[') closers.push(c === '{' ? '}' : ']');
      else if (c === '}' || c === ']') closers.pop();
    }
    if (closers.length > 0) {
      const truncated = inStr
        ? text.slice(0, text.lastIndexOf(',"')) + '"'
        : text;
      const repaired = truncated.replace(/,\s*$/, "") + closers.reverse().join("");
      try { return JSON.parse(repaired); } catch(e) {}
    }
  } catch(e) {}

  return null;
}

const save=(data)=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(data));}catch(e){}};
const load=()=>{try{const d=localStorage.getItem(STORAGE_KEY);return d?JSON.parse(d):null;}catch(e){return null;}};
const clear=()=>{try{localStorage.removeItem(STORAGE_KEY);}catch(e){}};

const todayKey=()=>new Date().toISOString().split('T')[0];
const dayNum=(sd)=>{if(!sd)return 1;return Math.max(1,Math.floor((Date.now()-new Date(sd))/(864e5))+1);};

function computeScore4(dailyLogs, plan) {
  const logs = Object.values(dailyLogs||{}).sort((a,b)=>a.day-b.day);
  if(logs.length === 0) return {execution:0, identite:0, coherence:0, progression:0, global:0};

  const execution = logs.length > 0 ? Math.round((logs.filter(l=>l.action_done).length/logs.length)*100) : 0;
  const identite = logs.length > 0 ? Math.round((logs.filter(l=>l.rituel_done).length/logs.length)*100) : 0;
  const coherence = logs.length > 0 ? Math.round(((logs.length-logs.filter(l=>l.rechute).length)/logs.length)*100) : 100;

  const streak = computeStreak(Object.fromEntries(logs.map(l=>[l.date,l])));
  const maxStreak = Math.max(...logs.reduce((acc,l,i)=>{
    const prev = i>0&&logs[i-1].action_done;
    if(l.action_done) acc[acc.length-1]=(acc[acc.length-1]||0)+1;
    else acc.push(0);
    return acc;
  },[0]), streak);
  const progression = maxStreak > 0 ? Math.min(100, Math.round((streak/Math.max(maxStreak,1))*100)) : 0;

  const global = Math.round((execution+identite+coherence+progression)/4);
  return {execution, identite, coherence, progression, global};
}

function computeStreak(logs) {
  if(!logs||!Object.keys(logs).length)return 0;
  let streak=0;
  const sorted=Object.keys(logs).sort().reverse();
  for(let i=0;i<sorted.length;i++){
    const d=new Date(sorted[i]),exp=new Date();exp.setDate(exp.getDate()-i);
    if(d.toDateString()!==exp.toDateString())break;
    if(logs[sorted[i]].action_done||logs[sorted[i]].rituel_done)streak++;
    else break;
  }
  return streak;
}
function computeStats(logs) {
  const e=Object.values(logs||{});
  return{total:e.length,done:e.filter(l=>l.action_done||l.rituel_done).length,streak:computeStreak(logs),relapses:e.filter(l=>l.rechute).length,totalMins:e.reduce((s,l)=>s+(l.temps||0),0),execRate:e.length>0?Math.round((e.filter(l=>l.action_done).length/e.length)*100):0};
}
const getLevel=(d)=>LEVELS.find(l=>d>=l.min&&d<=l.max)||LEVELS[0];
const getContMsg=(d)=>CONTINUATION_MSGS.find(m=>m.day===d)||null;
const estimateTime=(segs,si,qi)=>{const TM={text:0.3,textarea:0.8,select:0.2,multi:0.3,dual_select:0.4,combo:0.6,adaptive_select:1.0};const rem=segs.flatMap((sg,s)=>sg.questions.filter((_,q)=>s>si||(s===si&&q>=qi)));return Math.ceil(rem.reduce((s,q)=>s+(TM[q.type]||0.5),0));};

// ══════════════════════════════════════════════════════════════
// COMPOSANTS UI
// ══════════════════════════════════════════════════════════════
const CSS=`
  @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  @keyframes pulse{0%,100%{opacity:0.3;transform:scale(0.7)}50%{opacity:1;transform:scale(1.3)}}
  @keyframes breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
  @keyframes shake{0%,100%{transform:translateX(0)}15%{transform:translateX(-9px)}30%{transform:translateX(9px)}45%{transform:translateX(-6px)}60%{transform:translateX(6px)}75%{transform:translateX(-3px)}90%{transform:translateX(3px)}}
  @keyframes slideIn{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:translateX(0)}}
  @keyframes errBlink{0%,100%{border-color:${C.red}}50%{border-color:${C.red}60}}
  @keyframes glow{0%,100%{box-shadow:0 0 6px ${C.gold}40}50%{box-shadow:0 0 20px ${C.gold}80}}
  @keyframes dotBounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}
  @keyframes explode{0%{transform:scale(0) rotate(0deg);opacity:1}100%{transform:scale(2.5) rotate(180deg);opacity:0}}
  @keyframes confettiFall{0%{transform:translateY(-20px) rotate(0deg);opacity:1}100%{transform:translateY(60px) rotate(360deg);opacity:0}}
  @keyframes popIn{0%{transform:scale(0.3);opacity:0}60%{transform:scale(1.15)}100%{transform:scale(1);opacity:1}}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:${C.bg};color:${C.text};font-family:'Jost',sans-serif;font-weight:300;-webkit-font-smoothing:antialiased}
  ::placeholder{color:#2A2520!important}
  ::-webkit-scrollbar{width:8px}
  ::-webkit-scrollbar-track{background:${C.bg2}}
  ::-webkit-scrollbar-thumb{background:${C.gold};border-radius:4px}
  ::-webkit-scrollbar-thumb:hover{background:${C.goldL}}
  textarea,input,select,button{font-family:'Jost',sans-serif;font-weight:300}
`;
const MN={fontFamily:"'DM Mono',monospace"};
const SF={fontFamily:"'Cormorant Garamond',serif"};

function Divider(){return <div style={{width:"50px",height:"1px",background:`linear-gradient(90deg,transparent,${C.gold},transparent)`,margin:"0 auto"}}/>;}
function Card({children,accent=false,style={}}){return <div style={{background:C.bg2,border:`1px solid ${accent?C.goldD:C.border}`,borderTop:`2px solid ${accent?C.gold:C.border}`,padding:"1.4rem",marginBottom:"1rem",...style}}>{children}</div>;}
function Tag({children,color=C.gold}){return <span style={{display:"inline-block",padding:"0.18rem 0.5rem",background:`${color}18`,border:`1px solid ${color}55`,color,fontSize:"0.67rem",letterSpacing:"0.12em",textTransform:"uppercase",...MN}}>{children}</span>;}
function SH({icon,label,sub}){return <div style={{marginBottom:"1.1rem"}}><div style={{display:"flex",alignItems:"center",gap:"0.55rem",marginBottom:"0.2rem"}}><span style={{color:C.gold}}>{icon}</span><span style={{fontSize:"0.58rem",letterSpacing:"0.28em",color:C.gold,textTransform:"uppercase",...MN}}>{label}</span></div>{sub&&<div style={{fontSize:"0.75rem",color:C.textDim,paddingLeft:"1.35rem"}}>{sub}</div>}</div>;}

function ScoreBar({label,score,lecture}){
  const color=score>=70?C.green:score>=45?C.gold:C.red;
  return <div style={{marginBottom:"1rem"}}>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:"0.3rem"}}>
      <span style={{fontSize:"0.7rem",letterSpacing:"0.1em",color:C.textMid,textTransform:"uppercase"}}>{label}</span>
      <span style={{fontSize:"0.82rem",...MN,color}}>{score}/100</span>
    </div>
    <div style={{height:"3px",background:C.bg3,overflow:"hidden"}}>
      <div style={{height:"100%",width:`${score}%`,background:`linear-gradient(90deg,${color}70,${color})`,transition:"width 1.2s ease"}}/>
    </div>
    <div style={{fontSize:"0.72rem",color:C.textDim,marginTop:"0.3rem",lineHeight:1.45,fontStyle:"italic"}}>{lecture}</div>
  </div>;
}

function ProgressCircle({day,total=90,size=110}){
  const pct=Math.min(day/total,1),r=44,circ=2*Math.PI*r,dash=circ*pct,lv=getLevel(day);
  return <div style={{position:"relative",width:`${size}px`,height:`${size}px`,flexShrink:0}}>
    <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.bg3} strokeWidth="6"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={lv.color} strokeWidth="6" strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{transition:"stroke-dasharray 1s ease"}}/>
    </svg>
    <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
      <div style={{fontSize:"1.5rem",...SF,color:lv.color,lineHeight:1}}>{day}</div>
      <div style={{fontSize:"0.52rem",color:C.textDim,...MN}}>/ {total}</div>
    </div>
  </div>;
}

// ── VORTEX RESPIRATOIRE 4-7-8 — cercle qui respire ─────────────
function BreathingVortex({onDone}){
  const TOTAL_CYCLES = 15;
  const PHASES = [
    {label:"Inspire",  dur:4,  color:C.blue,   size:140, ease:"ease-in"},
    {label:"Bloque",   dur:7,  color:C.gold,   size:140, ease:"linear"},
    {label:"Expire",   dur:8,  color:C.purple, size:70,  ease:"ease-out"},
  ];
  const MIN_SIZE = 70;

  const [phaseIdx, setPhaseIdx] = useState(0);
  const [tick,     setTick]     = useState(0);
  const [cycle,    setCycle]    = useState(0);
  const [finished, setFinished] = useState(false);
  const [skipped,  setSkipped]  = useState(false);
  const ref = useRef(null);

  useEffect(()=>{
    if(finished||skipped)return;
    ref.current = setInterval(()=>{
      setTick(t=>{
        const dur = PHASES[phaseIdx].dur;
        if(t+1 >= dur){
          clearInterval(ref.current);
          const nextPhase = (phaseIdx+1) % PHASES.length;
          const nextCycle = nextPhase===0 ? cycle+1 : cycle;
          if(nextPhase===0 && nextCycle >= TOTAL_CYCLES){
            setFinished(true);
            setTimeout(()=>onDone?.(), 800);
            return 0;
          }
          setPhaseIdx(nextPhase);
          setCycle(nextCycle);
          return 0;
        }
        return t+1;
      });
    },1000);
    return()=>clearInterval(ref.current);
  },[phaseIdx,finished,skipped]);

  const ph = PHASES[phaseIdx];
  const secsLeft = ph.dur - tick;
  const totalSecs = TOTAL_CYCLES * 19;
  const elapsed = cycle*19 + [0,4,11][phaseIdx] + tick;
  const globalPct = Math.round((elapsed/totalSecs)*100);
  const minsLeft = Math.ceil((totalSecs-elapsed)/60);

  const handleSkip = () => {
    clearInterval(ref.current);
    setSkipped(true);
    setTimeout(()=>onDone?.(), 400);
  };

  if(finished||skipped) return(
    <div style={{textAlign:"center",padding:"1.5rem",animation:"fadeIn 0.5s ease"}}>
      <div style={{fontSize:"2rem",marginBottom:"0.5rem"}}>✓</div>
      <div style={{...SF,fontSize:"1.1rem",color:C.green,marginBottom:"0.25rem"}}>
        {skipped?"Respiration terminée":"5 minutes complètes"}
      </div>
      <div style={{fontSize:"0.72rem",color:C.textDim,...MN}}>{cycle} cycle{cycle>1?"s":""}  · Rythme 4-7-8</div>
    </div>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"0.8rem 0 0.5rem"}}>
      <div style={{position:"relative",width:"180px",height:"180px",marginBottom:"0.8rem",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{
          position:"absolute",
          width:`${ph.size+30}px`,height:`${ph.size+30}px`,
          borderRadius:"50%",
          background:`${ph.color}08`,
          transition:`width ${ph.dur}s ${ph.ease}, height ${ph.dur}s ${ph.ease}`,
        }}/>
        <div style={{
          position:"relative",
          width:`${ph.size}px`,
          height:`${ph.size}px`,
          borderRadius:"50%",
          background:`radial-gradient(circle at 40% 35%, ${ph.color}60, ${ph.color}20)`,
          border:`2px solid ${ph.color}80`,
          boxShadow:`0 0 ${phaseIdx===1?40:20}px ${ph.color}${phaseIdx===1?"50":"25"}`,
          transition:`width ${ph.dur}s ${ph.ease}, height ${ph.dur}s ${ph.ease}, box-shadow ${ph.dur}s ${ph.ease}`,
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
          zIndex:2,
        }}>
          <div style={{
            fontSize:"0.6rem",color:ph.color,letterSpacing:"0.18em",
            textTransform:"uppercase",...MN,marginBottom:"0.2rem",
            opacity:0.9
          }}>{ph.label}</div>
          <div style={{
            ...SF,fontSize:"2.2rem",color:ph.color,lineHeight:1,
            textShadow:`0 0 15px ${ph.color}80`
          }}>{secsLeft}</div>
          <div style={{fontSize:"0.5rem",color:ph.color,opacity:0.6,...MN,marginTop:"0.15rem"}}>sec</div>
        </div>
      </div>

      <div style={{
        fontSize:"0.82rem",color:C.textMid,textAlign:"center",
        lineHeight:1.6,marginBottom:"0.5rem",minHeight:"1.4rem",
        transition:"opacity 0.3s"
      }}>
        {phaseIdx===0 && "Inspire doucement par le nez…"}
        {phaseIdx===1 && "Bloque. Tiens. Ne bouge pas."}
        {phaseIdx===2 && "Expire lentement par la bouche…"}
      </div>

      <div style={{width:"160px",marginBottom:"0.5rem"}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.55rem",color:C.textDim,...MN,marginBottom:"0.2rem"}}>
          <span>Cycle {cycle+1}/{TOTAL_CYCLES}</span>
          <span>~{minsLeft} min restantes</span>
        </div>
        <div style={{height:"2px",background:C.bg3,borderRadius:"1px"}}>
          <div style={{height:"100%",width:`${globalPct}%`,background:`linear-gradient(90deg,${C.blue},${C.gold})`,transition:"width 1s linear",borderRadius:"1px"}}/>
        </div>
      </div>

      <button onClick={handleSkip} style={{
        background:"transparent",border:`1px solid ${C.border}`,
        color:C.textDim,fontSize:"0.65rem",letterSpacing:"0.1em",...MN,
        padding:"0.3rem 0.8rem",cursor:"pointer",marginTop:"0.3rem"
      }}>Passer →</button>
    </div>
  );
}

// ── SONS RITUEL ────────────────────────────────────────────
function playBip() {
  try {
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(440, ctx.currentTime+0.15);
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.15);
    o.start(); o.stop(ctx.currentTime+0.15);
  } catch(e){}
}

function playGong() {
  try {
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    [[110,1.0],[220,0.6],[330,0.4],[440,0.3],[880,0.15]].forEach(([freq,vol],i)=>{
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = i===0?'sine':'sine';
      o.frequency.setValueAtTime(freq, ctx.currentTime+i*0.01);
      o.frequency.exponentialRampToValueAtTime(freq*0.98, ctx.currentTime+2);
      g.gain.setValueAtTime(vol*0.4, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+2.5);
      o.start(ctx.currentTime+i*0.01);
      o.stop(ctx.currentTime+2.5);
    });
  } catch(e){}
}

// ── ÉTAPE RITUEL AVEC TIMER DÉDIÉ ──────────────────────────
function RituelTimer({steps, onComplete, nomGuerre}){
  const [state, setState] = useState({
    phase:"idle", idx:0, t:null, countdown:3
  });
  const timerRef = useRef(null);
  const cdRef = useRef(null);
  const prenom = nomGuerre?.split(" ")[0] || "toi";

  const parse = s => {
    const m = s?.match(/(\d+)\s*min/), sc = s?.match(/(\d+)\s*s/);
    return (m?+m[1]*60:0)+(sc?+sc[1]:0)||120;
  };
  const fmt = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
  const totalMins = Math.ceil(steps.reduce((s,st)=>s+parse(st?.duree),0)/60);

  const step = steps[state.idx];
  const total = parse(step?.duree);
  const isBreathing = step?.etape==="Respiration";

  const STEP_MSGS = {
    "Respiration":{titre:"Bien joué 👍",msg:"Ton système nerveux vient de se recalibrer. Ton cerveau est plus calme et plus disponible.",sous:"Prends 3 secondes. Sens la différence.",color:C.blue},
    "Recentrage":{titre:"Bravo 👏",msg:"Tu viens de visualiser ce qui compte vraiment. Garde cette image avec toi.",sous:"Une dernière étape — la plus courte, la plus puissante.",color:C.gold},
    "Autosuggestion":{titre:"Félicitations 🎉",msg:"Rituel accompli. Lance ta première action maintenant.",sous:"Pas dans 5 minutes. Maintenant.",color:C.green},
  };
  const doneMsg = STEP_MSGS[step?.etape]||{titre:"Étape accomplie ✓",msg:"Continue.",sous:"",color:C.green};

  const startCountdown = () => {
    clearInterval(cdRef.current);
    setState(s=>({...s,phase:"countdown",countdown:3}));
    let c=3;
    cdRef.current = setInterval(()=>{
      c--;
      playBip();
      if(c<=0){
        clearInterval(cdRef.current);
        setState(s=>({...s,phase:"running",t:parse(steps[s.idx]?.duree)}));
      } else {
        setState(s=>({...s,countdown:c}));
      }
    },1000);
  };

  useEffect(()=>{
    if(state.phase!=="running"||state.t===null||isBreathing)return;
    if(state.t<=0){
      clearInterval(timerRef.current);
      playGong();
      setState(s=>({...s,phase:"step_done"}));
      return;
    }
    timerRef.current = setInterval(()=>setState(s=>({...s,t:s.t-1})),1000);
    return()=>clearInterval(timerRef.current);
  },[state.phase, state.t, state.idx]);

  useEffect(()=>()=>{clearInterval(cdRef.current);clearInterval(timerRef.current);},[]);

  const nextStep = () => {
    const nextIdx = state.idx+1;
    if(nextIdx>=steps.length){
      playGong();
      setState(s=>({...s,phase:"rituel_done"}));
      onComplete?.();
    } else {
      setState(s=>({...s,phase:"idle",idx:nextIdx,t:null}));
    }
  };

  const skipStep = () => {
    const nextIdx = state.idx+1;
    if(nextIdx>=steps.length){
      setState(s=>({...s,phase:"rituel_done"}));
      onComplete?.();
    } else {
      setState(s=>({...s,phase:"idle",idx:nextIdx,t:null}));
    }
  };

  const prog = total>0&&state.t!==null ? ((total-state.t)/total)*100 : 0;

  if(state.phase==="rituel_done") return(
    <div style={{animation:"fadeUp 0.4s ease",textAlign:"center"}}>
      <div style={{position:"relative",height:"70px",overflow:"hidden",marginBottom:"0.5rem"}}>
        {["🎉","✨","⭐","💫","🌟","🎊","✦","⚡","🔥","🏅"].map((e,i)=>(
          <span key={i} style={{position:"absolute",left:`${5+i*9}%`,top:"50%",fontSize:`${1+i%3*0.4}rem`,animation:`confettiFall 1s ease ${i*0.07}s both`}}>{e}</span>
        ))}
      </div>
      <div style={{background:`${C.green}10`,border:`1px solid ${C.green}30`,borderTop:`4px solid ${C.green}`,padding:"1.5rem 1.2rem",marginBottom:"1rem",animation:"popIn 0.5s ease 0.3s both"}}>
        <div style={{...SF,fontSize:"1.3rem",color:C.green,marginBottom:"0.8rem"}}>Félicitations 🎉</div>
        <p style={{fontSize:"0.85rem",color:C.text,lineHeight:1.85,marginBottom:"0.6rem"}}>Tu viens de faire ce que la majorité des gens ne fera jamais ce matin. Ton cerveau est calibré. Ton intention est posée.</p>
        <p style={{fontSize:"0.78rem",color:C.textDim,lineHeight:1.6,fontStyle:"italic"}}>Lance maintenant ta première action. Pas dans 5 minutes. Maintenant.</p>
      </div>
      <button onClick={()=>setState({phase:"idle",idx:0,t:null,countdown:3})} style={{padding:"0.4rem 1rem",background:"transparent",border:`1px solid ${C.border}`,color:C.textDim,fontSize:"0.68rem",cursor:"pointer"}}>↺ Recommencer</button>
    </div>
  );

  if(state.phase==="step_done") return(
    <div style={{animation:"fadeUp 0.4s ease",textAlign:"center"}}>
      <div style={{background:`${doneMsg.color}10`,border:`1px solid ${doneMsg.color}30`,borderTop:`4px solid ${doneMsg.color}`,padding:"1.2rem",marginBottom:"0.8rem"}}>
        <div style={{...SF,fontSize:"1.2rem",color:doneMsg.color,marginBottom:"0.5rem"}}>{doneMsg.titre}</div>
        <p style={{fontSize:"0.82rem",color:C.text,lineHeight:1.75,marginBottom:"0.35rem"}}>{doneMsg.msg}</p>
        {doneMsg.sous&&<p style={{fontSize:"0.75rem",color:C.textDim,fontStyle:"italic"}}>{doneMsg.sous}</p>}
      </div>
      <button onClick={nextStep} style={{
        width:"100%",padding:"0.85rem",background:doneMsg.color,border:"none",
        color:C.bg,fontSize:"0.72rem",letterSpacing:"0.12em",cursor:"pointer",fontWeight:500
      }}>Continuer →</button>
    </div>
  );

  const StepBar = ()=>(
    <div style={{display:"flex",gap:"0.3rem",marginBottom:"0.75rem"}}>
      {steps.map((_,i)=>(
        <div key={i} style={{flex:1,height:"3px",background:i<state.idx?C.green:i===state.idx?C.gold:C.bg3,borderRadius:"2px",transition:"background 0.3s"}}/>
      ))}
    </div>
  );

  if(state.phase==="idle") return(
    <div>
      <StepBar/>
      <div style={{padding:"0.85rem 1rem",background:`${C.gold}08`,borderLeft:`3px solid ${C.goldD}`,marginBottom:"0.8rem"}}>
        <div style={{fontSize:"0.56rem",color:C.goldD,letterSpacing:"0.15em",textTransform:"uppercase",...MN,marginBottom:"0.4rem"}}>
          Étape {state.idx+1}/{steps.length} · {step?.duree}
        </div>
        <div style={{...SF,fontSize:"1rem",color:C.gold,marginBottom:"0.35rem"}}>{step?.etape}</div>
        <div style={{fontSize:"0.82rem",color:C.textMid,lineHeight:1.6}}>{step?.action}</div>
      </div>
      {state.idx===0&&(
        <div style={{marginBottom:"0.8rem"}}>
          {steps.map((s,i)=>i>0&&(
            <div key={i} style={{display:"flex",gap:"0.6rem",alignItems:"flex-start",marginBottom:"0.4rem",opacity:0.6}}>
              <span style={{color:C.goldD,...MN,fontSize:"0.6rem",minWidth:"1rem"}}>{i+1}.</span>
              <span style={{fontSize:"0.75rem",color:C.textDim}}>{s.etape} ({s.duree})</span>
            </div>
          ))}
        </div>
      )}
      <button onClick={startCountdown} style={{
        width:"100%",padding:"0.9rem",background:C.gold,border:"none",
        color:C.bg,fontSize:"0.72rem",letterSpacing:"0.18em",textTransform:"uppercase",
        fontWeight:500,cursor:"pointer",animation:"glow 2s ease-in-out infinite"
      }}>▶ Démarrer</button>
      <button onClick={skipStep} style={{width:"100%",padding:"0.35rem",background:"transparent",border:"none",color:C.textDim,fontSize:"0.62rem",cursor:"pointer",marginTop:"0.3rem"}}>Passer →</button>
    </div>
  );

  if(state.phase==="countdown") return(
    <div style={{textAlign:"center",padding:"1.5rem 1rem",animation:"fadeIn 0.3s ease"}}>
      <StepBar/>
      <div style={{fontSize:"0.58rem",color:C.goldD,letterSpacing:"0.2em",textTransform:"uppercase",...MN,marginBottom:"0.6rem"}}>{step?.etape} · Début dans…</div>
      <div style={{...SF,fontSize:"5rem",color:C.gold,lineHeight:1,animation:"pulse 0.8s ease-in-out infinite",textShadow:`0 0 30px ${C.gold}60`}}>{state.countdown}</div>
    </div>
  );

  if(state.phase==="running" && isBreathing) return(
    <div>
      <StepBar/>
      <BreathingVortex onDone={()=>{playGong();setState(s=>({...s,phase:"step_done"}));}}/>
    </div>
  );

  return(
    <div>
      <StepBar/>
      <div style={{background:C.bg3,border:`1px solid ${C.goldD}`,padding:"1rem",animation:"fadeIn 0.3s ease"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.45rem"}}>
          <span style={{fontSize:"0.56rem",color:C.goldD,letterSpacing:"0.18em",textTransform:"uppercase",...MN}}>{step?.etape}</span>
          <span style={{...MN,fontSize:"1.4rem",color:state.t<=10?C.red:C.gold,fontWeight:400,animation:state.t<=10?"pulse 0.8s ease infinite":"none"}}>{fmt(state.t)}</span>
        </div>
        <div style={{fontSize:"0.81rem",color:C.textMid,lineHeight:1.5,marginBottom:"0.65rem"}}>{step?.action}</div>
        <div style={{height:"4px",background:C.bg,borderRadius:"2px",marginBottom:"0.5rem"}}>
          <div style={{height:"100%",width:`${prog}%`,background:`linear-gradient(90deg,${C.goldD},${C.gold})`,borderRadius:"2px",transition:"width 1s linear"}}/>
        </div>
        <button onClick={()=>{clearInterval(timerRef.current);playGong();setState(s=>({...s,phase:"step_done"}));}}
          style={{width:"100%",padding:"0.4rem",background:`${C.gold}15`,border:`1px solid ${C.goldD}`,color:C.gold,fontSize:"0.68rem",cursor:"pointer"}}>
          Terminer cette étape →
        </button>
      </div>
    </div>
  );
}

function DailyTracker({dayNum,todayLog,onSave,logs={}}){
  const [humeur,setHumeur]=useState(todayLog?.humeur||null);
  const [energie,setEnergie]=useState(todayLog?.energie||null);
  const [focus,setFocus]=useState(todayLog?.focus||null);
  const [action,setAction]=useState(todayLog?.action_done??null);
  const [rituel,setRituel]=useState(todayLog?.rituel_done??false);
  const [rechute,setRechute]=useState(todayLog?.rechute??false);
  const [showRelapseDiag,setShowRelapseDiag]=useState(false);
  const [relapseCause,setRelapseCause]=useState('');
  const [relapseLesson,setRelapseLesson]=useState('');
  const [temps,setTemps]=useState(todayLog?.temps||0);
  const [saved,setSaved]=useState(!!todayLog);
  const score=Math.max(0,Math.round((((humeur||0)+(energie||0)+(focus||0))/15)*50+((action?30:0)+(rituel?15:0)+(rechute?-10:0))));
  const HUMEURS=[{v:1,e:"😞"},{v:2,e:"😕"},{v:3,e:"😐"},{v:4,e:"🙂"},{v:5,e:"😊"}];
  const ready=humeur&&energie&&focus&&action!==null;
  if(saved)return <div style={{padding:"0.9rem",background:`${C.green}0A`,border:`1px solid ${C.green}30`,borderLeft:`3px solid ${C.green}`}}>
    <div style={{fontSize:"0.56rem",color:C.green,letterSpacing:"0.15em",...MN,marginBottom:"0.2rem"}}>Journée enregistrée · Jour {dayNum}</div>
    <div style={{display:"flex",gap:"1rem",alignItems:"center"}}>
      <span style={{fontSize:"0.8rem",color:C.text}}>H{todayLog?.humeur||humeur}/5 · É{todayLog?.energie||energie}/5 · Score <span style={{color:C.gold,fontWeight:500}}>{todayLog?.score||score}</span>/100</span>
      <button onClick={()=>setSaved(false)} style={{background:"none",border:"none",color:C.textDim,fontSize:"0.68rem",cursor:"pointer"}}>Modifier</button>
    </div>
  </div>;
  return <div>
    <div style={{marginBottom:"0.8rem"}}>
      <div style={{fontSize:"0.56rem",color:C.goldD,letterSpacing:"0.15em",...MN,marginBottom:"0.35rem"}}>HUMEUR</div>
      <div style={{display:"flex",gap:"0.4rem"}}>{HUMEURS.map(h=><button key={h.v} onClick={()=>setHumeur(h.v)} style={{flex:1,padding:"0.45rem",fontSize:"1.2rem",background:humeur===h.v?`${C.gold}20`:"transparent",border:`1px solid ${humeur===h.v?C.gold:C.border}`,cursor:"pointer",transition:"all 0.15s"}}>{h.e}</button>)}</div>
    </div>
    {[["ÉNERGIE",energie,setEnergie],["FOCUS",focus,setFocus]].map(([lbl,val,set])=><div key={lbl} style={{marginBottom:"0.8rem"}}>
      <div style={{fontSize:"0.56rem",color:C.goldD,letterSpacing:"0.15em",...MN,marginBottom:"0.35rem"}}>{lbl}</div>
      <div style={{display:"flex",gap:"0.35rem"}}>{[1,2,3,4,5].map(n=><button key={n} onClick={()=>set(n)} style={{flex:1,padding:"0.42rem",background:val===n?`${C.gold}20`:val&&n<=val?`${C.gold}08`:"transparent",border:`1px solid ${val===n?C.gold:C.border}`,color:val===n?C.gold:C.textMid,...MN,fontSize:"0.83rem",cursor:"pointer",transition:"all 0.15s"}}>{n}</button>)}</div>
    </div>)}
    <div style={{marginBottom:"0.8rem"}}>
      <div style={{fontSize:"0.56rem",color:C.goldD,letterSpacing:"0.15em",...MN,marginBottom:"0.35rem"}}>ACTION PRINCIPALE</div>
      <div style={{display:"flex",gap:"0.4rem"}}>
        {[["✓ Faite",true,C.green],["✗ Non faite",false,C.red]].map(([lbl,val,color])=><button key={lbl} onClick={()=>setAction(val)} style={{flex:1,padding:"0.52rem",background:action===val?`${color}15`:"transparent",border:`1px solid ${action===val?color:C.border}`,color:action===val?color:C.textMid,fontSize:"0.78rem",cursor:"pointer",transition:"all 0.2s"}}>{lbl}</button>)}
      </div>
    </div>
    <div style={{display:"flex",gap:"0.5rem",marginBottom:"0.8rem"}}>
      {[[rituel,setRituel,"Rituel",C.gold],[rechute,setRechute,"Rechute",C.red]].map(([val,set,lbl,color])=><label key={lbl} style={{flex:1,padding:"0.45rem 0.6rem",background:val?`${color}12`:"transparent",border:`1px solid ${val?color:C.border}`,cursor:"pointer",display:"flex",gap:"0.4rem",alignItems:"center",fontSize:"0.78rem",color:val?color:C.textMid}} onClick={()=>{set(p=>!p);if(lbl==="Rechute"&&!val)setShowRelapseDiag(true);}}>
        <span style={{fontSize:"0.58rem"}}>{val?"◉":"◎"}</span>{lbl}
      </label>)}
    </div>
    <div style={{marginBottom:"0.8rem"}}>
      <div style={{fontSize:"0.56rem",color:C.goldD,letterSpacing:"0.15em",...MN,marginBottom:"0.35rem"}}>TEMPS INVESTI</div>
      <div style={{display:"flex",gap:"0.3rem"}}>{[0,15,30,45,60,90].map(n=><button key={n} onClick={()=>setTemps(n)} style={{flex:1,padding:"0.38rem 0.1rem",background:temps===n?`${C.gold}18`:"transparent",border:`1px solid ${temps===n?C.gold:C.border}`,color:temps===n?C.gold:C.textMid,...MN,fontSize:"0.7rem",cursor:"pointer"}}>{n===0?"0":n+"'"}</button>)}</div>
    </div>
    {showRelapseDiag&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.9)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:"1.5rem"}}>
      <div style={{background:C.bg2,border:`1px solid ${C.red}`,borderTop:`3px solid ${C.red}`,padding:"1.5rem",maxWidth:"380px",width:"100%"}}>
        <div style={{fontSize:"0.55rem",color:C.red,letterSpacing:"0.2em",textTransform:"uppercase",...MN,marginBottom:"0.8rem"}}>Diagnostic Rechute</div>
        <div style={{fontSize:"0.9rem",color:C.gold,marginBottom:"1rem",fontFamily:"Georgia,serif"}}>Qu'est-ce qui s'est passé ?</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:"0.4rem",marginBottom:"1rem"}}>
          {["Fatigue","Stress","Distraction","Émotion difficile","Environnement","Manque de temps","Ennui","Autre"].map(c=>(
            <button key={c} onClick={()=>setRelapseCause(c)} style={{padding:"0.35rem 0.75rem",background:relapseCause===c?`${C.red}20`:"transparent",border:`1px solid ${relapseCause===c?C.red:C.border}`,color:relapseCause===c?C.red:C.textMid,fontSize:"0.72rem",cursor:"pointer"}}>{c}</button>
          ))}
        </div>
        <div style={{fontSize:"0.78rem",color:C.textMid,marginBottom:"0.5rem"}}>Qu'est-ce que tu retiens de cette rechute ?</div>
        <textarea value={relapseLesson} onChange={e=>setRelapseLesson(e.target.value)} placeholder="Ce que j'apprends de cette rechute..." style={{width:"100%",background:C.bg3,border:`1px solid ${C.border}`,color:C.text,padding:"0.6rem",fontSize:"0.78rem",minHeight:"60px",resize:"none",boxSizing:"border-box",marginBottom:"0.8rem"}}/>
        <button onClick={()=>setShowRelapseDiag(false)} style={{width:"100%",padding:"0.7rem",background:C.red,border:"none",color:"#fff",fontSize:"0.72rem",letterSpacing:"0.1em",cursor:"pointer"}}>Enregistrer et continuer</button>
      </div>
    </div>}
    <button onClick={()=>{if(!ready)return;onSave({day:dayNum,humeur,energie,focus,action_done:action,rituel_done:rituel,rechute,temps,score,date:todayKey(),rechute_cause:relapseCause,rechute_lecon:relapseLesson});setSaved(true);}} disabled={!ready} style={{width:"100%",padding:"0.82rem",background:ready?C.gold:C.bg3,border:"none",color:ready?C.bg:C.textDim,fontSize:"0.73rem",letterSpacing:"0.15em",textTransform:"uppercase",fontWeight:500,opacity:ready?1:0.5,transition:"all 0.25s",cursor:ready?"pointer":"not-allowed"}}>
      Enregistrer{score>0?` · Score ${score}/100`:""}
    </button>
    {saved&&<div style={{textAlign:"center",padding:"0.75rem 0",animation:"fadeIn 0.4s ease"}}>
      <div style={{color:C.green,fontSize:"0.82rem",marginBottom:"0.2rem"}}>✓ Enregistré</div>
      {(()=>{
        const streak=computeStreak(logs)||1;
        const msg=streak>=30?"🔥 30 jours. Top 5% mondial.":
          streak>=21?"⚡ 21 jours. Ton cerveau recâble.":
          streak>=14?"💪 14 jours. La plupart ont abandonné.":
          streak>=7?"✦ 7 jours. Le mouvement est lancé.":
          streak>=3?`◈ ${streak} jours consécutifs. Continue.`:
          "Chaque jour compte. Même celui-ci.";
        return <div style={{fontSize:"0.74rem",color:C.goldD,fontStyle:"italic",...SF}}>{msg}</div>;
      })()}
    </div>}
  </div>;
}

// ── Calcul score semaine depuis les logs journaliers ──
function computeWeekScore(weekNum, logs, startDate){
  if(!startDate||!logs) return null;
  const start = new Date(startDate);
  const weekStart = new Date(start.getTime() + (weekNum-1)*7*24*3600*1000);
  const weekEnd   = new Date(weekStart.getTime() + 7*24*3600*1000);
  const weekLogs  = Object.entries(logs)
    .filter(([k])=>{ const d=new Date(k); return d>=weekStart && d<weekEnd; })
    .map(([,v])=>v);
  if(weekLogs.length===0) return null;
  const actionPts = weekLogs.length>0 ? Math.round((weekLogs.filter(l=>l.action_done).length/weekLogs.length)*4*10)/10 : 0;
  const regPts = Math.round((weekLogs.length/7)*3*10)/10;
  const avgE = weekLogs.reduce((s,l)=>s+(l.energie||3),0)/weekLogs.length;
  const ePts = Math.round((avgE/5)*2*10)/10;
  const rechutePts = weekLogs.some(l=>l.rechute) ? 0 : 1;
  const total = Math.min(10, Math.round((actionPts+regPts+ePts+rechutePts)*10)/10);
  return { total, actionPts, regPts, ePts, rechutePts, logsCount: weekLogs.length };
}

function WeekCard({w, checked, onCheck, isLocked, prevWeekScore, weekNum: wNum, nomGuerre, logs, startDate}){
  const [open,setOpen]=useState(false);
  const [showWeekDone,setShowWeekDone]=useState(false);
  const weekNum=wNum||w.semaine||w.s;
  const ph=w.phase||w.ph||"ÉVEIL";
  const pc=ph==="ÉVEIL"?C.blue:ph==="CONSTRUCTION"?C.gold:C.green;
  const seuil=w.seuil||6;

  const days=[
    {key:"lundi",   label:"Lundi",    emoji:"🗓"},
    {key:"mercredi",label:"Mercredi", emoji:"⚡"},
    {key:"vendredi",label:"Vendredi", emoji:"🎯"},
    {key:"dimanche",label:"Dimanche", emoji:"📊"},
  ];

  const score = computeWeekScore(weekNum, logs, startDate);
  const scoreTotal = score?.total ?? null;
  const scoreColor = scoreTotal===null?C.textDim:scoreTotal>=seuil?C.green:scoreTotal>=4?C.gold:C.red;
  const semainePasse = scoreTotal!==null;
  const debloque = scoreTotal===null ? false : scoreTotal>=seuil;

  const daysDone=days.filter(d=>checked[`${weekNum}-${d.key}`]).length;
  const allDaysDone=daysDone>=3;

  const handleDayCheck=(dayKey,val)=>{
    const key=`${weekNum}-${dayKey}`;
    onCheck(key,val);
    const newCount=days.filter(d=>d.key===dayKey?val:!!checked[`${weekNum}-${d.key}`]).length;
    if(newCount>=3 && daysDone<3){ setOpen(true); setTimeout(()=>setShowWeekDone(true),600); }
  };

  if(showWeekDone) return(
    <div style={{animation:"fadeUp 0.3s ease",padding:"1.2rem",marginBottom:"0.5rem",position:"relative"}}>
      <div style={{position:"fixed",inset:0,background:`${pc}15`,zIndex:10,pointerEvents:"none"}}/>
      <div style={{position:"fixed",inset:0,zIndex:11,pointerEvents:"none",overflow:"hidden"}}>
        {[...Array(24)].map((_,i)=>{
          const emojis=["🏆","🎉","✨","⭐","💫","🌟","🎊","✦","⚡","🔥","🥇","🎯"];
          return <span key={i} style={{position:"absolute",left:`${Math.random()*95}%`,top:`${-10+Math.random()*20}%`,fontSize:`${0.8+Math.random()*1.2}rem`,animation:`confettiFall ${0.8+Math.random()*0.8}s ease ${i*0.05}s both`}}>{emojis[i%emojis.length]}</span>;
        })}
      </div>
      <div style={{position:"relative",zIndex:12,background:`${pc}12`,border:`2px solid ${pc}50`,borderTop:`5px solid ${pc}`,padding:"1.8rem 1.2rem",textAlign:"center",marginBottom:"1rem",animation:"popIn 0.6s ease 0.2s both",boxShadow:`0 0 40px ${pc}30`}}>
        <div style={{fontSize:"3rem",marginBottom:"0.6rem"}}>🏆</div>
        <div style={{...SF,fontSize:"1.2rem",color:pc,marginBottom:"0.7rem"}}>Semaine {weekNum} — jours complétés</div>
        <p style={{fontSize:"0.82rem",color:C.text,lineHeight:1.85,marginBottom:"0.6rem"}}>Ton score sera calculé automatiquement dimanche à partir de ton tracker journalier.</p>
        {score&&<div style={{background:`${scoreColor}15`,border:`1px solid ${scoreColor}40`,padding:"0.7rem",marginBottom:"0.7rem"}}>
          <div style={{fontSize:"0.58rem",color:scoreColor,...MN,letterSpacing:"0.12em",marginBottom:"0.3rem"}}>SCORE SEMAINE {weekNum}</div>
          <div style={{...SF,fontSize:"1.8rem",color:scoreColor}}>{scoreTotal}<span style={{fontSize:"0.9rem",color:C.textMid}}>/10</span></div>
          <div style={{fontSize:"0.7rem",color:scoreTotal>=seuil?C.green:C.red,marginTop:"0.3rem"}}>{scoreTotal>=seuil?`✓ Semaine ${weekNum+1} débloquée`:`✗ Score insuffisant (seuil : ${seuil}/10)`}</div>
        </div>}
        {weekNum<12&&<p style={{fontSize:"0.78rem",color:pc,lineHeight:1.6,fontStyle:"italic"}}>✦ Continue le tracker chaque jour pour maximiser ton score.</p>}
        {weekNum===12&&<p style={{fontSize:"0.85rem",color:C.green,lineHeight:1.6}}>✦ Tu as tenu les 90 jours. Peu de gens peuvent dire ça.</p>}
      </div>
      <button onClick={()=>setShowWeekDone(false)} style={{position:"relative",zIndex:1,width:"100%",padding:"0.9rem",background:pc,border:"none",color:C.bg,fontSize:"0.74rem",letterSpacing:"0.15em",textTransform:"uppercase",fontWeight:500,cursor:"pointer"}}>
        Voir la semaine ✦
      </button>
    </div>
  );

  if(isLocked) return(
    <div style={{marginBottom:"0.5rem",border:`1px solid ${C.border}30`,background:`${C.bg2}80`,opacity:0.65}}>
      <div style={{padding:"0.75rem 0.85rem",display:"flex",alignItems:"center",gap:"0.65rem"}}>
        <span style={{...MN,fontSize:"0.63rem",color:C.textDim,minWidth:"2rem"}}>S{weekNum}</span>
        <Tag color={C.textDim}>{ph}</Tag>
        <span style={{flex:1,color:C.textDim,fontSize:"0.83rem"}}>{w.titre||w.t}</span>
        <span style={{fontSize:"0.8rem"}}>🔒</span>
      </div>
      <div style={{padding:"0 0.85rem 0.75rem"}}>
        <div style={{padding:"0.55rem 0.8rem",background:`${C.gold}08`,border:`1px solid ${C.goldD}25`,borderLeft:`3px solid ${C.goldD}`,fontSize:"0.72rem",color:C.textDim,lineHeight:1.6}}>
          ✦ Score ≥ {seuil}/10 à la S{weekNum-1} requis pour débloquer.
          {prevWeekScore!==null&&prevWeekScore!==undefined&&
            <span style={{color:prevWeekScore>=seuil?C.green:C.red,marginLeft:"0.3rem"}}>
              (score S{weekNum-1} : {prevWeekScore}/10)
            </span>
          }
        </div>
      </div>
    </div>
  );

  return <div style={{marginBottom:"0.5rem",border:`1px solid ${semainePasse&&debloque?C.green:semainePasse?C.red:C.border}`,background:C.bg2,transition:"border 0.3s"}}>
    <button onClick={()=>setOpen(o=>!o)} style={{width:"100%",padding:"0.75rem 0.85rem",background:"transparent",border:"none",display:"flex",alignItems:"center",gap:"0.65rem",textAlign:"left",cursor:"pointer"}}>
      <span style={{...MN,fontSize:"0.63rem",color:C.textDim,minWidth:"2rem"}}>S{weekNum}</span>
      <Tag color={pc}>{ph}</Tag>
      <span style={{flex:1,color:C.text,fontSize:"0.83rem"}}>{w.titre||w.t}</span>
      {scoreTotal!==null&&<span style={{...MN,fontSize:"0.65rem",color:scoreColor,fontWeight:500}}>{scoreTotal}/10</span>}
      {daysDone>0&&scoreTotal===null&&<span style={{...MN,fontSize:"0.58rem",color:C.gold}}>{daysDone}/4j</span>}
      <span style={{color:C.textDim,fontSize:"0.78rem",flexShrink:0}}>{open?"−":"+"}</span>
    </button>

    {open&&<div style={{padding:"0 0.85rem 0.85rem",borderTop:`1px solid ${C.border}`}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.55rem",margin:"0.65rem 0"}}>
        {[["Objectif",w.objectif||w.o],["Métrique",w.metrique||w.m]].map(([l,v])=>(
          <div key={l}>
            <div style={{fontSize:"0.54rem",color:C.goldD,textTransform:"uppercase",letterSpacing:"0.1em",...MN,marginBottom:"0.18rem"}}>{l}</div>
            <div style={{fontSize:"0.76rem",color:C.textMid,lineHeight:1.5}}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{fontSize:"0.54rem",color:C.goldD,textTransform:"uppercase",letterSpacing:"0.1em",...MN,marginBottom:"0.5rem"}}>Planning semaine</div>
      {days.map(({key,label,emoji})=>{
        const ck=`${weekNum}-${key}`;
        const done=!!checked[ck];
        const dayData=w[key]||{};
        const isDimanche=key==="dimanche";
        return(
          <button key={key} onClick={()=>handleDayCheck(key,!done)}
            style={{width:"100%",display:"flex",gap:"0.6rem",marginBottom:"0.4rem",alignItems:"flex-start",
              background:done?isDimanche?`${C.green}12`:`${C.green}0A`:isDimanche?`${C.gold}06`:"transparent",
              border:`1px solid ${done?C.green:isDimanche?C.goldD:C.border}`,
              padding:"0.55rem 0.65rem",textAlign:"left",transition:"all 0.2s",cursor:"pointer"}}>
            <span style={{color:done?C.green:C.textDim,fontSize:"0.72rem",marginTop:"0.05rem",flexShrink:0}}>{done?"✓":"○"}</span>
            <div style={{flex:1}}>
              <div style={{display:"flex",gap:"0.5rem",alignItems:"center",marginBottom:"0.2rem"}}>
                <span style={{fontSize:"0.58rem",color:isDimanche?C.gold:pc,...MN,letterSpacing:"0.08em"}}>{emoji} {label}</span>
                {dayData.h&&<span style={{fontSize:"0.56rem",color:C.textDim,...MN}}>{dayData.h}</span>}
                {dayData.dur&&<span style={{fontSize:"0.54rem",color:C.textDim,...MN}}>· {dayData.dur}</span>}
              </div>
              <div style={{fontSize:"0.77rem",color:done?C.textMid:C.text,lineHeight:1.5,textDecoration:done?"line-through":"none"}}>
                {dayData.tache||"—"}
              </div>
            </div>
          </button>
        );
      })}

      {score&&(
        <div style={{marginTop:"0.75rem",background:`${scoreColor}0A`,border:`1px solid ${scoreColor}25`,padding:"0.65rem 0.8rem"}}>
          <div style={{fontSize:"0.54rem",color:scoreColor,textTransform:"uppercase",letterSpacing:"0.12em",...MN,marginBottom:"0.4rem"}}>Score automatique — Semaine {weekNum}</div>
          <div style={{display:"flex",gap:"0.5rem",alignItems:"baseline",marginBottom:"0.4rem"}}>
            <span style={{...SF,fontSize:"1.6rem",color:scoreColor}}>{scoreTotal}</span>
            <span style={{fontSize:"0.7rem",color:C.textMid}}>/10 · seuil {seuil}/10</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.3rem",fontSize:"0.66rem",color:C.textMid}}>
            <span>Exécution : {score.actionPts}/4</span>
            <span>Régularité : {score.regPts}/3</span>
            <span>Énergie : {score.ePts}/2</span>
            <span>Rechutes : {score.rechutePts}/1</span>
          </div>
          <div style={{marginTop:"0.4rem",fontSize:"0.7rem",color:scoreColor,fontWeight:500}}>
            {debloque?`✓ Semaine ${weekNum+1} débloquée`:`✗ Score insuffisant — continue le tracker`}
          </div>
          {score.logsCount<7&&<div style={{fontSize:"0.62rem",color:C.textDim,marginTop:"0.3rem",fontStyle:"italic"}}>({score.logsCount}/7 jours loggués — score provisoire)</div>}
        </div>
      )}
      {!score&&(
        <div style={{marginTop:"0.75rem",padding:"0.55rem 0.8rem",background:`${C.bg3}`,border:`1px solid ${C.border}`,fontSize:"0.68rem",color:C.textDim,lineHeight:1.5}}>
          📊 Score calculé automatiquement depuis ton tracker journalier. Logue chaque jour pour un score précis.
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.45rem",marginTop:"0.6rem"}}>
        {[["⚠ Risque",w.risque||w.r,C.red],["✓ Victoire",w.victoire||w.v,C.green]].map(([l,v,c])=>(
          <div key={l} style={{background:`${c}0A`,border:`1px solid ${c}20`,padding:"0.42rem 0.6rem"}}>
            <div style={{fontSize:"0.54rem",color:c,textTransform:"uppercase",letterSpacing:"0.1em",...MN,marginBottom:"0.15rem"}}>{l}</div>
            <div style={{fontSize:"0.73rem",color:C.textMid,lineHeight:1.35}}>{v}</div>
          </div>
        ))}
      </div>
    </div>}
  </div>;
}

function CoachChat({plan,plan2,weeks,dailyLogs}){
  const COACH_KEY = `coach_history_${plan?.nom_guerre||'user'}`;
  const savedHistory = React.useMemo(()=>{
    try{ const h=localStorage.getItem(COACH_KEY); return h?JSON.parse(h):null; }catch{return null;}
  },[]);

  const [msgs,setMsgs]=useState(savedHistory||[{role:"assistant",content:`${plan?.nom_guerre} — je connais ton profil, tes patterns et ton plan. Quelle question tu as ?`}]);
  const [input,setInput]=useState("");
  const [loading,setLoading]=useState(false);

  useEffect(()=>{
    try{ localStorage.setItem(COACH_KEY, JSON.stringify(msgs.slice(-20))); }catch{}
  },[msgs]);
  const endRef=useRef(null);
  useEffect(()=>endRef.current?.scrollIntoView({behavior:"smooth"}),[msgs]);
  const send=async()=>{
    if(!input.trim()||loading)return;
    const q=input.trim();setInput("");setMsgs(m=>[...m,{role:"user",content:q}]);setLoading(true);
    try{
      const res=await fetchWithRetry("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({prompt:buildPromptCoach(plan,plan2,weeks,dailyLogs,q,msgs),system:"Tu es un coach comportemental socratique. Tu poses UNE question avant de donner un conseil. Direct, humain, 3-4 phrases max.",max_tokens:500})});
      if(!res.ok){const err=await res.json().catch(()=>({}));throw new Error(err.error||`HTTP ${res.status}`);}
      const data=await res.json();
      const txt=data.content;
      if(!txt)throw new Error("Réponse vide");
      setMsgs(m=>[...m,{role:"assistant",content:txt}]);
    }catch(e){setMsgs(m=>[...m,{role:"assistant",content:`[Erreur coach: ${e.message}]`}]);}
    finally{setLoading(false);}
  };
  return <Card accent>
    <SH icon="💬" label="Coach IA" sub="Mémoire comportementale · Contextuel"/>
    <div style={{maxHeight:"260px",overflowY:"auto",marginBottom:"0.65rem",display:"flex",flexDirection:"column",gap:"0.45rem"}}>
      {msgs.map((m,i)=><div key={i} style={{padding:"0.6rem 0.8rem",background:m.role==="user"?`${C.gold}0E`:C.bg3,border:`1px solid ${m.role==="user"?C.goldD:C.border}`,borderLeft:`3px solid ${m.role==="user"?C.gold:C.textDim}`,alignSelf:m.role==="user"?"flex-end":"flex-start",maxWidth:"92%"}}>
        <div style={{fontSize:"0.53rem",color:m.role==="user"?C.goldD:C.textDim,letterSpacing:"0.12em",textTransform:"uppercase",...MN,marginBottom:"0.18rem"}}>{m.role==="user"?"Toi":"Coach"}</div>
        <div style={{fontSize:"0.81rem",color:C.text,lineHeight:1.6}}>{m.content}</div>
      </div>)}
      {loading&&<div style={{padding:"0.7rem 0.9rem",background:C.bg3,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.gold}`,alignSelf:"flex-start",display:"flex",alignItems:"center",gap:"0.5rem"}}>
        <div style={{fontSize:"0.58rem",color:C.goldD,letterSpacing:"0.12em",textTransform:"uppercase",...MN}}>Coach</div>
        <div style={{display:"flex",gap:"0.25rem",alignItems:"center"}}>
          {[0,1,2].map(i=><span key={i} style={{width:"5px",height:"5px",background:C.gold,borderRadius:"50%",display:"inline-block",animation:`dotBounce 1.2s ease ${i*0.15}s infinite`}}/>)}
        </div>
      </div>}
      <div ref={endRef}/>
    </div>
    <div style={{display:"flex",gap:"0.35rem"}}>
      <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()} placeholder="Ta question…" style={{flex:1,padding:"0.68rem",background:C.bg,border:`1px solid ${C.border}`,borderBottom:`2px solid ${C.goldD}`,color:C.text,fontSize:"0.81rem",outline:"none"}}/>
      <button onClick={send} disabled={!input.trim()||loading} style={{padding:"0.68rem 0.85rem",background:input.trim()&&!loading?C.gold:C.bg3,border:"none",color:input.trim()&&!loading?C.bg:C.textDim,fontSize:"0.75rem",cursor:input.trim()&&!loading?"pointer":"default",transition:"all 0.2s"}}>→</button>
    </div>
  </Card>;
}

// ══════════════════════════════════════════════════════════════
// APP
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// ENGAGEMENT — Signature + Téléchargement
// ══════════════════════════════════════════════════════════════
function EngagementTab({plan, plan2, firstName}){
  const [signerNom, setSignerNom] = useState(firstName||"");
  const [signed, setSigned] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const canvasRef = useRef(null);
  const lastPos = useRef(null);
  const today = new Date().toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"});

  const getPos = (e, canvas) => {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  };

  const startDraw = e => {
    e.preventDefault();
    setDrawing(true);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    lastPos.current = pos;
  };

  const draw = e => {
    e.preventDefault();
    if (!drawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e, canvas);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = C.gold;
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    lastPos.current = pos;
    setHasStrokes(true);
  };

  const stopDraw = e => { e?.preventDefault(); setDrawing(false); };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
    setSigned(false);
  };

  const downloadEngagement = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 900; canvas.height = 1200;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#080808";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#8B6914";
    ctx.lineWidth = 1;
    ctx.strokeRect(40, 40, 820, 1120);
    ctx.strokeStyle = "#C9A84C";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(50, 50, 800, 1100);

    ctx.fillStyle = "#8B6914";
    ctx.font = "13px 'DM Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("ENGAGEMENT PERSONNEL", 450, 110);

    ctx.fillStyle = "#C9A84C";
    ctx.font = "bold 46px Georgia, serif";
    ctx.fillText(plan?.nom_guerre||"", 450, 180);

    ctx.strokeStyle = "#8B6914";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(150,205); ctx.lineTo(750,205); ctx.stroke();

    const textLines = [
      `Je soussigné(e) ${signerNom},`,
      "",
      "conscient(e) que les 90 prochains jours",
      "peuvent changer le cours de ma vie,",
      "",
      "je m'engage aujourd'hui à :",
      "",
      `→ Objectif : ${(plan2?.contrat||"").slice(0,60)}`,
      "",
      `→ Mission : ${(plan?.scorecard?.mission_centrale||"").slice(0,60)}`,
      "",
      "Je m'engage à agir même sans motivation.",
      "À tenir même sans résultat visible.",
      "À revenir même après une rechute.",
      "",
      `"${(plan?.citations_personnelles||[])[0]||""}"`,
    ];

    ctx.fillStyle = "#D0C8B8";
    ctx.font = "18px Georgia, serif";
    ctx.textAlign = "center";
    let y = 250;
    textLines.forEach(line => {
      if (line.startsWith("→")) {
        ctx.fillStyle = "#C9A84C";
        ctx.font = "16px monospace";
      } else if (line.startsWith('"')) {
        ctx.fillStyle = "#E8C97A";
        ctx.font = "italic 17px Georgia, serif";
      } else {
        ctx.fillStyle = "#D0C8B8";
        ctx.font = "18px Georgia, serif";
      }
      ctx.fillText(line, 450, y);
      y += line === "" ? 15 : 30;
    });

    const sigCanvas = canvasRef.current;
    y = Math.max(y + 40, 880);
    ctx.strokeStyle = "#2A2A2A";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(150, y+80); ctx.lineTo(480, y+80); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(520, y+80); ctx.lineTo(750, y+80); ctx.stroke();

    if (sigCanvas && hasStrokes) {
      ctx.drawImage(sigCanvas, 150, y, 330, 80);
    }

    ctx.fillStyle = "#7A7060";
    ctx.font = "13px monospace";
    ctx.textAlign = "center";
    ctx.fillText("Signature", 315, y+100);
    ctx.fillText(today, 635, y+100);

    ctx.fillStyle = "#8B6914";
    ctx.font = "11px monospace";
    ctx.fillText("✦ Créé par Lamine Diabaté · Mon Plan de Vie 90 Jours ✦", 450, 1160);

    const link = document.createElement("a");
    link.download = `engagement-${(plan?.nom_guerre||"plan").replace(/\s+/g,"-").toLowerCase()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const contrat = plan2?.contrat || "En cours de génération…";
  const mission = plan?.scorecard?.mission_centrale || "En cours de génération…";
  const citation = (plan?.citations_personnelles||[])[0] || "";

  return (
    <div style={{animation:"fadeUp 0.4s ease"}}>
      <Card accent>
        <SH icon="✦" label="Mon Engagement Personnel" sub="Signe et télécharge ton contrat"/>

        <div style={{
          padding:"1.4rem",background:`${C.gold}06`,
          border:`1px solid ${C.goldD}`,borderTop:`2px solid ${C.gold}`,
          marginBottom:"1.2rem",position:"relative"
        }}>
          <div style={{fontSize:"0.54rem",color:C.goldD,letterSpacing:"0.25em",textTransform:"uppercase",...MN,textAlign:"center",marginBottom:"0.8rem"}}>Engagement Personnel</div>

          <div style={{...SF,fontSize:"1.3rem",color:C.gold,textAlign:"center",marginBottom:"1rem",fontWeight:500}}>{plan?.nom_guerre||"…"}</div>

          <div style={{fontSize:"0.52rem",color:C.goldD,letterSpacing:"0.12em",textTransform:"uppercase",...MN,marginBottom:"0.25rem"}}>Je soussigné(e)</div>
          <input
            value={signerNom}
            onChange={e=>setSignerNom(e.target.value)}
            placeholder="Entre ton prénom et nom"
            style={{width:"100%",padding:"0.6rem 0.75rem",background:C.bg,border:`1px solid ${C.goldD}`,color:C.gold,fontSize:"0.9rem",outline:"none",marginBottom:"1rem",...SF}}
          />

          <div style={{fontSize:"0.82rem",color:C.textMid,lineHeight:1.85,marginBottom:"1rem"}}>
            conscient(e) que les 90 prochains jours peuvent changer le cours de ma vie, je m'engage aujourd'hui à :
          </div>

          <div style={{padding:"0.7rem 0.9rem",background:C.bg3,borderLeft:`3px solid ${C.gold}`,marginBottom:"0.6rem"}}>
            <div style={{fontSize:"0.54rem",color:C.goldD,textTransform:"uppercase",letterSpacing:"0.1em",...MN,marginBottom:"0.2rem"}}>Objectif</div>
            <div style={{fontSize:"0.82rem",color:C.text,lineHeight:1.5}}>{contrat}</div>
          </div>

          <div style={{padding:"0.7rem 0.9rem",background:C.bg3,borderLeft:`3px solid ${C.goldD}`,marginBottom:"0.6rem"}}>
            <div style={{fontSize:"0.54rem",color:C.goldD,textTransform:"uppercase",letterSpacing:"0.1em",...MN,marginBottom:"0.2rem"}}>Mission centrale</div>
            <div style={{fontSize:"0.82rem",color:C.text,lineHeight:1.5}}>{mission}</div>
          </div>

          <div style={{fontSize:"0.8rem",color:C.textMid,lineHeight:1.75,marginBottom:"0.8rem",fontStyle:"italic",textAlign:"center"}}>
            Je m'engage à agir même sans motivation.<br/>
            À tenir même sans résultat visible.<br/>
            À revenir même après une rechute.
          </div>

          {citation&&<div style={{...SF,fontSize:"0.88rem",color:C.goldL,fontStyle:"italic",textAlign:"center",padding:"0.6rem",borderTop:`1px solid ${C.goldD}40`}}>"{citation}"</div>}
        </div>

        <div style={{marginBottom:"1rem"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.4rem"}}>
            <div style={{fontSize:"0.54rem",color:C.goldD,letterSpacing:"0.15em",textTransform:"uppercase",...MN}}>Signature au doigt</div>
            <button onClick={clearCanvas} style={{background:"none",border:"none",color:C.textDim,fontSize:"0.68rem",cursor:"pointer",...MN}}>Effacer</button>
          </div>
          <div style={{position:"relative",border:`1px solid ${C.goldD}`,background:C.bg,borderRadius:"2px"}}>
            <canvas
              ref={canvasRef}
              width={340}
              height={100}
              style={{display:"block",width:"100%",height:"100px",touchAction:"none",cursor:"crosshair"}}
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
            />
            {!hasStrokes&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none",fontSize:"0.75rem",color:C.textDim,fontStyle:"italic"}}>Signe ici avec le doigt…</div>}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.62rem",color:C.textDim,marginTop:"0.3rem",...MN}}>
            <span>Signature</span><span>{today}</span>
          </div>
        </div>

        <button
          onClick={()=>{setSigned(true);downloadEngagement();}}
          disabled={!signerNom.trim()||!hasStrokes}
          style={{
            width:"100%",padding:"1rem",
            background:signerNom.trim()&&hasStrokes?C.gold:C.bg3,
            border:"none",color:signerNom.trim()&&hasStrokes?C.bg:C.textDim,
            fontSize:"0.74rem",letterSpacing:"0.18em",textTransform:"uppercase",fontWeight:500,
            cursor:signerNom.trim()&&hasStrokes?"pointer":"not-allowed",
            opacity:signerNom.trim()&&hasStrokes?1:0.5,
            transition:"all 0.25s",
            boxShadow:signerNom.trim()&&hasStrokes?`0 4px 18px ${C.gold}35`:"none"
          }}>
          {signed?"✓ Engagement téléchargé":"↓ Signer et télécharger mon engagement"}
        </button>
        {(!signerNom.trim()||!hasStrokes)&&<div style={{fontSize:"0.68rem",color:C.textDim,textAlign:"center",marginTop:"0.4rem",fontStyle:"italic"}}>
          {!signerNom.trim()?"Entre ton nom":"Signe avec le doigt pour débloquer le téléchargement"}
        </div>}
      </Card>
    </div>
  );
}

// ── Composant Victory hebdomadaire ──
function WeeklyVictory({logs}){
  const wk=Math.ceil((Object.keys(logs||{}).length||1)/7);
  const vKey=`victory_w${wk}`;
  const [vic,setVic]=useState(()=>{try{return localStorage.getItem(vKey)||'';}catch{return '';}});
  const [saved,setSaved]=useState(false);
  const save=()=>{try{localStorage.setItem(vKey,vic);setSaved(true);setTimeout(()=>setSaved(false),2000);}catch{}};
  return <div>
    <textarea value={vic} onChange={e=>{setVic(e.target.value);setSaved(false);}} placeholder="Cette semaine, j'ai prouvé que je suis capable de... Un changement que j'ai observé chez moi..." style={{width:"100%",background:"#161616",border:"1px solid #2A2A2A",color:"#F0EAD6",padding:"0.75rem",fontSize:"0.82rem",minHeight:"80px",resize:"none",boxSizing:"border-box",lineHeight:1.6,marginBottom:"0.5rem"}}/>
    <button onClick={save} style={{width:"100%",padding:"0.6rem",background:saved?"#27AE60":"#C9A84C",border:"none",color:"#080808",fontSize:"0.7rem",letterSpacing:"0.12em",cursor:"pointer",transition:"all 0.3s"}}>
      {saved?"✓ Sauvegardé":"Enregistrer ma victoire"}
    </button>
  </div>;
}

export default function App(){
  const [screen,setScreen]=useState("landing");
  const [activeDomain,setActiveDomain]=useState(null);

  useEffect(()=>{
    if(window.XLSX)return;
    const s=document.createElement("script");
    s.src=SHEETJS_URL;s.async=true;
    s.onload=()=>console.log("XLSX ready");
    s.onerror=()=>console.warn("XLSX load error");
    document.head.appendChild(s);
  },[]);
  const [si,setSi]=useState(0);
  const [qi,setQi]=useState(0);
  const [answers,setAnswers]=useState({});
  const [plan,setPlan]=useState(null);
  const [plan2,setPlan2]=useState(null);
  const [weeks,setWeeks]=useState(null);
  const [weeksLoading,setWeeksLoading]=useState(false);
  const [checks,setChecks]=useState({});
  const [logs,setLogs]=useState({});
  const [startDate,setStartDate]=useState(null);
  const [loadStep,setLoadStep]=useState(0);
  const [nom,setNom]=useState(""),email_s=useState(""),code_s=useState("");
  const [email,setEmail]=email_s,[code,setCode]=code_s;
  const [accessErr,setAccessErr]=useState("");
  const [accessShake,setAccessShake]=useState(false);
  const [qError,setQError]=useState("");
  const [qShake,setQShake]=useState(false);
  const [showAide,setShowAide]=useState(false);
  const [showReward,setShowReward]=useState("");
  const [copied,setCopied]=useState(false);
  const [errMsg,setErrMsg]=useState("");
  const [tab,setTab]=useState("dashboard");
  const [trackerOpen,setTrackerOpen]=useState(false);
  const [foc,setFoc]=useState({});

  useEffect(()=>{
    const hydrate = async () => {
      const lastDomain = getLastDomain();
      const allLocal = loadAllDomains();
      const hasLocal = Object.keys(allLocal).length > 0;
      if(hasLocal && lastDomain && allLocal[lastDomain]){
        const saved = allLocal[lastDomain];
        setActiveDomain(lastDomain);
        setPlan(saved.plan);if(saved.plan2)setPlan2(saved.plan2);
        if(saved.weeks)setWeeks(saved.weeks);if(saved.answers)setAnswers(saved.answers);
        if(saved.checks)setChecks(saved.checks);if(saved.logs)setLogs(saved.logs);
        if(saved.startDate)setStartDate(saved.startDate);if(saved.nom)setNom(saved.nom);
        setScreen("home");
        const userKey = saved.nom || saved.email || lastDomain;
        const cloudData = await sbLoad(userKey, lastDomain);
        if(cloudData?.plan && cloudData.updated_at > (saved.updated_at||"")){
          setPlan(cloudData.plan);if(cloudData.plan2)setPlan2(cloudData.plan2);
          if(cloudData.weeks)setWeeks(cloudData.weeks);
          if(cloudData.checks)setChecks(cloudData.checks);
          if(cloudData.logs)setLogs(cloudData.logs);
          saveByDomain(lastDomain, cloudData);
        }
      } else {
        const saved=load();
        if(!saved)return;
        if(saved.plan){
          setPlan(saved.plan);if(saved.plan2)setPlan2(saved.plan2);
          if(saved.weeks)setWeeks(saved.weeks);if(saved.answers)setAnswers(saved.answers);
          if(saved.checks)setChecks(saved.checks);if(saved.logs)setLogs(saved.logs);
          if(saved.startDate)setStartDate(saved.startDate);if(saved.nom)setNom(saved.nom);
          setScreen("home");
        }else if(saved.answers&&Object.keys(saved.answers).length>0){
          setAnswers(saved.answers);if(saved.nom)setNom(saved.nom);if(saved.email)setEmail(saved.email);
        }
      }
    };
    hydrate();
  },[]);

  useEffect(()=>{if(Object.keys(answers).length>0){const s=load()||{};save({...s,answers,nom,email});}}, [answers,nom,email]);
  useEffect(()=>{
    if(!plan)return;
    const d=activeDomain||answers.q_domaine_principal||null;
    if(d&&DOMAIN_KEYS[d]){
      const dataToSave={plan,plan2,weeks,answers,nom,email,checks,logs,startDate,updated_at:new Date().toISOString()};
      saveByDomain(d,dataToSave);
      if(!activeDomain)setActiveDomain(d);
      const userKey=nom||email||d;
      sbSave(userKey, d, dataToSave);
    }else{const s=load()||{};save({...s,plan,plan2,weeks,answers,nom,email,checks,logs,startDate});}
  },[plan,plan2,weeks,checks,logs,startDate,activeDomain]);

  const domaine = answers.q_domaine_principal || "";
  const activeSegs = getSegments(domaine) || SEGMENTS_FINANCES;
  const activeTransitions = getTransitions(domaine);
  const seg = activeSegs[si]; const q = seg?.questions[qi];
  const totalQ = activeSegs.reduce((s,sg)=>s+sg.questions.length, 0);
  const doneQ = activeSegs.slice(0,si).reduce((s,sg)=>s+sg.questions.length, 0) + qi;
  const pct = Math.round((doneQ/totalQ)*100);
  const firstName = answers.q_profil?.split(",")[0]?.split(" ")[0]?.trim() || nom.split(" ")[0] || "";
  const timeLeft = estimateTime(activeSegs, si, qi);
  const dn=dayNum(startDate);const lv=getLevel(dn);
  const stats=computeStats(logs);const todayLog=logs[todayKey()];const contMsg=getContMsg(dn);

  useEffect(()=>{ if(plan&&!logs[todayKey()]) setTrackerOpen(true); },[plan,startDate]);

  const LOAD_STEPS=["Analyse psychologique du profil…","Construction du diagnostic…","Calcul du scorecard comportemental…","Génération du rituel et protocoles…","Finalisation du plan…"];
  const setF=(k,v)=>setFoc(p=>({...p,[k]:v}));
  const iSt=k=>({width:"100%",padding:"0.82rem 0.95rem",background:C.bg,border:`1px solid ${foc[k]?C.goldD:C.border}`,borderBottom:`2px solid ${foc[k]?C.gold:C.border}`,color:C.text,fontSize:"0.88rem",fontWeight:300,outline:"none",transition:"all 0.25s"});
  const BG={padding:"1rem 2.5rem",background:C.gold,border:"none",color:C.bg,fontSize:"0.75rem",letterSpacing:"0.18em",textTransform:"uppercase",fontWeight:500,cursor:"pointer",boxShadow:`0 4px 22px ${C.gold}35`};

  const doAccess=()=>{
    if(!nom.trim()||nom.trim().length<2){setAccessErr("Entre ton nom complet.");setAccessShake(true);setTimeout(()=>setAccessShake(false),500);return;}
    if(!email.trim()||!email.includes("@")){setAccessErr("Email invalide.");setAccessShake(true);setTimeout(()=>setAccessShake(false),500);return;}
    if(!CODES.includes(code.trim().toUpperCase())){setAccessErr("Code secret invalide.");setAccessShake(true);setTimeout(()=>setAccessShake(false),500);return;}
    setScreen("intro");
  };

  const [showEmailPopup, setShowEmailPopup] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailDismissed, setEmailDismissed] = useState(false);
  const [transitionData, setTransitionData] = useState(null);
  const [showTransition, setShowTransition] = useState(false);

  const trigQError=(msg)=>{setQError(msg);setQShake(true);setTimeout(()=>setQShake(false),500);setTimeout(()=>setQError(""),3000);};
  const setVal=v=>{setQError("");setAnswers(p=>({...p,[q.id]:v}));};
  const setSubVal=(parentId,subKey,v)=>{setQError("");setAnswers(p=>({...p,[parentId]:{...(p[parentId]||{}),[subKey]:v}}));};

  const tryNext=()=>{
    const validation=validateAnswer(q,answers[q?.id]);
    if(!validation.valid){trigQError(validation.msg);return;}
    setShowAide(false);setQError("");
    setShowReward(q.reward||"");setTimeout(()=>setShowReward(""),2500);

    const getNextQi = (curSi, curQi) => {
      const curSeg = (getSegments(answers?.q_domaine_principal)||SEGMENTS_FINANCES)[curSi];
      return curQi + 1;
    };

    const nextQi = getNextQi(si, qi);
    const isLastQ = nextQi >= seg.questions.length;
    const isLastSeg = si === activeSegs.length-1;

    if(!isLastQ){setQi(nextQi);return;}
    if(!isLastSeg){
      const tr=activeTransitions[seg.id];
      if(tr){setTransitionData({...tr,nextSi:si+1});setShowTransition(true);}
      else{setSi(i=>i+1);setQi(0);}
      return;
    }
    setScreen("recap");
  };

  const continueAfterTransition=()=>{
    if(!transitionData)return;
    setSi(transitionData.nextSi);
    const newSeg = activeSegs[transitionData.nextSi];
    let firstQi = 0;
    while(firstQi < newSeg.questions.length) {
      const q = newSeg.questions[firstQi];
      if(!q.domainOnly || q.domainOnly === answers.q_domaine_principal) break;
      firstQi++;
    }
    setQi(firstQi);
    setShowTransition(false);
    setTransitionData(null);
  };

  const goBack=()=>{
    setShowAide(false);setQError("");
    if(qi>0){
      let prevQi = qi-1;
      while(prevQi > 0){
        const prevQ = seg.questions[prevQi];
        if(!prevQ.domainOnly || prevQ.domainOnly === answers.q_domaine_principal) break;
        prevQi--;
      }
      setQi(prevQi);
    } else if(si>0){
      setSi(i=>i-1);
      setQi((getSegments(answers.q_domaine_principal)||SEGMENTS_FINANCES)[si-1].questions.length-1);
    }
  };
  const generate=async()=>{
    const dom = answers.q_domaine_principal || "Finances";
    setActiveDomain(dom);
    setScreen("loading");setLoadStep(0);
    const timers=LOAD_STEPS.map((_,i)=>setTimeout(()=>setLoadStep(i),i*4200));
    const call=async(prompt,max)=>{
      const res=await fetchWithRetry("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({prompt:prompt+"\n\nRAPPEL : commence par { immédiatement.",system:"Tu es un générateur de JSON strict. RÈGLE ABSOLUE : ta réponse commence IMMÉDIATEMENT par { et se termine par }. Zéro texte avant. Zéro backtick.",max_tokens:max})});
      if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d.error||`Erreur API ${res.status}`);}
      const data=await res.json();
      const rawC=data.content||"";
      const parsedC=repairJSON(rawC);
      if(!parsedC)throw new Error("JSON invalide — réessaie");
      return parsedC;
    };
    try{
      const p1=await call(buildPrompt1(answers),3500);
      setLoadStep(2);
      const p2=await call(buildPrompt2(answers,p1.nom_guerre||""),4000);
      timers.forEach(clearTimeout);
      setPlan(p1);setPlan2(p2);
      setStartDate(new Date().toISOString().split('T')[0]);
      setShowEmailPopup(true);
      setScreen("home");
    }catch(e){
      timers.forEach(clearTimeout);
      setErrMsg(e.message);
      setScreen("error");
    }
  };

  const generateWeeks=async(p1)=>{
    if(weeks||weeksLoading)return;setWeeksLoading(true);
    const ng=p1?.nom_guerre||"";
    const norm=w=>({
      semaine:w.semaine??w.s, phase:w.phase??w.ph,
      titre:w.titre??w.t, objectif:w.objectif??w.o,
      lundi:w.lundi||null, mercredi:w.mercredi||null,
      vendredi:w.vendredi||null, dimanche:w.dimanche||null,
      actions:w.actions??w.a??[], metrique:w.metrique??w.m,
      risque:w.risque??w.r, victoire:w.victoire??w.v, seuil:w.seuil||6
    });
    const callAPI=async(prompt,attempt=1)=>{
      const res=await fetchWithRetry("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({prompt:prompt+"\n\nCommence par { immédiatement.",system:"Tu es un générateur de JSON strict. Commence IMMÉDIATEMENT par {.",max_tokens:3000})});
      if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d.error||`HTTP ${res.status}`);}
      const data=await res.json();
      const parsed=repairJSON(data.content||"");
      if(!parsed?.semaines){
        if(attempt<3){await new Promise(r=>setTimeout(r,2000*attempt));return callAPI(prompt,attempt+1);}
        throw new Error("JSON invalide après 3 tentatives");
      }
      return parsed.semaines;
    };
    try{
      const part1=await callAPI(buildPromptWeeksA(answers,ng));
      await new Promise(r=>setTimeout(r,1500));
      const part2=await callAPI(buildPromptWeeksB(answers,ng));
      const all=[...part1,...part2].map(norm).filter(w=>w.semaine).sort((a,b)=>a.semaine-b.semaine);
      setWeeks(all.length>0?all:[]);
    }catch(e){
      console.error("Semaines échec:",e);
      setWeeks([]);
    }finally{
      setWeeksLoading(false);
    }
  };

  const toggleCheck=(k,v)=>setChecks(p=>({...p,[k]:v}));
  const saveLog=(log)=>{const next={...logs,[todayKey()]:log};setLogs(next);if(activeDomain){saveByDomain(activeDomain,{logs:next,plan,plan2,weeks,answers,nom,email,checks,startDate});}else{const s=load()||{};save({...s,logs:next,plan,plan2,weeks,answers,nom,email,checks,startDate});}};
  const reset=()=>{clear();setPlan(null);setPlan2(null);setWeeks(null);setAnswers({});setChecks({});setLogs({});setStartDate(null);setSi(0);setQi(0);setNom("");setEmail("");setCode("");setAccessErr("");setErrMsg("");setTab("dashboard");setActiveDomain(null);setScreen("landing");};
  const switchDomain=(d)=>{
    const saved=loadByDomain(d);
    if(!saved?.plan)return;
    setActiveDomain(d);
    setPlan(saved.plan);setPlan2(saved.plan2||null);setWeeks(saved.weeks||null);
    setAnswers(saved.answers||{});setChecks(saved.checks||{});setLogs(saved.logs||{});
    setStartDate(saved.startDate||null);setTab("dashboard");
    localStorage.setItem(LAST_DOMAIN_KEY,d);
    setScreen("home");
  };
  const startNewPlan=()=>{
    setPlan(null);setPlan2(null);setWeeks(null);setAnswers({});setChecks({});setLogs({});
    setStartDate(null);setSi(0);setQi(0);setErrMsg("");setTab("dashboard");
    setActiveDomain(null);
    setScreen("intro");
  };

  const copyText=()=>{if(!plan)return;navigator.clipboard.writeText(`MON PLAN DE VIE 90 JOURS — ${firstName}\nNom de Guerre : ${plan.nom_guerre}\n\n${plan2?.message_final||""}\n\nContrat : ${plan2?.contrat||""}\n\nCréé par Lamine Diabaté`).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2500);});};
  const shareURL=()=>{if(!plan)return;try{const p={n:plan.nom_guerre,m:plan2?.message_final||"",c:plan2?.contrat||"",f:firstName};const enc=btoa(encodeURIComponent(JSON.stringify(p)));navigator.clipboard.writeText(`${window.location.href.split("?")[0]}?share=${enc}`).then(()=>alert("Lien copié !"));}catch(e){alert("Impossible de générer le lien.");}};
  const shareWA=()=>{if(!plan)return;window.open(`https://wa.me/?text=${encodeURIComponent("✦ MON PLAN 90 JOURS ✦\nPour "+firstName+" — "+plan.nom_guerre+"\n\n"+(plan2?.message_final||"").slice(0,400)+"\n\n"+(plan2?.contrat||"")+"\n\nCréé par Lamine Diabaté")}`,"_blank");};
  const joinCommunity=()=>window.open("https://chat.whatsapp.com/JSDmRbun1hxK6Q8sXjT4vS","_blank");

  const exportEmail=()=>{
    if(!plan)return;
    const nl="\n";const sep="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
    const body=[
      `MON PLAN DE VIE 90 JOURS`,sep,
      `Nom de Guerre : ${plan.nom_guerre}`,
      `Domaine : ${answers.q_domaine_principal||"—"}`,
      `Mission : ${plan.scorecard?.mission_centrale||"—"}`,
      "",sep,"AUTOSUGGESTION — lire 3× chaque matin",sep,
      plan2?.rituel?.autosuggestion||"—",
      "",sep,"ACTION DU JOUR",sep,
      plan2?.rituel?.premiere_action_du_jour||"—",
      "",sep,"ANTI-SABOTEUR",sep,
      `Racine : ${plan2?.anti_saboteur?.racine||"—"}`,
      `Stratégie 1 : ${plan2?.anti_saboteur?.strategie_1||"—"}`,
      "",sep,"CONTRAT",sep,
      plan2?.contrat||"—",
      "",sep,
      "Créé avec Mon Plan de Vie 90 Jours",
      "Communauté : https://chat.whatsapp.com/JSDmRbun1hxK6Q8sXjT4vS",
    ].join(nl);
    const subject=encodeURIComponent(`Mon Plan 90 Jours — ${plan.nom_guerre}`);
    const bodyEnc=encodeURIComponent(body);
    window.open(`mailto:?subject=${subject}&body=${bodyEnc}`,"_blank");
  };
  const exportSheets=()=>{
    if(!plan)return;
    if(!window.XLSX){alert("Chargement en cours, réessaye dans 2 secondes.");return;}
    try{
      const wb=window.XLSX.utils.book_new();
      const profil=[
        ["MON PLAN DE VIE 90 JOURS",""],["",""],
        ["Nom de Guerre",plan.nom_guerre||"—"],["Domaine",answers.q_domaine_principal||"—"],
        ["Mission 90 jours",plan.scorecard?.mission_centrale||"—"],["",""],
        ["DIAGNOSTIC",""],
        ["Bloquant central",plan.diagnostic?.bloquant_central||"—"],
        ["Schéma sabotage",plan.diagnostic?.schema_sabotage||"—"],
        ["Qualités cachées",plan.diagnostic?.qualites_cachees||"—"],["",""],
        ["SCORECARD","Score/100"],
        ["Discipline",plan.scorecard?.discipline?.score||"—"],
        ["Focus",plan.scorecard?.focus?.score||"—"],
        ["Énergie",plan.scorecard?.energie?.score||"—"],
        ["Clarté",plan.scorecard?.clarte?.score||"—"],
        ["Constance",plan.scorecard?.constance?.score||"—"],
        ["Risque abandon",plan.scorecard?.risque_abandon||"—"],["",""],
        ["AUTOSUGGESTION",""],
        [plan2?.rituel?.autosuggestion||"—",""],["",""],
        ["CONTRAT",""],
        [plan2?.contrat||"—",""],
      ];
      const wsProfil=window.XLSX.utils.aoa_to_sheet(profil);
      wsProfil["!cols"]=[{wch:26},{wch:65}];
      window.XLSX.utils.book_append_sheet(wb,wsProfil,"Profil & Diagnostic");
      const weeksData=[["Sem","Phase","Rôle","Titre","Objectif","Action 1","Action 2","Action 3","Métrique","Victoire","Risque"]];
      (weeks||[]).forEach(w=>weeksData.push([`S${w.s||w.semaine||"?"}`,w.ph||w.phase||"—",w.role||"—",w.t||w.titre||"—",w.o||w.objectif||"—",(w.a||w.actions||[])[0]||"—",(w.a||w.actions||[])[1]||"—",(w.a||w.actions||[])[2]||"—",w.m||w.metrique||"—",w.v||w.victoire||"—",w.r||w.risque||"—"]));
      if(weeksData.length===1)weeksData.push(["Génération en cours...","","","","","","","","","",""]);
      const wsWeeks=window.XLSX.utils.aoa_to_sheet(weeksData);
      wsWeeks["!cols"]=[{wch:6},{wch:12},{wch:22},{wch:22},{wch:35},{wch:38},{wch:38},{wch:38},{wch:22},{wch:22},{wch:22}];
      window.XLSX.utils.book_append_sheet(wb,wsWeeks,"Plan 12 Semaines");
      const tracker=[["Jour","Date","Humeur","Énergie","Focus","Action","Rituel","Rechute","Temps(min)","Notes"]];
      const start=startDate?new Date(startDate):new Date();
      for(let i=1;i<=90;i++){const d=new Date(start);d.setDate(d.getDate()+i-1);const key=d.toISOString().split("T")[0];const log=logs[key]||{};tracker.push([`J${i}`,d.toLocaleDateString("fr-FR"),log.humeur||"",log.energie||"",log.focus||"",log.action_done?"✓":"",log.rituel?"✓":"",log.rechute?"⚠":"",log.temps||"",log.notes||""]);}
      const wsTracker=window.XLSX.utils.aoa_to_sheet(tracker);
      wsTracker["!cols"]=[{wch:6},{wch:14},{wch:10},{wch:10},{wch:8},{wch:10},{wch:8},{wch:10},{wch:12},{wch:35}];
      window.XLSX.utils.book_append_sheet(wb,wsTracker,"Tracker J1-J90");
      const rituel=[["RITUEL",""],["Autosuggestion",plan2?.rituel?.autosuggestion||"—"],["",""],["MATIN",""]];
      (plan2?.rituel?.matin||[]).forEach(e=>rituel.push([e.etape,`${e.duree} — ${e.action}`]));
      rituel.push(["Première action",plan2?.rituel?.premiere_action_du_jour||"—"]);
      rituel.push(["Soir",`${plan2?.rituel?.soir?.duree||""} — ${plan2?.rituel?.soir?.action||""}`]);
      rituel.push(["",""],["ANTI-SABOTEUR",""]);
      const as=plan2?.anti_saboteur||{};
      [["Racine",as.racine],["Déclencheur",as.declencheur],["Stratégie 1",as.strategie_1],["Stratégie 2",as.strategie_2],["Stratégie 3",as.strategie_3]].forEach(([k,v])=>rituel.push([k,v||"—"]));
      rituel.push(["",""],["PROTOCOLE RECHUTE",""]);
      const pr=plan2?.protocole_rechute||{};
      [["5 minutes",pr["5_minutes"]],["24h",pr["24h"]],["48h",pr["48h"]],["Règle non-zéro",pr.regle_non_zero],["Jour difficile",pr.jour_difficile]].forEach(([k,v])=>rituel.push([k,v||"—"]));
      const wsRituel=window.XLSX.utils.aoa_to_sheet(rituel);
      wsRituel["!cols"]=[{wch:22},{wch:70}];
      window.XLSX.utils.book_append_sheet(wb,wsRituel,"Rituel & Protocoles");
      const lectures=[["Titre","Auteur","Pourquoi"]];
      (plan2?.lectures||[]).forEach(l=>lectures.push([l.titre||"—",l.auteur||"—",l.pourquoi||"—"]));
      const wsL=window.XLSX.utils.aoa_to_sheet(lectures);
      wsL["!cols"]=[{wch:35},{wch:22},{wch:60}];
      window.XLSX.utils.book_append_sheet(wb,wsL,"Lectures");
      window.XLSX.writeFile(wb,`MonPlan90_${(plan.nom_guerre||firstName).replace(/\s+/g,"_")}_${new Date().toLocaleDateString("fr-FR").replace(/\//g,"-")}.xlsx`);
    }catch(e){console.error(e);alert("Erreur export. Réessayez.");}
  };
  const printPDF=()=>{
    if(!plan)return;const s=plan;const s2=plan2||{};
    const rows=Object.entries({Discipline:s.scorecard?.discipline,Focus:s.scorecard?.focus,Énergie:s.scorecard?.energie,Clarté:s.scorecard?.clarte,Constance:s.scorecard?.constance}).map(([k,v])=>`<tr><td>${k}</td><td style="color:#C9A84C">${v?.score}/100</td><td>${v?.lecture||""}</td></tr>`).join("");
    const html=`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Plan 90J — ${firstName}</title><style>@import url('${FONT}');*{margin:0;padding:0;box-sizing:border-box}body{background:#080808;color:#F0EAD6;font-family:'Jost',sans-serif;font-weight:300;font-size:10.5pt;line-height:1.75;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{max-width:210mm;margin:0 auto;padding:16mm 20mm}.cover{text-align:center;padding:18mm 0;border-bottom:1px solid #8B6914;margin-bottom:10mm}.nom{font-family:'Cormorant Garamond',serif;font-size:36pt;color:#C9A84C;font-weight:500;margin:5mm 0}.mantra{font-family:'Cormorant Garamond',serif;font-size:13pt;color:#E8C97A;font-style:italic;margin:3mm 0}.mission{font-size:9.5pt;color:#A89880;margin:4mm auto;max-width:140mm}.aa{display:grid;grid-template-columns:1fr 1fr;gap:5mm;margin:5mm 0}.col{padding:4mm;border:1px solid #1E1E1E}.col-lbl{font-size:6.5pt;color:#8B6914;letter-spacing:.2em;text-transform:uppercase;margin-bottom:2mm}h2{font-family:'Cormorant Garamond',serif;font-size:11pt;color:#C9A84C;margin-top:7mm;margin-bottom:2mm;border-bottom:1px solid #1E1E1E;padding-bottom:1mm}p{margin:1.5mm 0;color:#D0C8B8;line-height:1.8}ul{padding-left:5mm;margin:2mm 0}li{margin:1.5mm 0;color:#D0C8B8}b{color:#E8C97A;font-weight:400}table{width:100%;border-collapse:collapse;margin:3mm 0;font-size:9pt}th{background:#C9A84C15;color:#E8C97A;font-weight:400;padding:2mm 3mm;border:1px solid #2A2A2A;text-align:left}td{padding:2mm 3mm;border:1px solid #1E1E1E;color:#D0C8B8}.box{background:#C9A84C0A;border:1px solid #8B6914;padding:4mm 5mm;margin:5mm 0;font-style:italic;color:#E8C97A;text-align:center}.footer{margin-top:12mm;padding-top:4mm;border-top:1px solid #8B6914;text-align:center;font-size:6.5pt;color:#8B6914;letter-spacing:.1em}@media print{@page{margin:0;size:A4}}</style></head><body><div class="page">
<div class="cover"><div style="font-size:6.5pt;color:#8B6914;letter-spacing:.3em;text-transform:uppercase">Programme de Transformation Comportementale · 90 Jours</div><div class="nom">${s.nom_guerre}</div><div class="mantra">${(s.citations_personnelles||[])[0]||s2.rituel?.autosuggestion||""}</div><div class="mission">${s.scorecard?.mission_centrale||""}</div><div style="font-size:6.5pt;color:#8B6914;letter-spacing:.2em;text-transform:uppercase;margin-top:3mm">Pour ${firstName} · ${new Date().toLocaleDateString("fr-FR")}</div></div>
<h2>AVANT / APRÈS</h2><div class="aa"><div class="col"><div class="col-lbl">Aujourd'hui</div><p>${answers.q_etat_now||""}</p></div><div class="col"><div class="col-lbl">Dans 90 jours</div><p style="color:#C9A84C">${answers.q_identite_cible||""}</p></div></div>
<h2>DIAGNOSTIC LUCIDE</h2><p>${s.diagnostic?.resume||""}</p><p><b>Bloquant :</b> ${s.diagnostic?.bloquant_central||""}</p><p><b>Schéma :</b> ${s.diagnostic?.schema_sabotage||""}</p>
<h2>SCORECARD</h2><table><thead><tr><th>Dimension</th><th>Score</th><th>Lecture</th></tr></thead><tbody>${rows}</tbody></table><p><b>Mission :</b> ${s.scorecard?.mission_centrale||""}</p>
<h2>RITUEL D'ACTIVATION</h2><div class="box">${s2.rituel?.autosuggestion||""}</div>${(s2.rituel?.matin||[]).map(e=>`<p><b>${e.etape} (${e.duree}) :</b> ${e.action}</p>`).join("")}<p><b>Première action :</b> ${s2.rituel?.premiere_action_du_jour||""}</p>
<h2>AUTO-SABOTAGE</h2><p><b>Racine :</b> ${s2.anti_saboteur?.racine||""}</p><ul><li>${s2.anti_saboteur?.strategie_1||""}</li><li>${s2.anti_saboteur?.strategie_2||""}</li><li>${s2.anti_saboteur?.strategie_3||""}</li></ul>
<h2>IDENTITÉ FUTURE</h2>${s.identite_future?`<p><b>Je pense :</b> ${s.identite_future.comment_pense}</p><p><b>J'agis :</b> ${s.identite_future.comment_agit}</p><p><b>Je ne tolère plus :</b> ${s.identite_future.ne_tolere_plus}</p><p><b>Nouveaux standards :</b> ${s.identite_future.nouveaux_standards}</p>`:""}
<h2>LECTURES</h2>${(s2.lectures||[]).map(l=>`<p><b>${l.titre}</b> — ${l.auteur} : ${l.pourquoi}</p>`).join("")}
<h2>MESSAGE FINAL</h2><p>${s2.message_final||""}</p><div class="box">${s2.contrat||""}</div>
<div class="footer">✦ Créé par Lamine Diabaté · Mon Plan de Vie 90 Jours · "90 Jours pour Renaître" ✦</div></div><script>window.onload=()=>{window.print();setTimeout(()=>window.close(),2000);};<\/script></body></html>`;
    const w=window.open("","_blank","width=900,height=700");if(!w){alert("Autorise les popups.");return;}w.document.write(html);w.document.close();
  };

  useEffect(()=>{const p=new URLSearchParams(window.location.search).get("share");if(!p)return;try{const d=JSON.parse(decodeURIComponent(atob(p)));setScreen("shareview");window._sp=d;}catch(e){}}, []);

  // ══════════════════════════════════════════════════════
  // RENDERS
  // ══════════════════════════════════════════════════════

  if(screen==="shareview"){const p=window._sp||{};return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"2rem",fontFamily:"'Jost',sans-serif"}}>
      <link rel="stylesheet" href={FONT}/><style>{CSS}</style>
      <Divider/><div style={{textAlign:"center",margin:"1.5rem 0",maxWidth:"460px",width:"100%"}}>
        <div style={{fontSize:"0.56rem",color:C.goldD,letterSpacing:"0.3em",textTransform:"uppercase",...MN,marginBottom:"0.7rem"}}>Plan partagé</div>
        <div style={{...SF,fontSize:"clamp(1.4rem,5vw,2rem)",color:C.text}}>Mon Plan de Vie 90 Jours</div>
        <div style={{...SF,fontSize:"0.9rem",fontStyle:"italic",color:C.gold,marginTop:"0.25rem"}}>Pour {p.f}</div>
      </div>
      <div style={{maxWidth:"440px",width:"100%"}}>
        <Card accent>
          <div style={{fontSize:"0.56rem",color:C.goldD,letterSpacing:"0.25em",textTransform:"uppercase",...MN,marginBottom:"0.35rem"}}>Nom de Guerre</div>
          <div style={{...SF,fontSize:"1.5rem",color:C.gold,marginBottom:"0.9rem"}}>{p.n}</div>
          <div style={{fontSize:"0.85rem",color:C.textMid,lineHeight:1.8,marginBottom:"0.9rem",fontStyle:"italic"}}>{p.m}</div>
          <div style={{padding:"0.75rem",background:`${C.gold}0A`,border:`1px solid ${C.goldD}`,textAlign:"center",...SF,fontSize:"0.92rem",color:C.gold,fontStyle:"italic"}}>{p.c}</div>
        </Card>
        <div style={{textAlign:"center",marginTop:"0.9rem"}}>
          <div style={{fontSize:"0.75rem",color:C.textDim,marginBottom:"0.9rem"}}>Généré par <span style={{color:C.gold}}>Lamine Diabaté</span></div>
          <button onClick={()=>setScreen("landing")} style={{...BG}}>Créer mon propre plan ✦</button>
        </div>
      </div>
    </div>
  );}

  const handleEmailSubscribe = async () => {
    if (!emailInput || !emailInput.includes('@')) return;
    setEmailLoading(true);
    try {
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailInput,
          nom_guerre: plan?.nom_guerre || '',
          domaine: answers?.q_domaine_principal || '',
          autosuggestion: plan2?.rituel?.autosuggestion || ''
        })
      });
      setEmailSent(true);
      setTimeout(() => setShowEmailPopup(false), 2000);
    } catch (e) {
      setShowEmailPopup(false);
    }
    setEmailLoading(false);
  };

  if (showEmailPopup && plan) return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:'1.5rem',animation:'fadeIn 0.3s ease'}}>
      <div style={{background:C.bg2,border:`1px solid ${C.goldD}`,borderTop:`4px solid ${C.gold}`,padding:'2rem 1.5rem',maxWidth:'420px',width:'100%',animation:'popIn 0.4s ease'}}>
        {emailSent ? (
          <div style={{textAlign:'center',padding:'1rem'}}>
            <div style={{fontSize:'2rem',marginBottom:'0.8rem'}}>✓</div>
            <div style={{...SF,fontSize:'1.1rem',color:C.green}}>Inscription confirmée !</div>
            <div style={{fontSize:'0.8rem',color:C.textDim,marginTop:'0.5rem'}}>Vérifie ta boîte mail.</div>
          </div>
        ) : (
          <>
            <div style={{fontSize:'0.55rem',color:C.goldD,letterSpacing:'0.2em',textTransform:'uppercase',...MN,marginBottom:'0.6rem'}}>Rester dans le mouvement</div>
            <div style={{...SF,fontSize:'1.2rem',color:C.gold,marginBottom:'0.8rem'}}>Reçois ton plan + tes rappels quotidiens</div>
            <p style={{fontSize:'0.82rem',color:C.textMid,lineHeight:1.7,marginBottom:'1.2rem'}}>J1, J3, J7, J14, J30, J60, J90 — des messages personnalisés pour tenir jusqu'au bout.</p>
            <input
              type="email"
              placeholder="ton@email.com"
              value={emailInput}
              onChange={e=>setEmailInput(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&handleEmailSubscribe()}
              style={{width:'100%',padding:'0.8rem',background:C.bg3,border:`1px solid ${C.goldD}`,color:C.text,fontSize:'0.85rem',marginBottom:'0.8rem',outline:'none',boxSizing:'border-box'}}
            />
            <button onClick={handleEmailSubscribe} disabled={emailLoading} style={{width:'100%',padding:'0.85rem',background:C.gold,border:'none',color:C.bg,fontSize:'0.75rem',letterSpacing:'0.15em',fontWeight:500,cursor:'pointer',marginBottom:'0.6rem'}}>
              {emailLoading ? 'Envoi...' : 'JE M\'INSCRIS →'}
            </button>
            <button onClick={()=>setShowEmailPopup(false)} style={{width:'100%',padding:'0.4rem',background:'transparent',border:'none',color:C.textDim,fontSize:'0.68rem',cursor:'pointer'}}>
              Non merci, continuer sans email
            </button>
          </>
        )}
      </div>
    </div>
  );

  if(screen==="landing")return(
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Jost',sans-serif",overflowX:"hidden"}}>
      <link rel="stylesheet" href={FONT}/>
      <script defer data-domain="monplan90.vercel.app" src="https://plausible.io/js/script.js"/>
      <meta name="theme-color" content="#FAF7F0"/>
      <meta name="apple-mobile-web-app-capable" content="yes"/>
      <meta name="apple-mobile-web-app-status-bar-style" content="default"/>
      <meta name="apple-mobile-web-app-title" content="Plan 90"/>
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
      <style>{CSS}</style>
      <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"3rem 1.5rem",textAlign:"center",position:"relative"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,bottom:0,background:`radial-gradient(ellipse at 50% 0%,${C.gold}08 0%,transparent 55%),radial-gradient(ellipse at 20% 80%,${C.blue}05 0%,transparent 40%)`,pointerEvents:"none"}}/>

        <div style={{marginBottom:"0.5rem"}}>
          <Divider/>
          <div style={{margin:"1.5rem 0 0.4rem",fontSize:"0.52rem",letterSpacing:"0.4em",color:C.goldD,textTransform:"uppercase",...MN}}>Système de Transformation Comportementale</div>
        </div>
        <h1 style={{...SF,fontSize:"clamp(3.2rem,11vw,6rem)",fontWeight:400,color:C.text,lineHeight:0.88,marginBottom:"0.1rem"}}>Mon Plan</h1>
        <h1 style={{...SF,fontSize:"clamp(3.2rem,11vw,6rem)",fontWeight:300,fontStyle:"italic",color:C.gold,lineHeight:0.88,marginBottom:"1.5rem"}}>de Vie</h1>
        <div style={{display:"inline-block",padding:"0.45rem 1.6rem",border:`1px solid ${C.goldD}`,background:`${C.gold}08`,...SF,fontSize:"clamp(1.1rem,3.5vw,1.8rem)",color:C.gold,letterSpacing:"0.2em",marginBottom:"2rem"}}>90 Jours</div>

        <p style={{maxWidth:"360px",color:C.textMid,lineHeight:1.9,fontSize:"clamp(0.85rem,2.5vw,0.95rem)",marginBottom:"2rem"}}>
          Pas un texte inspirant.<br/>
          Un <strong style={{color:C.text}}>système d'exécution</strong> construit sur ta psychologie réelle.
        </p>

        <div style={{display:"flex",gap:"0.5rem",marginBottom:"2rem",flexWrap:"wrap",justifyContent:"center"}}>
          {Object.entries(DOMAIN_CONFIG).map(([name,cfg])=>(
            <div key={name} style={{padding:"0.5rem 0.9rem",background:`${cfg.color}10`,border:`1px solid ${cfg.color}30`,display:"flex",alignItems:"center",gap:"0.4rem"}}>
              <span style={{fontSize:"0.9rem"}}>{cfg.icon}</span>
              <div style={{textAlign:"left"}}>
                <div style={{fontSize:"0.75rem",color:cfg.color,fontWeight:400}}>{name}</div>
                <div style={{fontSize:"0.58rem",color:C.textDim,...MN}}>{cfg.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <button onClick={()=>setScreen("access")} style={{...BG,padding:"1.1rem 3rem",marginBottom:"2rem"}}>Accéder à mon programme ✦</button>

        <div style={{display:"flex",gap:"1.8rem",flexWrap:"wrap",justifyContent:"center"}}>
          {[["22","Questions ciblées"],["~12'","Pour remplir"],["12","Semaines structurées"],["90","Jours transformants"]].map(([n,l])=>(
            <div key={n} style={{textAlign:"center"}}>
              <div style={{...SF,fontSize:"1.8rem",color:C.gold}}>{n}</div>
              <div style={{fontSize:"0.6rem",color:C.textDim,letterSpacing:"0.1em",textTransform:"uppercase",...MN}}>{l}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if(screen==="access")return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"2rem",fontFamily:"'Jost',sans-serif"}}>
      <link rel="stylesheet" href={FONT}/><style>{CSS}</style>
      <Divider/><div style={{textAlign:"center",margin:"1.5rem 0"}}>
        <div style={{fontSize:"0.54rem",letterSpacing:"0.35em",color:C.goldD,textTransform:"uppercase",...MN,marginBottom:"0.4rem"}}>Accès Personnel</div>
        <h1 style={{...SF,fontSize:"clamp(1.6rem,5vw,2.3rem)",fontWeight:400,color:C.text}}>Mon Plan de Vie <span style={{fontStyle:"italic",color:C.gold}}>90 Jours</span></h1>
      </div>
      <div style={{width:"100%",maxWidth:"360px",animation:accessShake?"shake 0.45s ease":"none"}}>
        <Card accent>
          <div style={{fontSize:"0.68rem",color:C.textDim,marginBottom:"1.6rem",lineHeight:1.7,textAlign:"center"}}>Identifie-toi pour accéder.<br/><span style={{color:C.goldD,fontSize:"0.63rem"}}>Informations confidentielles.</span></div>
          {[{lbl:"Nom complet",val:nom,set:setNom,ph:"Prénom Nom",type:"text",k:"nom"},{lbl:"Email",val:email,set:setEmail,ph:"ton@email.com",type:"email",k:"eml"}].map(({lbl,val,set,ph,type,k})=>(
            <div key={k} style={{marginBottom:"1rem"}}>
              <div style={{fontSize:"0.6rem",color:C.goldD,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:"0.32rem",...MN}}>{lbl}</div>
              <input type={type} value={val} placeholder={ph} onChange={e=>{setAccessErr("");set(e.target.value);}} onKeyDown={e=>e.key==="Enter"&&doAccess()} onFocus={()=>setF(k,true)} onBlur={()=>setF(k,false)} style={iSt(k)}/>
            </div>
          ))}
          <div style={{marginBottom:"1.2rem"}}>
            <div style={{fontSize:"0.6rem",color:C.goldD,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:"0.32rem",...MN}}>Code secret</div>
            <input type="text" value={code} placeholder="LD-XXXXX" onChange={e=>{setAccessErr("");setCode(e.target.value.toUpperCase());}} onKeyDown={e=>e.key==="Enter"&&doAccess()} onFocus={()=>setF("cod",true)} onBlur={()=>setF("cod",false)} style={{...iSt("cod"),textAlign:"center",letterSpacing:"0.25em",...MN,color:C.gold,fontSize:"1.05rem"}}/>
          </div>
          {accessErr&&<div style={{fontSize:"0.7rem",color:C.red,textAlign:"center",marginBottom:"0.8rem"}}>{accessErr}</div>}
          <button onClick={doAccess} style={{...BG,width:"100%",padding:"0.92rem"}}>Accéder ✦</button>
        </Card>
        <div style={{textAlign:"center",marginTop:"0.5rem"}}><button onClick={()=>setScreen("landing")} style={{background:"none",border:"none",color:C.textDim,fontSize:"0.68rem",cursor:"pointer"}}>← Présentation</button></div>
        <div style={{textAlign:"center",marginTop:"1.5rem",padding:"1.2rem",background:C.bg2,border:`1px solid ${C.border}`}}>
          <div style={{fontSize:"0.58rem",color:C.goldD,letterSpacing:"0.2em",textTransform:"uppercase",...MN,marginBottom:"0.5rem"}}>Pas encore de code ?</div>
          <p style={{fontSize:"0.78rem",color:C.textMid,lineHeight:1.7,marginBottom:"0.85rem"}}>Rejoins la communauté et demande ton accès. Les premières places sont limitées.</p>
          <button onClick={joinCommunity} style={{width:"100%",padding:"0.75rem",background:"#25D36618",border:"1px solid #25D36640",color:"#25D366",fontSize:"0.72rem",letterSpacing:"0.08em",...MN,cursor:"pointer"}}>
            💬 Rejoindre la Communauté → Demander un code
          </button>
        </div>
      </div>
    </div>
  );

  if(screen==="intro")return(
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Jost',sans-serif",padding:"2.5rem 1.5rem",maxWidth:"560px",margin:"0 auto",animation:"fadeUp 0.6s ease"}}>
      <link rel="stylesheet" href={FONT}/><style>{CSS}</style>

      <div style={{textAlign:"center",marginBottom:"2rem"}}>
        <Divider/>
        <div style={{margin:"1.5rem 0 0.4rem",fontSize:"0.54rem",letterSpacing:"0.28em",color:C.goldD,textTransform:"uppercase",...MN}}>Programme de Transformation · 90 Jours</div>
        <h1 style={{...SF,fontSize:"clamp(1.7rem,5vw,2.6rem)",fontWeight:400,color:C.text}}>Bienvenue, {nom.split(" ")[0]}.</h1>
      </div>

      <Card accent>
        <p style={{...SF,fontSize:"1.3rem",color:C.gold,marginBottom:"1.2rem"}}>Félicitations.</p>

        <p style={{color:C.text,fontSize:"0.9rem",lineHeight:1.9,marginBottom:"1.2rem"}}>
          Si tu es ici, c'est qu'une partie de toi a compris que continuer comme avant a un prix.
        </p>

        <p style={{color:C.textMid,fontSize:"0.87rem",lineHeight:1.9,marginBottom:"0.6rem"}}>
          Ce programme n'est pas une dose de motivation temporaire.
        </p>
        <p style={{color:C.textMid,fontSize:"0.87rem",lineHeight:1.9,marginBottom:"1.2rem"}}>
          Ce n'est pas un livre de plus que tu oublieras dans une semaine.
        </p>

        <p style={{color:C.text,fontSize:"0.93rem",lineHeight:1.8,fontWeight:400,marginBottom:"1.2rem"}}>
          C'est un système de transformation sur 90 jours.
        </p>

        <p style={{color:C.textMid,fontSize:"0.87rem",lineHeight:1.9,marginBottom:"1.5rem"}}>
          Un système construit autour d'actions concrètes, d'horaires réels, d'un coach IA capable d'identifier tes blocages, et d'un suivi quotidien conçu pour t'empêcher de décrocher.
        </p>

        <div style={{borderTop:`1px solid ${C.border}`,paddingTop:"1.2rem",marginBottom:"1.2rem"}}>
          <p style={{fontSize:"0.72rem",color:C.gold,letterSpacing:"0.15em",textTransform:"uppercase",...MN,marginBottom:"0.9rem"}}>Pourquoi 90 jours ?</p>

          <p style={{color:C.textMid,fontSize:"0.87rem",lineHeight:1.9,marginBottom:"0.9rem"}}>
            Parce qu'arrêter une vieille habitude est une chose.<br/>
            Construire une nouvelle identité en est une autre.
          </p>

          <p style={{color:C.textMid,fontSize:"0.87rem",lineHeight:1.9,marginBottom:"0.9rem"}}>
            Les neurosciences comportementales montrent qu'un changement durable demande bien plus qu'un simple élan de motivation. Il faut du temps pour que de nouveaux comportements deviennent automatiques, naturels, intégrés à qui tu es.
          </p>

          <p style={{color:C.textMid,fontSize:"0.87rem",lineHeight:1.9,marginBottom:"0.9rem"}}>
            90 jours, ce n'est pas arbitraire.<br/>
            C'est le temps nécessaire pour transformer un effort conscient en mode de fonctionnement.
          </p>

          <div style={{display:"flex",gap:"1.2rem",justifyContent:"center",margin:"1.2rem 0"}}>
            {[["Pas 30 jours.",C.textDim],["Pas 45.",C.textDim],["90.",C.gold]].map(([t,c])=>(
              <span key={t} style={{...SF,fontSize:"1.1rem",color:c,fontStyle:"italic"}}>{t}</span>
            ))}
          </div>
        </div>

        <div style={{borderTop:`1px solid ${C.border}`,paddingTop:"1.2rem"}}>
          <p style={{fontSize:"0.72rem",color:C.red,letterSpacing:"0.15em",textTransform:"uppercase",...MN,marginBottom:"0.9rem"}}>Mais ce programme a une condition</p>

          <p style={{color:C.textMid,fontSize:"0.87rem",lineHeight:1.9,marginBottom:"0.9rem"}}>
            Tes réponses vont construire ton système.<br/>
            Des réponses superficielles créeront un plan superficiel.<br/>
            Des réponses sincères — même inconfortables — peuvent créer un véritable basculement.
          </p>

          <p style={{color:C.textMid,fontSize:"0.87rem",lineHeight:1.9,marginBottom:"0.9rem"}}>
            Personne ne lira tes réponses.<br/>
            Aucun jugement.<br/>
            Aucun masque à porter.
          </p>

          <p style={{...SF,color:C.goldL,fontSize:"0.95rem",lineHeight:1.8,fontStyle:"italic"}}>
            Seulement la vérité.
          </p>
        </div>
      </Card>

      <div style={{display:"flex",gap:"0.5rem",marginBottom:"1rem"}}>
        {(getSegments(answers.q_domaine_principal)||SEGMENTS_FINANCES).map(sg=><div key={sg.id} style={{flex:1,textAlign:"center",padding:"0.65rem 0.35rem",border:`1px solid ${C.border}`,background:C.bg2}}>
          <div style={{fontSize:"0.9rem",color:C.gold,marginBottom:"0.2rem"}}>{sg.icon}</div>
          <div style={{fontSize:"0.56rem",letterSpacing:"0.1em",color:C.textDim,textTransform:"uppercase",...MN}}>{sg.label}</div>
          <div style={{fontSize:"0.6rem",color:C.textDim}}>{sg.questions.length}Q</div>
        </div>)}
      </div>

      <p style={{textAlign:"center",fontSize:"0.75rem",color:C.textDim,marginBottom:"1.5rem",...MN}}>
        19 questions · ~10 minutes · Le reste appartient aux 90 jours qui suivent.
      </p>

      <div style={{textAlign:"center"}}>
        <button onClick={()=>setScreen("quiz")} style={{...BG}}>Je suis prêt — Commencer ✦</button>
      </div>
    </div>
  );

  // ── TRANSITION ENTRE BLOCS ──
  if(showTransition && transitionData){
    const nextSeg = (getSegments(answers?.q_domaine_principal)||SEGMENTS_FINANCES)[transitionData.nextSi];
    const totalQ2 = (getSegments(answers.q_domaine_principal)||SEGMENTS_FINANCES).reduce((s,sg)=>s+sg.questions.length,0);
    const doneQSoFar = (getSegments(answers.q_domaine_principal)||SEGMENTS_FINANCES).slice(0,transitionData.nextSi).reduce((s,sg)=>s+sg.questions.length,0);
    const pctDone = Math.round((doneQSoFar/totalQ)*100);
    const blockColors = {identite:C.blue, objectif:C.gold, blocages:C.red, environnement:C.purple, execution:C.green};
    const prevSeg = (getSegments(answers?.q_domaine_principal)||SEGMENTS_FINANCES)[transitionData.nextSi-1];
    const prevColor = blockColors[prevSeg?.id]||C.gold;
    const nextColor = blockColors[nextSeg?.id]||C.gold;

    return(
      <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Jost',sans-serif",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"2rem 1.5rem",maxWidth:"540px",margin:"0 auto",position:"relative",overflow:"hidden"}}>
        <link rel="stylesheet" href={FONT}/><style>{CSS}</style>

        <div style={{position:"absolute",top:"-20%",left:"-20%",width:"140%",height:"140%",background:`radial-gradient(ellipse at 30% 20%, ${prevColor}12 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, ${nextColor}08 0%, transparent 50%)`,pointerEvents:"none",animation:"fadeIn 0.8s ease"}}/>

        <div style={{position:"absolute",inset:0,pointerEvents:"none",overflow:"hidden"}}>
          {[...Array(8)].map((_,i)=>(
            <div key={i} style={{
              position:"absolute",
              width:`${3+i%3}px`,height:`${3+i%3}px`,
              background:i%3===0?C.gold:i%3===1?prevColor:nextColor,
              borderRadius:"50%",
              left:`${10+i*11}%`,
              top:`${15+i*9}%`,
              opacity:0.4,
              animation:`pulse ${1.5+i*0.3}s ease ${i*0.15}s infinite`,
            }}/>
          ))}
        </div>

        <div style={{animation:"fadeUp 0.4s ease",marginBottom:"1.5rem",textAlign:"center"}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:"0.5rem",padding:"0.4rem 1rem",background:`${prevColor}15`,border:`1px solid ${prevColor}40`,marginBottom:"0.8rem"}}>
            <span style={{color:prevColor,fontSize:"0.9rem"}}>{prevSeg?.icon}</span>
            <span style={{fontSize:"0.58rem",color:prevColor,letterSpacing:"0.2em",textTransform:"uppercase",...MN}}>{prevSeg?.label} · Complété ✓</span>
          </div>
        </div>

        <div style={{textAlign:"center",animation:"fadeUp 0.5s ease 0.1s both",marginBottom:"1.5rem"}}>
          <div style={{...SF,fontSize:"clamp(1.8rem,6vw,2.8rem)",color:C.gold,fontWeight:400,lineHeight:1.1,marginBottom:"0.8rem"}}>{transitionData.title}</div>
          <p style={{color:C.textMid,fontSize:"0.88rem",lineHeight:1.85}}>{transitionData.sub}</p>
        </div>

        <div style={{width:"100%",maxWidth:"320px",marginBottom:"1.5rem",animation:"fadeIn 0.6s ease 0.2s both"}}>
          <div style={{height:"1px",background:`linear-gradient(90deg,transparent,${C.gold},transparent)`}}/>
          <div style={{display:"flex",justifyContent:"center",marginTop:"-0.5rem"}}>
            <div style={{padding:"0.2rem 0.6rem",background:C.bg,border:`1px solid ${C.goldD}`,fontSize:"0.6rem",color:C.goldD,...MN,letterSpacing:"0.15em"}}>{pctDone}% du questionnaire</div>
          </div>
        </div>

        <div style={{animation:"fadeUp 0.5s ease 0.3s both",marginBottom:"1.5rem",textAlign:"center",maxWidth:"380px"}}>
          <p style={{color:C.text,fontSize:"0.9rem",lineHeight:1.85,marginBottom:transitionData.warn?"1rem":"0"}}>{transitionData.next}</p>
          {transitionData.warn&&<div style={{padding:"0.75rem 1rem",background:`${C.gold}08`,borderLeft:`3px solid ${C.gold}`,marginTop:"0.8rem",textAlign:"left"}}>
            <p style={{color:C.goldL,fontSize:"0.82rem",lineHeight:1.7,fontStyle:"italic"}}>✦ {transitionData.warn}</p>
          </div>}
        </div>

        <div style={{
          animation:"fadeUp 0.5s ease 0.4s both",
          width:"100%",maxWidth:"380px",marginBottom:"2rem",
          padding:"1rem 1.2rem",
          background:`${nextColor}08`,
          border:`1px solid ${nextColor}30`,
          borderLeft:`4px solid ${nextColor}`,
          display:"flex",alignItems:"center",gap:"0.85rem"
        }}>
          <span style={{fontSize:"1.5rem"}}>{nextSeg?.icon}</span>
          <div>
            <div style={{fontSize:"0.58rem",color:nextColor,letterSpacing:"0.2em",textTransform:"uppercase",...MN,marginBottom:"0.2rem"}}>Prochain bloc</div>
            <div style={{fontSize:"0.9rem",color:C.text,fontWeight:400}}>{nextSeg?.label}</div>
            <div style={{fontSize:"0.68rem",color:C.textDim,marginTop:"0.15rem"}}>{nextSeg?.subtitle} · {nextSeg?.questions.length} questions</div>
          </div>
        </div>

        <div style={{animation:"fadeUp 0.5s ease 0.5s both",width:"100%",maxWidth:"380px"}}>
          <button onClick={continueAfterTransition} style={{...BG,width:"100%",padding:"1.1rem",fontSize:"0.75rem",letterSpacing:"0.15em"}}>
            {transitionData.cta}
          </button>
        </div>
      </div>
    );
  }

  // ── QUIZ ──
  if(screen==="quiz"&&q){
    const val=answers[q.id];
    const isLastQBtn=qi===seg.questions.length-1;
    const isLastSegBtn=si===(getSegments(answers?.q_domaine_principal)||SEGMENTS_FINANCES).length-1;
    const btnLabel=isLastSegBtn&&isLastQBtn?"Voir le récap ✦":"Continuer →";
    const hasContent=validateAnswer(q,val).valid;

    const cfg = getDomainCfg(answers);
    const domainLabel = answers.q_domaine_principal || "";
    const ADAPTED_IDS = ["q_objectif","q_sacrifice","q_si_pas","q_mensonge","q_perte_succes","q_adaptive","q_environnement","q_charge_mentale","q_pari","q_engagement"];
    const isAdapted = ADAPTED_IDS.includes(q.id) && !!domainLabel;

    const resolveLabel = (q) => {
      if (!cfg) return q.label === "_adapté_" ? "" : q.label;
      const labelMap = {
        q_objectif:      cfg.q_objectif_label,
        q_sacrifice:     cfg.q_sacrifice_label,
        q_si_pas:        cfg.q_si_pas_label,
        q_mensonge:      cfg.q_mensonge_label,
        q_perte_succes:  cfg.q_perte_label,
        q_adaptive:      cfg.q_adaptive_label,
        q_environnement: cfg.q_env_label,
        q_engagement:    cfg.q_engagement_label,
        q_etat_now:      cfg.q_etat_now_label,
        q_phrase_neg:    cfg.q_phrase_neg_label,
      };
      return labelMap[q.id] || (q.label === "_adapté_" ? "" : q.label);
    };

    const adaptPh = (q) => {
      if (!cfg) return q.ph === "_adapté_" ? "" : q.ph;
      const phMap = {
        q_objectif:       cfg.q_objectif_ph,
        q_sacrifice:      cfg.q_sacrifice_ph,
        q_si_pas:         cfg.q_si_pas_ph,
        q_mensonge:       cfg.q_mensonge_ph,
        q_perte_succes:   cfg.q_perte_ph,
        q_adaptive:       cfg.q_adaptive_ph,
        q_environnement:  cfg.q_env_ph,
        q_charge_mentale: cfg.q_charge_ph,
        q_pari:           cfg.q_pari_ph,
        q_engagement:     cfg.q_engagement_ph,
        q_etat_now:       cfg.q_etat_now_ph,
        q_phrase_neg:     cfg.q_phrase_neg_ph,
      };
      return phMap[q.id] || (q.ph === "_adapté_" ? "" : q.ph);
    };

    const adaptEx = (q) => {
      if (!cfg) return q.aide?.ex;
      const exMap = {
        q_objectif:   cfg.q_objectif_ex,
        q_adaptive:   cfg.q_adaptive_ex,
        q_etat_now:   cfg.q_etat_now_ex,
        q_phrase_neg: cfg.q_phrase_neg_ex,
      };
      return exMap[q.id] || q.aide?.ex;
    };

    const ph = adaptPh(q);
    const aidEx = adaptEx(q);
    const adaptedLabel = resolveLabel(q);

    return(
      <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Jost',sans-serif",display:"flex",flexDirection:"column",padding:"1.4rem",maxWidth:"540px",margin:"0 auto"}}>
        <link rel="stylesheet" href={FONT}/><style>{CSS}</style>

        <div style={{paddingTop:"0.6rem",marginBottom:"1.2rem"}}>
          <div style={{display:"flex",gap:"0.28rem",marginBottom:"0.65rem"}}>{(getSegments(answers.q_domaine_principal)||SEGMENTS_FINANCES).map((sg,i)=><div key={sg.id} style={{flex:1,padding:"0.28rem",textAlign:"center",border:`1px solid ${i===si?C.goldD:C.border}`,background:i===si?`${C.gold}10`:"transparent",transition:"all 0.3s"}}><div style={{fontSize:"0.56rem",color:i===si?C.gold:C.textDim,...MN}}>{sg.icon} {sg.label}</div></div>)}</div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.6rem",color:C.textDim,marginBottom:"0.22rem",...MN}}>
            <span>{doneQ+1}/{totalQ}</span>
            <span style={{color:C.goldD}}>≈ {timeLeft} min restantes</span>
            <span style={{color:C.gold}}>{pct}%</span>
          </div>
          <div style={{height:"2px",background:C.bg3}}><div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${C.goldD},${C.goldL})`,transition:"width 0.5s ease",boxShadow:`0 0 7px ${C.gold}50`}}/></div>
        </div>

        {showReward&&<div style={{padding:"0.5rem 0.85rem",background:`${C.green}10`,border:`1px solid ${C.green}28`,borderLeft:`3px solid ${C.green}`,marginBottom:"0.7rem",animation:"fadeIn 0.3s ease",fontSize:"0.75rem",color:C.green}}>✓ {showReward}</div>}

        {qError&&<div style={{padding:"0.5rem 0.85rem",background:`${C.red}10`,border:`1px solid ${C.red}40`,borderLeft:`3px solid ${C.red}`,marginBottom:"0.7rem",animation:"fadeIn 0.25s ease",fontSize:"0.75rem",color:C.red}}>⚠ {qError}</div>}

        <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",animation:qShake?"shake 0.45s ease":"slideIn 0.3s ease"}}>
          <div style={{fontSize:"1.3rem",color:C.gold,opacity:0.5,marginBottom:"0.5rem"}}>{seg.icon}</div>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"0.65rem",marginBottom:"0.28rem"}}>
            <h2 style={{...SF,fontSize:"clamp(1rem,3.5vw,1.45rem)",color:C.text,fontWeight:500,lineHeight:1.3,flex:1}}>{adaptedLabel||q.label}</h2>
            {q.aide&&<button onClick={()=>setShowAide(a=>!a)} style={{padding:"0.2rem 0.48rem",background:showAide?`${C.gold}18`:"transparent",border:`1px solid ${showAide?C.gold:C.goldD}`,color:C.gold,...MN,fontSize:"0.6rem",flexShrink:0,marginTop:"0.18rem",cursor:"pointer",transition:"all 0.2s"}}>? aide</button>}
          </div>
          {isAdapted&&domainLabel&&<div style={{display:"inline-flex",alignItems:"center",gap:"0.3rem",padding:"0.18rem 0.55rem",background:`${C.gold}12`,border:`1px solid ${C.goldD}40`,marginBottom:"0.5rem"}}>
            <span style={{fontSize:"0.52rem",color:C.goldD}}>✦</span>
            <span style={{fontSize:"0.58rem",color:C.goldD,letterSpacing:"0.1em",...MN}}>Adapté · {domainLabel}</span>
          </div>}

          {showAide&&q.aide&&<div style={{background:`${C.gold}07`,borderLeft:`3px solid ${C.gold}`,border:`1px solid ${C.goldD}`,padding:"0.75rem 0.85rem",marginBottom:"0.65rem",animation:"fadeIn 0.2s ease"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.3rem"}}><span style={{fontSize:"0.56rem",color:C.gold,letterSpacing:"0.12em",textTransform:"uppercase",...MN}}>Guide</span><button onClick={()=>setShowAide(false)} style={{background:"none",border:"none",color:C.textDim,fontSize:"0.88rem",cursor:"pointer"}}>✕</button></div>
            {[["Ce qu'on cherche",q.aide.quoi,C.textDim],["Exemple",aidEx||q.aide.ex,C.goldL],["À éviter",q.aide.evite,C.textDim]].map(([t,v,c])=><div key={t} style={{marginBottom:"0.32rem"}}><div style={{fontSize:"0.54rem",color:C.goldD,textTransform:"uppercase",letterSpacing:"0.1em",...MN,marginBottom:"0.1rem"}}>{t}</div><div style={{fontSize:"0.75rem",color:c,lineHeight:1.5,fontStyle:t==="Exemple"?"italic":"normal"}}>{v}</div></div>)}
          </div>}

          <div style={{width:"24px",height:"1px",background:C.gold,opacity:0.4,marginBottom:"0.85rem"}}/>

          {q.type==="text"&&<input type="text" value={val||""} onChange={e=>setVal(e.target.value)} placeholder={ph} onKeyDown={e=>e.key==="Enter"&&tryNext()}
            style={{...iSt("q"),borderColor:qError?C.red:foc["q"]?C.goldD:C.border,borderBottomColor:qError?C.red:foc["q"]?C.gold:C.border,animation:qShake?"shake 0.45s ease":"none"}}
            onFocus={()=>setF("q",true)} onBlur={()=>setF("q",false)}/>}

          {q.type==="textarea"&&<textarea value={val||""} onChange={e=>setVal(e.target.value)} placeholder={ph} rows={4}
            style={{width:"100%",padding:"0.85rem",background:C.bg2,border:`1px solid ${qError?C.red:C.border}`,borderBottom:`2px solid ${qError?C.red:C.border}`,color:C.text,fontFamily:"'Jost',sans-serif",fontSize:"0.85rem",lineHeight:1.7,resize:"vertical",outline:"none",fontWeight:300,animation:qShake?"shake 0.45s ease":"none"}}
            onFocus={e=>{e.target.style.borderColor=`${C.gold}55`;e.target.style.borderBottomColor=`${C.gold}55`;}} onBlur={e=>{e.target.style.borderColor=qError?C.red:C.border;e.target.style.borderBottomColor=qError?C.red:C.border;}}/>}

          {q.type==="select"&&<div style={{animation:qShake?"shake 0.45s ease":"none"}}>{q.opts.map(opt=><button key={opt} onClick={()=>setVal(opt)} style={{width:"100%",display:"flex",gap:"0.6rem",marginBottom:"0.38rem",alignItems:"center",background:val===opt?`${C.gold}14`:"transparent",border:`1px solid ${val===opt?C.gold:C.border}`,color:val===opt?C.gold:C.textMid,padding:"0.68rem 0.85rem",textAlign:"left",transition:"all 0.2s",fontFamily:"'Jost',sans-serif",fontSize:"0.84rem",cursor:"pointer"}}><span style={{fontSize:"0.58rem"}}>{val===opt?"◉":"◎"}</span>{opt}</button>)}</div>}

          {q.type==="dual_select"&&<div style={{animation:qShake?"shake 0.45s ease":"none",display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.75rem"}}>
            {q.selects.map(sel=>{const sv=(val||{})[sel.id];return <div key={sel.id}>
              <div style={{fontSize:"0.56rem",color:C.goldD,letterSpacing:"0.15em",textTransform:"uppercase",...MN,marginBottom:"0.35rem"}}>{sel.label}</div>
              {sel.opts.map(opt=><button key={opt} onClick={()=>setSubVal(q.id,sel.id,opt)} style={{width:"100%",display:"flex",gap:"0.45rem",marginBottom:"0.3rem",alignItems:"center",background:sv===opt?`${C.gold}14`:"transparent",border:`1px solid ${sv===opt?C.gold:C.border}`,color:sv===opt?C.gold:C.textMid,padding:"0.55rem 0.65rem",textAlign:"left",transition:"all 0.2s",fontFamily:"'Jost',sans-serif",fontSize:"0.78rem",cursor:"pointer"}}><span style={{fontSize:"0.55rem"}}>{sv===opt?"◉":"◎"}</span>{opt.split("(")[0].trim()}</button>)}
            </div>;})}
          </div>}

          {q.type==="combo"&&<div style={{animation:qShake?"shake 0.45s ease":"none"}}>
            <div style={{marginBottom:"0.8rem"}}>
              <div style={{fontSize:"0.56rem",color:C.goldD,letterSpacing:"0.15em",textTransform:"uppercase",...MN,marginBottom:"0.35rem"}}>{q.multi.label} <span style={{color:C.textDim}}>max {q.multi.max}</span></div>
              {q.multi.opts.map(opt=>{const sel=((val||{}).domaines||[]).includes(opt);const atMax=((val||{}).domaines||[]).length>=q.multi.max&&!sel;
                return <button key={opt} onClick={()=>{if(atMax)return;const cur=(val||{}).domaines||[];setSubVal(q.id,"domaines",sel?cur.filter(v=>v!==opt):[...cur,opt]);}} style={{width:"100%",display:"flex",gap:"0.55rem",marginBottom:"0.3rem",alignItems:"center",background:sel?`${C.gold}14`:"transparent",border:`1px solid ${sel?C.gold:atMax?C.bg3:C.border}`,color:sel?C.gold:atMax?C.bg3:C.textMid,padding:"0.58rem 0.75rem",textAlign:"left",transition:"all 0.2s",fontFamily:"'Jost',sans-serif",fontSize:"0.82rem",opacity:atMax?0.3:1,cursor:atMax?"not-allowed":"pointer"}}><span style={{fontSize:"0.56rem"}}>{sel?"◉":"◎"}</span>{opt}</button>;
              })}
            </div>
            <div>
              <div style={{fontSize:"0.56rem",color:C.goldD,letterSpacing:"0.15em",textTransform:"uppercase",...MN,marginBottom:"0.35rem"}}>{q.text.label}</div>
              <input type="text" value={(val||{}).montant||""} placeholder={q.text.ph} onChange={e=>setSubVal(q.id,"montant",e.target.value)} style={{...iSt("montant"),borderColor:qError&&!((val||{}).montant)?C.red:foc["montant"]?C.goldD:C.border,borderBottomColor:qError&&!((val||{}).montant)?C.red:foc["montant"]?C.gold:C.border}} onFocus={()=>setF("montant",true)} onBlur={()=>setF("montant",false)}/>
            </div>
          </div>}

          {q.type==="adaptive_select"&&<div style={{animation:qShake?"shake 0.45s ease":"none"}}>
            <div style={{marginBottom:"0.8rem"}}>
              {q.opts.map(opt=><button key={opt} onClick={()=>setSubVal(q.id,"choice",opt)} style={{width:"100%",display:"flex",gap:"0.6rem",marginBottom:"0.38rem",alignItems:"center",background:(val||{}).choice===opt?`${C.gold}14`:"transparent",border:`1px solid ${(val||{}).choice===opt?C.gold:C.border}`,color:(val||{}).choice===opt?C.gold:C.textMid,padding:"0.68rem 0.85rem",textAlign:"left",transition:"all 0.2s",fontFamily:"'Jost',sans-serif",fontSize:"0.84rem",cursor:"pointer"}}><span style={{fontSize:"0.58rem"}}>{(val||{}).choice===opt?"◉":"◎"}</span>{opt}</button>)}
            </div>
            {(val||{}).choice&&<div style={{marginBottom:"0.8rem",animation:"fadeIn 0.3s ease"}}>
              <div style={{padding:"0.6rem 0.85rem",background:`${C.gold}08`,borderLeft:`3px solid ${C.goldD}`,marginBottom:"0.5rem"}}>
                <div style={{fontSize:"0.72rem",color:C.goldL,lineHeight:1.5}}>{q.follow?.[(val||{}).choice]?.ph||""}</div>
              </div>
              <textarea value={(val||{}).follow_answer||""} onChange={e=>setSubVal(q.id,"follow_answer",e.target.value)} placeholder={(val||{}).choice==="Oui, je les ai définis"?"Décris tes objectifs à 10 ans...":(val||{}).choice==="Pas encore"?"Qu'est-ce qui t'a empêché...":"Décris concrètement ce qui se passerait..."} rows={3}
                style={{width:"100%",padding:"0.85rem",background:C.bg2,border:`1px solid ${C.border}`,color:C.text,fontFamily:"'Jost',sans-serif",fontSize:"0.85rem",lineHeight:1.7,resize:"vertical",outline:"none",fontWeight:300}}
                onFocus={e=>e.target.style.borderColor=`${C.gold}55`} onBlur={e=>e.target.style.borderColor=C.border}/>
            </div>}
            {(val||{}).choice&&<div style={{animation:"fadeIn 0.3s ease"}}>
              <div style={{height:"1px",background:C.border,marginBottom:"0.8rem"}}/>
              <div style={{fontSize:"0.75rem",color:C.text,lineHeight:1.6,marginBottom:"0.5rem",fontWeight:400}}>{q.fixed?.label}</div>
              <textarea value={(val||{}).fixed_answer||""} onChange={e=>setSubVal(q.id,"fixed_answer",e.target.value)} placeholder={q.fixed?.ph||""} rows={3}
                style={{width:"100%",padding:"0.85rem",background:C.bg2,border:`1px solid ${C.border}`,color:C.text,fontFamily:"'Jost',sans-serif",fontSize:"0.85rem",lineHeight:1.7,resize:"vertical",outline:"none",fontWeight:300}}
                onFocus={e=>e.target.style.borderColor=`${C.gold}55`} onBlur={e=>e.target.style.borderColor=C.border}/>
            </div>}
          </div>}
        </div>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingBottom:"1.8rem",gap:"0.65rem",marginTop:"1.2rem"}}>
          {doneQ>0?<button onClick={goBack} style={{padding:"0.68rem 1rem",background:"transparent",border:`1px solid ${C.border}`,color:C.textDim,fontSize:"0.7rem",letterSpacing:"0.1em",textTransform:"uppercase",cursor:"pointer"}}>← Retour</button>:<div/>}
          <button onClick={tryNext} style={{
            padding:"0.85rem 1.6rem",background:C.gold,border:"none",color:C.bg,
            fontSize:"0.74rem",letterSpacing:"0.15em",textTransform:"uppercase",fontWeight:500,
            boxShadow:`0 4px 18px ${C.gold}35`,transition:"all 0.25s",cursor:"pointer",
            flex:doneQ===0?1:"auto"
          }}>{btnLabel}</button>
        </div>
      </div>
    );
  }

  // ── RECAP ──
  if(screen==="recap"){
    const allQ=(getSegments(answers?.q_domaine_principal)||SEGMENTS_FINANCES).flatMap(sg=>sg.questions);
    const fmt=(q,v)=>{if(!v)return "—";if(q.type==="dual_select")return `${v.heures||"?"} · ${v.moment?.split("(")[0].trim()||"?"}`;if(q.type==="combo")return `${(v.domaines||[]).join(", ")} · ${v.montant||"?"}`;if(q.type==="adaptive_select")return v.choice?`${v.choice} — ${(v.follow_answer||"").slice(0,60)}${(v.follow_answer||"").length>60?"…":""}`:("—");if(Array.isArray(v))return v.join(", ");return String(v).slice(0,100)+(String(v).length>100?"…":"");};
    return(
      <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Jost',sans-serif",padding:"2rem 1.4rem",maxWidth:"560px",margin:"0 auto",animation:"fadeUp 0.5s ease"}}>
        <link rel="stylesheet" href={FONT}/><style>{CSS}</style>
        <div style={{textAlign:"center",marginBottom:"1.4rem"}}>
          <div style={{fontSize:"0.54rem",letterSpacing:"0.28em",color:C.goldD,textTransform:"uppercase",...MN,marginBottom:"0.4rem"}}>Récapitulatif</div>
          <h2 style={{...SF,fontSize:"1.6rem",color:C.text,fontWeight:400}}>Vérifie tes réponses</h2>
          <p style={{fontSize:"0.78rem",color:C.textDim,marginTop:"0.28rem"}}>Tout est bon ? Lance la génération. Sinon — ✎ pour modifier.</p>
        </div>
        <div style={{marginBottom:"1.4rem"}}>{allQ.map(qu=>{const v=answers[qu.id];const display=fmt(qu,v);return(
          <div key={qu.id} style={{display:"flex",gap:"0.65rem",padding:"0.52rem 0",borderBottom:`1px solid ${C.border}`}}>
            <div style={{flex:1}}><div style={{fontSize:"0.58rem",color:C.textDim,marginBottom:"0.08rem",lineHeight:1.3}}>{qu.label}</div><div style={{fontSize:"0.81rem",color:display==="—"?C.textDim:C.text,fontStyle:display==="—"?"italic":"normal",lineHeight:1.4}}>{display}</div></div>
            <button onClick={()=>{const activeS=getSegments(answers?.q_domaine_principal)||SEGMENTS_FINANCES;const sgi=activeS.findIndex(sg=>sg.questions.some(q2=>q2.id===qu.id));const qii=activeS[sgi].questions.findIndex(q2=>q2.id===qu.id);setSi(sgi);setQi(qii);setScreen("quiz");}} style={{background:"none",border:`1px solid ${C.border}`,color:C.textDim,padding:"0.2rem 0.42rem",fontSize:"0.6rem",flexShrink:0,...MN,cursor:"pointer"}}>✎</button>
          </div>);})}
        </div>
        <div style={{textAlign:"center"}}>
          <button onClick={generate} style={{...BG,width:"100%",maxWidth:"320px"}}>Générer mon plan ✦</button>
          <div style={{marginTop:"0.55rem",fontSize:"0.68rem",color:C.textDim}}>~20 secondes · 2 appels parallèles.</div>
        </div>
      </div>
    );
  }

  if(screen==="loading")return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"2rem",fontFamily:"'Jost',sans-serif"}}>
      <link rel="stylesheet" href={FONT}/><style>{CSS}</style>
      <div style={{width:"48px",height:"48px",border:`1px solid ${C.goldD}`,borderTop:`2px solid ${C.gold}`,borderRadius:"50%",animation:"spin 1.1s linear infinite",marginBottom:"1.8rem"}}/>
      <div style={{...SF,fontSize:"1.4rem",color:C.gold,marginBottom:"0.35rem",textAlign:"center"}}>Ton système se construit</div>
      <div style={{color:C.textDim,fontSize:"0.76rem",marginBottom:"2.2rem",...MN}}>~20 secondes · 2 appels parallèles</div>
      <div style={{width:"100%",maxWidth:"290px"}}>{LOAD_STEPS.map((s,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:"0.6rem",padding:"0.42rem 0",borderBottom:`1px solid ${C.bg3}`,opacity:i<=loadStep?1:0.18,transition:"opacity 0.5s"}}>
        <span style={{color:i<=loadStep?C.gold:C.textDim,animation:i===loadStep?"pulse 1.1s ease-in-out infinite":"none",minWidth:"11px",fontSize:"0.76rem"}}>✦</span>
        <span style={{fontSize:"0.76rem",color:i===loadStep?C.text:C.textDim,...(i!==loadStep?MN:{})}}>{s}</span>
        {i<loadStep&&<span style={{marginLeft:"auto",color:C.green,fontSize:"0.68rem"}}>✓</span>}
      </div>)}</div>
    </div>
  );

  if(screen==="error")return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"2rem",fontFamily:"'Jost',sans-serif",textAlign:"center"}}>
      <link rel="stylesheet" href={FONT}/><style>{CSS}</style>
      <div style={{...SF,fontSize:"1.4rem",color:C.gold,marginBottom:"0.9rem"}}>Une erreur est survenue</div>
      <p style={{color:C.textDim,marginBottom:"0.5rem",maxWidth:"300px",lineHeight:1.6,fontSize:"0.81rem"}}>{errMsg}</p>
      <p style={{color:C.textDim,marginBottom:"1.8rem",maxWidth:"300px",lineHeight:1.6,fontSize:"0.72rem",fontStyle:"italic"}}>Souvent causé par un problème réseau temporaire. Réessaie d'abord.</p>
      <div style={{display:"flex",gap:"0.65rem",flexWrap:"wrap",justifyContent:"center"}}>
        <button onClick={()=>generate()} style={{padding:"0.78rem 1.3rem",background:`${C.gold}15`,border:`1px solid ${C.goldD}`,color:C.gold,fontSize:"0.7rem",letterSpacing:"0.1em",textTransform:"uppercase",cursor:"pointer"}}>↺ Réessayer</button>
        <button onClick={()=>setScreen("recap")} style={{padding:"0.78rem 1.3rem",background:"transparent",border:`1px solid ${C.border}`,color:C.textDim,fontSize:"0.7rem",letterSpacing:"0.1em",textTransform:"uppercase",cursor:"pointer"}}>Modifier les réponses</button>
        <button onClick={reset} style={{...BG,padding:"0.78rem 1.3rem"}}>Recommencer</button>
      </div>
    </div>
  );

  // ── HOME ──
  if(screen==="home"&&plan){
    const sc=plan.scorecard||{};
    const today=new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
    const curWeek=weeks?weeks.find(w=>w.semaine===Math.min(Math.ceil(dn/7),12)):null;
    const autosuggestion=plan2?.rituel?.autosuggestion||"";
    const curStreak=computeStreak(logs);

    const logKeys = Object.keys(logs).sort();
    const lastLogDate = logKeys.length > 0 ? logKeys[logKeys.length-1] : null;
    const today_key = todayKey();
    const daysSinceLastLog = lastLogDate
      ? Math.floor((new Date(today_key) - new Date(lastLogDate)) / (1000*60*60*24))
      : null;
    const isAbsent = daysSinceLastLog !== null && daysSinceLastLog >= 2;
    const absenceDays = daysSinceLastLog;

    const getRetourMsg = (days) => {
      if(days >= 14) return {
        titre: `${days} jours d'absence.`,
        corps: "Pas de jugement. Pas d'explication nécessaire. Le plan t'attend exactement là où tu l'as laissé.",
        action: "Une seule chose maintenant : ouvre le tracker et note ta journée d'aujourd'hui.",
        color: C.red,
      };
      if(days >= 7) return {
        titre: `${days} jours sans tracker.`,
        corps: "C'est ton pattern de résistance qui parle — pas toi. Ça arrive. Ce qui compte c'est maintenant.",
        action: "Reprends avec 5 minutes aujourd'hui. Pas plus. Juste 5 minutes.",
        color: C.gold,
      };
      return {
        titre: `${days} jours sans tracker.`,
        corps: "Tu as manqué quelques jours. C'est humain. La continuité ne demande pas la perfection — elle demande le retour.",
        action: "Enregistre ta journée d'aujourd'hui. C'est tout.",
        color: C.gold,
      };
    };
    const retourMsg = isAbsent ? getRetourMsg(absenceDays) : null;

    return(
      <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Jost',sans-serif",maxWidth:"660px",margin:"0 auto",padding:"1.1rem 0.9rem 4rem",animation:"fadeUp 0.5s ease"}}>
        <link rel="stylesheet" href={FONT}/><style>{CSS}</style>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.2rem",paddingBottom:"0.85rem",borderBottom:`1px solid ${C.border}`}}>
          <div>
            <div style={{fontSize:"0.56rem",color:C.goldD,letterSpacing:"0.2em",textTransform:"uppercase",...MN,marginBottom:"0.1rem"}}>{today}</div>
            <div style={{...SF,fontSize:"1rem",color:C.gold}}>{plan.nom_guerre}</div>
          </div>
          <div style={{display:"flex",gap:"0.5rem",alignItems:"center"}}>
            {curStreak>0&&<div style={{display:"flex",alignItems:"center",gap:"0.25rem",padding:"0.3rem 0.6rem",background:curStreak>=7?`${C.green}18`:curStreak>=3?`${C.gold}18`:`${C.bg3}`,border:`1px solid ${curStreak>=7?C.green:curStreak>=3?C.goldD:C.border}`}}>
              <span style={{fontSize:"0.8rem"}}>🔥</span>
              <span style={{fontSize:"0.7rem",color:curStreak>=7?C.green:curStreak>=3?C.gold:C.textDim,...MN,fontWeight:400}}>{curStreak}j</span>
            </div>}
            <button onClick={()=>setScreen("result")} style={{padding:"0.38rem 0.65rem",background:`${C.gold}12`,border:`1px solid ${C.goldD}`,color:C.gold,fontSize:"0.6rem",letterSpacing:"0.08em",...MN,cursor:"pointer"}}>Plan complet</button>
            <button onClick={()=>setScreen("plan-select")} style={{padding:"0.38rem 0.65rem",background:"transparent",border:`1px solid ${C.goldD}`,color:C.goldD,fontSize:"0.6rem",...MN,cursor:"pointer"}} title="Mes plans">⊞</button>
            <button onClick={reset} style={{padding:"0.38rem 0.5rem",background:"transparent",border:`1px solid ${C.border}`,color:C.textDim,fontSize:"0.6rem",...MN,cursor:"pointer"}}>↩</button>
          </div>
        </div>

        <button onClick={joinCommunity} style={{
          width:"100%",display:"flex",alignItems:"center",gap:"0.75rem",
          padding:"0.85rem 1rem",marginBottom:"1rem",
          background:"#25D36615",border:"1px solid #25D36640",
          cursor:"pointer",transition:"all 0.2s",
        }}>
          <span style={{fontSize:"1.2rem"}}>💬</span>
          <div style={{textAlign:"left",flex:1}}>
            <div style={{fontSize:"0.78rem",color:"#25D366",fontWeight:400}}>Rejoindre la Communauté 90 Jours ✦</div>
            <div style={{fontSize:"0.62rem",color:C.textDim,...MN,marginTop:"0.1rem"}}>Des centaines de personnes vivent ce programme · Partage · Questions · Victoires</div>
          </div>
          <span style={{fontSize:"0.7rem",color:"#25D366"}}>→</span>
        </button>

        {retourMsg&&<div style={{
          padding:"1.2rem 1.3rem",marginBottom:"1.2rem",
          background:`${retourMsg.color}08`,
          border:`1px solid ${retourMsg.color}40`,
          borderLeft:`4px solid ${retourMsg.color}`,
          animation:"fadeUp 0.4s ease"
        }}>
          <div style={{fontSize:"0.56rem",color:retourMsg.color,letterSpacing:"0.2em",textTransform:"uppercase",...MN,marginBottom:"0.5rem"}}>
            Bienvenue de retour
          </div>
          <div style={{...SF,fontSize:"1.1rem",color:retourMsg.color,marginBottom:"0.5rem"}}>{retourMsg.titre}</div>
          <p style={{fontSize:"0.85rem",color:C.textMid,lineHeight:1.75,marginBottom:"0.65rem"}}>{retourMsg.corps}</p>
          <div style={{padding:"0.6rem 0.85rem",background:`${retourMsg.color}10`,borderLeft:`2px solid ${retourMsg.color}`,fontSize:"0.82rem",color:C.text,lineHeight:1.6}}>
            ✦ {retourMsg.action}
          </div>
        </div>}

        {!retourMsg&&autosuggestion&&<div style={{
          padding:"1.2rem 1.3rem",marginBottom:"1rem",
          background:`linear-gradient(135deg,${C.gold}12,${C.gold}06)`,
          border:`1px solid ${C.goldD}`,borderTop:`3px solid ${C.gold}`,
          position:"relative",overflow:"hidden"
        }}>
          <div style={{position:"absolute",top:"0.6rem",right:"0.8rem",fontSize:"0.52rem",color:C.goldD,letterSpacing:"0.2em",textTransform:"uppercase",...MN}}>Autosuggestion · 3× à voix haute</div>
          <div style={{...SF,fontSize:"clamp(1rem,3.5vw,1.25rem)",color:C.gold,fontStyle:"italic",lineHeight:1.65,marginTop:"0.8rem"}}>{autosuggestion}</div>
        </div>}

        {!retourMsg&&contMsg&&<div style={{padding:"0.75rem 0.9rem",background:`${C.gold}07`,borderLeft:`3px solid ${C.gold}`,marginBottom:"0.9rem"}}>
          <div style={{fontSize:"0.54rem",color:C.goldD,letterSpacing:"0.18em",...MN,marginBottom:"0.2rem"}}>MESSAGE JOUR {dn}</div>
          <div style={{fontSize:"0.8rem",color:C.goldL,lineHeight:1.65,fontStyle:"italic"}}>{contMsg.msg}</div>
        </div>}
        <Card accent>
          <div style={{display:"flex",gap:"0.9rem",alignItems:"center",marginBottom:"0.9rem"}}>
            <ProgressCircle day={Math.min(dn,90)} size={105}/>
            <div style={{flex:1}}>
              <div style={{fontSize:"0.54rem",color:lv.color,letterSpacing:"0.2em",textTransform:"uppercase",...MN,marginBottom:"0.25rem"}}>Niveau — {lv.label}</div>
              <div style={{...SF,fontSize:"0.95rem",color:C.goldL,lineHeight:1.4,marginBottom:"0.5rem"}}>{sc.mission_centrale}</div>
              <div style={{fontSize:"0.56rem",color:C.textDim,...MN,marginBottom:"0.2rem"}}>Exécution — {stats.execRate}%</div>
              <div style={{height:"4px",background:C.bg3,marginBottom:"0.25rem"}}><div style={{height:"100%",width:`${stats.execRate}%`,background:`linear-gradient(90deg,${C.goldD},${C.gold})`,transition:"width 1s ease"}}/></div>
              <div style={{fontSize:"0.65rem",color:C.textDim}}>{lv.desc}</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"0.35rem",paddingTop:"0.7rem",borderTop:`1px solid ${C.border}`}}>
            {[{val:`${stats.streak}j`,lbl:"Streak",color:stats.streak>=3?C.green:C.textDim},{val:`${stats.done}`,lbl:"Actions ✓",color:stats.done>0?C.gold:C.textDim},{val:`${stats.relapses}`,lbl:"Rechutes",color:C.textDim},{val:`${Math.round(stats.totalMins/60*10)/10}h`,lbl:"Investies",color:C.blue}].map(({val,lbl,color})=><div key={lbl} style={{textAlign:"center",padding:"0.4rem 0.1rem",background:C.bg3}}>
              <div style={{...SF,fontSize:"1rem",color}}>{val}</div>
              <div style={{fontSize:"0.52rem",color:C.textDim,letterSpacing:"0.08em",textTransform:"uppercase",...MN,marginTop:"0.08rem"}}>{lbl}</div>
            </div>)}
          </div>
        </Card>
        <div style={{
          padding:"1.2rem 1.3rem",marginBottom:"1rem",
          background:`linear-gradient(135deg,${C.green}15,${C.green}05)`,
          border:`2px solid ${C.green}50`,borderTop:`4px solid ${C.green}`,
          position:"relative",animation:"fadeUp 0.4s ease"
        }}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.6rem"}}>
            <div style={{fontSize:"0.56rem",color:C.green,letterSpacing:"0.2em",textTransform:"uppercase",...MN}}>◉ Maintenant — Jour {dn}</div>
            <div style={{fontSize:"0.58rem",color:C.textDim,...MN}}>{90-dn} jours restants</div>
          </div>
          <div style={{...SF,fontSize:"clamp(0.95rem,3vw,1.1rem)",color:C.text,lineHeight:1.65,marginBottom:"0.85rem"}}>
            {plan2?.rituel?.premiere_action_du_jour||"Lance ton plan pour voir l'action du jour."}
          </div>
          <button onClick={()=>{setTrackerOpen(true);setTimeout(()=>document.getElementById("tracker-section")?.scrollIntoView({behavior:"smooth"}),100);}}
            style={{width:"100%",padding:"0.75rem",background:C.green,border:"none",color:C.bg,fontSize:"0.74rem",letterSpacing:"0.12em",...MN,cursor:"pointer",fontWeight:500}}>
            ✓ C'est fait — Enregistrer
          </button>
        </div>

        <div id="tracker-section">
        <Card>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:trackerOpen?"0.9rem":"0",cursor:"pointer"}} onClick={()=>setTrackerOpen(o=>!o)}>
            <SH icon="📈" label={`Tracker — Jour ${dn}`} sub={todayLog?"✓ Enregistré aujourd'hui":"Enregistre ta journée"}/>
            <span style={{color:C.textDim,fontSize:"0.95rem",marginTop:"-0.7rem"}}>{trackerOpen?"−":"+"}</span>
          </div>
          {trackerOpen&&<DailyTracker dayNum={dn} todayLog={todayLog} onSave={log=>{saveLog(log);setTrackerOpen(false);}} logs={logs}/>}
        </Card>
        </div>
        {plan2?.rituel?.matin&&<Card><SH icon="🌬" label="Rituel du jour" sub="< 10 min · Timer intégré"/><RituelTimer steps={plan2.rituel.matin} nomGuerre={plan.nom_guerre} onComplete={()=>{if(todayLog){saveLog({...todayLog,rituel_done:true});}}} /></Card>}
        <CoachChat plan={plan} plan2={plan2} weeks={weeks} dailyLogs={logs}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.45rem"}}>
          {[{lbl:"📅 Plan semaines",sub:"12 semaines + checklist",action:()=>{setTab("plan");setScreen("result");if(!weeks&&!weeksLoading)generateWeeks(plan);}},{lbl:"📊 Dashboard",sub:"Scorecard + Identité future",action:()=>{setTab("dashboard");setScreen("result");}},{lbl:"🛡 Anti-abandon",sub:"Protocoles de rechute",action:()=>{setTab("anti-abandon");setScreen("result");}},{lbl:"↓ PDF Premium",sub:"Collector · Page identité",action:printPDF}].map(({lbl,sub,action})=><button key={lbl} onClick={action} style={{padding:"0.75rem",background:C.bg2,border:`1px solid ${C.border}`,color:C.text,textAlign:"left",cursor:"pointer",transition:"all 0.2s"}}>
            <div style={{fontSize:"0.8rem",marginBottom:"0.15rem"}}>{lbl}</div>
            <div style={{fontSize:"0.63rem",color:C.textDim}}>{sub}</div>
          </button>)}
        </div>
      </div>
    );
  }

  // ── RESULT ──
  if(screen==="result"&&plan){
    const s=plan,s2=plan2||{};const sc=s.scorecard||{};
    const scores=[{k:"Discipline",d:sc.discipline},{k:"Focus",d:sc.focus},{k:"Énergie",d:sc.energie},{k:"Clarté",d:sc.clarte},{k:"Constance",d:sc.constance}];
    const riskColor={"Faible":C.green,"Modéré":C.gold,"Élevé":C.red}[sc.risque_abandon]||C.gold;
    const tabs=["dashboard","rituel","plan","anti-abandon","lectures","coach","engagement"];
    const plLbl=weeksLoading?"Plan 90J ↻":weeks?"Plan 90J ✓":"Plan 90J ↓";
    const tLabels={dashboard:"Dashboard",rituel:"Rituel",plan:plLbl,"anti-abandon":"Anti-Abandon",lectures:"Lectures",coach:"Coach IA",engagement:"✦ Engagement"};
    return(
      <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Jost',sans-serif",maxWidth:"680px",margin:"0 auto",padding:"0 0.9rem 3rem"}}>
        <link rel="stylesheet" href={FONT}/><style>{CSS}</style>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"1rem 0 0.5rem"}}>
          <button onClick={()=>setScreen("home")} style={{background:"none",border:"none",color:C.textDim,fontSize:"0.68rem",letterSpacing:"0.1em",...MN,cursor:"pointer"}}>← Accueil</button>
          <button onClick={reset} style={{padding:"0.35rem 0.75rem",background:`${C.red}15`,border:`1px solid ${C.red}50`,color:C.red,fontSize:"0.65rem",letterSpacing:"0.1em",...MN,cursor:"pointer"}}>↩ Nouveau plan</button>
        </div>
        <div style={{textAlign:"center",paddingBottom:"0.9rem",animation:"fadeUp 0.6s ease"}}>
          <div style={{fontSize:"0.54rem",letterSpacing:"0.28em",color:C.goldD,textTransform:"uppercase",...MN,marginBottom:"0.35rem"}}>Plan complet</div>
          <h1 style={{...SF,fontSize:"clamp(1.4rem,5vw,2rem)",fontWeight:400,color:C.text}}>Mon Plan de Vie 90 Jours</h1>
          <div style={{...SF,fontSize:"0.9rem",fontStyle:"italic",color:C.gold,marginTop:"0.18rem"}}>Pour {firstName}</div>
          <div style={{margin:"1.1rem auto 0",maxWidth:"420px",padding:"0.9rem",background:`${C.gold}0E`,border:`1px solid ${C.goldD}`,borderTop:`2px solid ${C.gold}`}}>
            <div style={{fontSize:"0.54rem",color:C.goldD,letterSpacing:"0.25em",textTransform:"uppercase",...MN,marginBottom:"0.35rem"}}>Nom de Guerre</div>
            <div style={{...SF,fontSize:"1.4rem",color:C.gold,fontWeight:500}}>{s.nom_guerre}</div>
            <div style={{fontSize:"0.75rem",color:C.textMid,marginTop:"0.45rem",lineHeight:1.5}}>{s.pourquoi_ce_nom}</div>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"0.3rem",marginBottom:"1rem"}}>
          {[{lbl:"↓ PDF",a:printPDF,bg:C.gold,c:C.bg},{lbl:"↓ Sheets",a:exportSheets,bg:"#3498DB",c:"#fff"},{lbl:"💬 Communauté",a:joinCommunity,bg:"#25D36618",c:"#25D366"}].map(({lbl,a,bg,c})=><button key={lbl} onClick={a} style={{padding:"0.72rem 0.1rem",background:bg,border:"none",color:c,fontSize:"0.68rem",letterSpacing:"0.05em",cursor:"pointer",transition:"all 0.2s"}}>{lbl}</button>)}
        </div>
        <div style={{display:"flex",gap:"0.22rem",marginBottom:"1rem",overflowX:"auto",paddingBottom:"0.22rem"}}>
          {tabs.map(t=><button key={t} onClick={()=>{setTab(t);if(t==="plan"&&!weeks&&!weeksLoading)generateWeeks(plan);}} style={{padding:"0.48rem 0.68rem",background:tab===t?`${C.gold}18`:"transparent",border:`1px solid ${tab===t?C.gold:C.border}`,color:tab===t?C.gold:C.textDim,...MN,fontSize:"0.58rem",letterSpacing:"0.08em",cursor:"pointer",whiteSpace:"nowrap",textTransform:"uppercase",transition:"all 0.2s"}}>{tLabels[t]}</button>)}
        </div>

        {tab==="dashboard"&&<div style={{animation:"fadeUp 0.4s ease"}}>
          {s.identite_future&&<Card><SH icon="◈" label="Identité Future — Jour 90"/>
            <div style={{display:"grid",gridTemplateColumns:"1fr",gap:"0.5rem"}}>
              {[["Comment je pense",s.identite_future.comment_pense,C.gold],["Comment j'agis",s.identite_future.comment_agit,C.goldL],["Ce que je ne tolère plus",s.identite_future.ne_tolere_plus,C.red],["Mes nouveaux standards",s.identite_future.nouveaux_standards,C.green]].map(([l,v,c])=><div key={l} style={{padding:"0.55rem 0.75rem",background:`${c}0A`,borderLeft:`3px solid ${c}`}}><div style={{fontSize:"0.54rem",color:c,textTransform:"uppercase",letterSpacing:"0.1em",...MN,marginBottom:"0.18rem"}}>{l}</div><div style={{fontSize:"0.8rem",color:C.textMid,lineHeight:1.5}}>{v}</div></div>)}
            </div>
          </Card>}
          <Card accent><SH icon="◈" label="Diagnostic Lucide"/>
            <p style={{color:C.textMid,lineHeight:1.78,fontSize:"0.87rem",marginBottom:"0.85rem"}}>{s.diagnostic?.resume}</p>
            {[["Bloquant central",s.diagnostic?.bloquant_central,C.red],["Schéma de sabotage",s.diagnostic?.schema_sabotage,C.gold],["Leçon",s.diagnostic?.lecon_echec,C.green]].map(([l,v,c])=><div key={l} style={{padding:"0.58rem 0.78rem",background:`${c}0A`,border:`1px solid ${c}25`,borderLeft:`3px solid ${c}`,marginBottom:"0.5rem"}}><div style={{fontSize:"0.54rem",color:c,textTransform:"uppercase",letterSpacing:"0.1em",...MN,marginBottom:"0.15rem"}}>{l}</div><div style={{fontSize:"0.8rem",color:C.textMid,lineHeight:1.5}}>{v}</div></div>)}
          </Card>
          <Card><SH icon="📊" label="Scorecard"/>
            {scores.map(({k,d})=>d?<ScoreBar key={k} label={k} score={d.score} lecture={d.lecture}/>:null)}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.5rem",marginTop:"0.75rem"}}>
              <div style={{padding:"0.68rem",background:`${riskColor}0E`,border:`1px solid ${riskColor}35`}}><div style={{fontSize:"0.54rem",color:riskColor,textTransform:"uppercase",letterSpacing:"0.1em",...MN,marginBottom:"0.18rem"}}>Risque abandon</div><div style={{...SF,fontSize:"0.92rem",color:riskColor}}>{sc.risque_abandon}</div><div style={{fontSize:"0.68rem",color:C.textDim,marginTop:"0.15rem",lineHeight:1.4}}>{sc.facteur_risque}</div></div>
              <div style={{padding:"0.68rem",background:`${C.green}0A`,border:`1px solid ${C.green}35`}}><div style={{fontSize:"0.54rem",color:C.green,textTransform:"uppercase",letterSpacing:"0.1em",...MN,marginBottom:"0.18rem"}}>Levier principal</div><div style={{fontSize:"0.77rem",color:C.textMid,lineHeight:1.4}}>{sc.levier_principal}</div></div>
            </div>
            <div style={{marginTop:"0.5rem",padding:"0.75rem",background:`${C.gold}08`,border:`1px solid ${C.goldD}35`,borderLeft:`3px solid ${C.gold}`}}><div style={{fontSize:"0.54rem",color:C.goldD,textTransform:"uppercase",letterSpacing:"0.1em",...MN,marginBottom:"0.18rem"}}>Mission centrale</div><div style={{...SF,fontSize:"0.92rem",color:C.goldL,lineHeight:1.5}}>{sc.mission_centrale}</div></div>

            {stats.total>0&&(()=>{
              const s4=computeScore4(logs,plan);
              return <div style={{marginTop:"0.75rem",padding:"0.75rem",background:C.bg3,border:`1px solid ${C.border}`}}>
                <div style={{fontSize:"0.54rem",color:C.goldD,letterSpacing:"0.15em",textTransform:"uppercase",...MN,marginBottom:"0.6rem"}}>Progression réelle — Jour {stats.total}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem"}}>
                  {[["⚡ Exécution",s4.execution,C.gold,"Actions réalisées"],[" Identité",s4.identite,C.green,"Rituels accomplis"],["◈ Cohérence",s4.coherence,C.blue,"Jours sans rechute"],["▶ Progression",s4.progression,C.goldL,"Distance parcourue"]].map(([lbl,val,col,sub])=>(
                    <div key={lbl} style={{padding:"0.55rem",background:`${col}08`,border:`1px solid ${col}22`}}>
                      <div style={{fontSize:"0.6rem",color:col,letterSpacing:"0.08em",...MN}}>{lbl}</div>
                      <div style={{...SF,fontSize:"1.3rem",color:col,margin:"0.15rem 0"}}>{val}<span style={{fontSize:"0.6rem"}}>%</span></div>
                      <div style={{fontSize:"0.58rem",color:C.textDim}}>{sub}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:"0.5rem",padding:"0.45rem",background:`${C.gold}08`,borderLeft:`2px solid ${C.gold}`,fontSize:"0.72rem",color:C.goldL}}>
                  Score global : <strong>{s4.global}%</strong>
                </div>
              </div>;
            })()}
          </Card>
          {stats.total>0&&<Card><SH icon="🏆" label="Ce que tu as déjà prouvé"/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.45rem"}}>
              {[[`${stats.streak}j consécutifs`,"de continuité",stats.streak>=3?C.green:C.gold],[`${stats.done} actions`,"exécutées",C.gold],[`${stats.relapses} rechute${stats.relapses!==1?"s":""}`, "récupérée${stats.relapses!==1?'s':''}",C.green],[`${Math.round(stats.totalMins/60*10)/10}h`,"investies",C.blue]].map(([v,l,c])=><div key={l} style={{padding:"0.65rem",background:`${c}0A`,border:`1px solid ${c}22`}}><div style={{...SF,fontSize:"1.05rem",color:c,marginBottom:"0.1rem"}}>{v}</div><div style={{fontSize:"0.62rem",color:C.textDim,lineHeight:1.3}}>{l}</div></div>)}
            </div>
          </Card>}
          <Card><SH icon="🏆" label="Ma victoire de la semaine" sub="Le cerveau oublie ses progrès — écris le tien"/>
            <WeeklyVictory logs={logs}/>
          </Card>

          {s.citations_personnelles?.length>0&&<Card><SH icon="✦" label="Phrases personnelles" sub="Générées à partir de ton profil"/>
            {s.citations_personnelles.map((c,i)=><div key={i} style={{padding:"0.65rem 0.85rem",borderLeft:`2px solid ${C.goldD}`,marginBottom:"0.45rem",background:C.bg3}}><div style={{...SF,fontSize:"0.92rem",color:C.goldL,fontStyle:"italic",lineHeight:1.55}}>{c}</div></div>)}
          </Card>}
          <Card accent><SH icon="✦" label="Message Final"/>
            <p style={{color:C.textMid,lineHeight:1.85,fontSize:"0.87rem",fontStyle:"italic"}}>{s2.message_final}</p>
          </Card>
          <div style={{padding:"0.95rem",background:`${C.gold}08`,border:`1px solid ${C.goldD}`,borderTop:`2px solid ${C.gold}`,textAlign:"center",marginBottom:"1rem"}}><div style={{fontSize:"0.54rem",color:C.goldD,letterSpacing:"0.25em",textTransform:"uppercase",...MN,marginBottom:"0.4rem"}}>Contrat</div><div style={{...SF,fontSize:"0.97rem",color:C.gold,fontStyle:"italic",lineHeight:1.6}}>{s2.contrat}</div></div>
        </div>}

        {tab==="rituel"&&<div style={{animation:"fadeUp 0.4s ease"}}>
          <Card accent><SH icon="🌬" label="Rituel d'Activation" sub="< 10 min · Timer intégré · Chaque jour"/>
            <div style={{padding:"0.82rem 0.95rem",background:`${C.gold}0E`,border:`1px solid ${C.goldD}`,borderLeft:`3px solid ${C.gold}`,marginBottom:"1rem"}}><div style={{fontSize:"0.54rem",color:C.goldD,letterSpacing:"0.2em",textTransform:"uppercase",...MN,marginBottom:"0.28rem"}}>Autosuggestion — 3× à voix haute</div><div style={{...SF,fontSize:"1.02rem",color:C.goldL,fontStyle:"italic",lineHeight:1.6}}>{s2.rituel?.autosuggestion}</div></div>
            {s2.rituel?.matin&&<RituelTimer steps={s2.rituel.matin}/>}
            <div style={{marginTop:"0.85rem",padding:"0.68rem 0.82rem",background:`${C.green}0A`,border:`1px solid ${C.green}25`}}><div style={{fontSize:"0.54rem",color:C.green,textTransform:"uppercase",letterSpacing:"0.1em",...MN,marginBottom:"0.18rem"}}>◉ Première action — dans les 2 min</div><div style={{fontSize:"0.83rem",color:C.text,lineHeight:1.5}}>{s2.rituel?.premiere_action_du_jour}</div></div>
            <div style={{marginTop:"0.5rem",padding:"0.68rem 0.82rem",background:C.bg3,borderLeft:`2px solid ${C.goldD}`}}><div style={{fontSize:"0.54rem",color:C.goldD,textTransform:"uppercase",letterSpacing:"0.1em",...MN,marginBottom:"0.15rem"}}>Soir <Tag>{s2.rituel?.soir?.duree}</Tag></div><div style={{fontSize:"0.8rem",color:C.textMid,lineHeight:1.5}}>{s2.rituel?.soir?.action}</div></div>
          </Card>
          <Card><SH icon="🛡" label="Protocole de Rechute" sub={`"${s2.protocole_rechute?.contexte||""}"`}/>
            {[["5 premières minutes",s2.protocole_rechute?.["5_minutes"],C.red],["24 heures",s2.protocole_rechute?.["24h"],C.gold],["48 heures",s2.protocole_rechute?.["48h"],C.green]].map(([l,v,c])=><div key={l} style={{marginBottom:"0.55rem",padding:"0.62rem 0.8rem",background:`${c}08`,borderLeft:`3px solid ${c}`}}><div style={{fontSize:"0.54rem",color:c,textTransform:"uppercase",letterSpacing:"0.1em",...MN,marginBottom:"0.15rem"}}>{l}</div><div style={{fontSize:"0.79rem",color:C.textMid,lineHeight:1.5}}>{v}</div></div>)}
            <div style={{padding:"0.7rem 0.85rem",background:`${C.gold}08`,border:`1px solid ${C.goldD}35`}}><div style={{fontSize:"0.54rem",color:C.goldD,textTransform:"uppercase",letterSpacing:"0.1em",...MN,marginBottom:"0.15rem"}}>Règle du Non-Zéro</div><div style={{fontSize:"0.81rem",color:C.text,lineHeight:1.5}}>{s2.protocole_rechute?.regle_non_zero}</div></div>
          </Card>
        </div>}

        {tab==="plan"&&<div style={{animation:"fadeUp 0.4s ease"}}>
          {weeksLoading&&<div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"2.5rem 0",gap:"0.9rem"}}><div style={{width:"36px",height:"36px",border:`1px solid ${C.goldD}`,borderTop:`2px solid ${C.gold}`,borderRadius:"50%",animation:"spin 1.1s linear infinite"}}/><div style={{color:C.textDim,fontSize:"0.76rem",...MN}}>Génération des 12 semaines…</div></div>}
          {!weeksLoading&&weeks!==null&&weeks.length===0&&<Card><div style={{textAlign:"center",padding:"0.75rem",color:C.textDim,fontSize:"0.81rem"}}><div style={{marginBottom:"0.65rem"}}>Impossible de charger.</div><button onClick={()=>{setWeeks(null);generateWeeks(plan);}} style={{padding:"0.52rem 1rem",background:C.gold,border:"none",color:C.bg,fontSize:"0.7rem",letterSpacing:"0.1em",cursor:"pointer"}}>Réessayer</button></div></Card>}
          {!weeksLoading&&weeks&&weeks.length>0&&(()=>{
            const nrm=s=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
            const getWeekScore=(wn)=>computeWeekScore(wn, logs, startDate);
            const isWeekUnlocked=(weekNum)=>{
              if(weekNum<=1)return true;
              const prevScore=getWeekScore(weekNum-1);
              if(prevScore===null)return false;
              return prevScore.total>=(weeks.find(w=>(w.semaine||w.s)===weekNum-1)?.seuil||6);
            };
            return ["ÉVEIL","CONSTRUCTION","RÉCOLTE"].map(phase=>{
              const pw=weeks.filter(w=>nrm(w.phase||w.ph||"")===nrm(phase));if(!pw.length)return null;
              const pc=phase==="ÉVEIL"?C.blue:phase==="CONSTRUCTION"?C.gold:C.green;
              const pd=phase==="ÉVEIL"?"J1–30 · Briser les habitudes":phase==="CONSTRUCTION"?"J31–60 · Construire":"J61–90 · Ancrer";
              return <div key={phase} style={{marginBottom:"1.2rem"}}>
                <div style={{padding:"0.48rem 0.85rem",background:`${pc}10`,border:`1px solid ${pc}35`,borderBottom:"none",display:"flex",alignItems:"center",gap:"0.6rem"}}><Tag color={pc}>{phase}</Tag><span style={{fontSize:"0.7rem",color:C.textDim}}>{pd}</span></div>
                <div style={{border:`1px solid ${pc}35`}}>{pw.map(w=>{
                  const wn=w.semaine||w.s;
                  const locked=!isWeekUnlocked(wn);
                  const prevScore=wn>1?getWeekScore(wn-1):null;
                  return <WeekCard key={wn} w={w} weekNum={wn} checked={checks} onCheck={toggleCheck} isLocked={locked} prevWeekScore={prevScore?.total??null} nomGuerre={plan?.nom_guerre} logs={logs} startDate={startDate}/>;
                })}</div>
              </div>;
            });
          })()}
        </div>}

        {tab==="anti-abandon"&&<div style={{animation:"fadeUp 0.4s ease"}}>
          <Card accent><SH icon="🔒" label="Système Anti-Abandon" sub="Le système tient quand la motivation lâche"/>
            <div style={{marginBottom:"0.85rem"}}><div style={{fontSize:"0.54rem",color:C.gold,textTransform:"uppercase",letterSpacing:"0.15em",...MN,marginBottom:"0.4rem"}}>Règles de continuité</div>
              {(s2.anti_abandon?.regles||[]).map((r,i)=><div key={i} style={{display:"flex",gap:"0.6rem",marginBottom:"0.38rem",alignItems:"flex-start"}}><span style={{...MN,fontSize:"0.63rem",color:C.gold,minWidth:"1.4rem",marginTop:"0.08rem"}}>{String(i+1).padStart(2,"0")}</span><span style={{fontSize:"0.81rem",color:C.text,lineHeight:1.55}}>{r}</span></div>)}
            </div>
            {[["Jour difficile",s2.protocole_rechute?.jour_difficile,C.gold],["Motivation basse",s2.protocole_rechute?.motivation_basse,C.red],["Rechute émotionnelle",s2.protocole_rechute?.rechute_emotionnelle,C.purple],["Fatigue mentale",s2.protocole_rechute?.fatigue_mentale,C.blue],["Version minimale",s2.anti_abandon?.version_minimale,C.green]].filter(([,v])=>v).map(([l,v,c])=><div key={l} style={{marginBottom:"0.6rem",padding:"0.75rem 0.85rem",background:`${c}08`,border:`1px solid ${c}25`,borderLeft:`3px solid ${c}`}}><div style={{fontSize:"0.54rem",color:c,textTransform:"uppercase",letterSpacing:"0.1em",...MN,marginBottom:"0.25rem"}}>{l}</div><div style={{fontSize:"0.79rem",color:C.textMid,lineHeight:1.6}}>{v}</div></div>)}
          </Card>
        </div>}

        {tab==="lectures"&&<div style={{animation:"fadeUp 0.4s ease"}}>
          <Card><SH icon="📚" label="Lectures" sub="Sélectionnées pour ce profil précis"/>
            {(s2.lectures||[]).map((l,i)=><div key={i} style={{marginBottom:"0.85rem",padding:"0.85rem",background:C.bg3,borderLeft:`2px solid ${C.goldD}`}}>
              <div style={{display:"flex",gap:"0.52rem",alignItems:"flex-start",marginBottom:"0.28rem"}}><span style={{...MN,fontSize:"0.63rem",color:C.goldD,minWidth:"1.1rem",marginTop:"0.08rem"}}>0{i+1}</span><div><div style={{...SF,fontSize:"0.95rem",color:C.goldL,marginBottom:"0.06rem"}}>{l.titre}</div><div style={{fontSize:"0.68rem",color:C.textDim,...MN}}>{l.auteur}</div></div></div>
              <div style={{fontSize:"0.79rem",color:C.textMid,lineHeight:1.6,paddingLeft:"1.6rem"}}>{l.pourquoi}</div>
            </div>)}
          </Card>
        </div>}

        {tab==="coach"&&<div style={{animation:"fadeUp 0.4s ease"}}>
          <CoachChat plan={plan} plan2={plan2} weeks={weeks} dailyLogs={logs}/>
          <div style={{padding:"0.7rem",background:C.bg2,border:`1px solid ${C.border}`,fontSize:"0.7rem",color:C.textDim,lineHeight:1.6}}>
            <strong style={{color:C.goldD}}>Exemples :</strong> "J'ai raté 2 jours" · "Mon saboteur s'est déclenché" · "Comment faire l'action S4 ?" · "J'ai envie d'abandonner"
          </div>
        </div>}

        {tab==="engagement"&&<EngagementTab plan={plan} plan2={plan2} firstName={firstName}/>}

        <div style={{textAlign:"center",padding:"2rem 0 0",color:C.textDim,fontSize:"0.66rem",borderTop:`1px solid ${C.border}`,marginTop:"2rem"}}>
          <div style={{color:C.gold,opacity:0.32,letterSpacing:"0.4rem",marginBottom:"0.65rem"}}>✦ ◈ ✦</div>
          Créé par <span style={{color:C.gold}}>Lamine Diabaté</span> · Mon Plan de Vie 90 Jours<br/>
          <span style={{color:C.goldD,fontSize:"0.61rem",...MN}}>Auteur · "90 Jours pour Renaître" · "Le Pouvoir d'un Esprit Aligné"</span>
        </div>
      </div>
    );
  }

  // ── PLAN-SELECT ──
  if(screen==="plan-select"){
    const allD=loadAllDomains();
    const domains=Object.keys(allD);
    return(
      <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Jost',sans-serif",maxWidth:"660px",margin:"0 auto",padding:"1.1rem 0.9rem 4rem",animation:"fadeUp 0.4s ease"}}>
        <link rel="stylesheet" href={FONT}/><style>{CSS}</style>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"2rem",paddingBottom:"0.85rem",borderBottom:`1px solid ${C.border}`}}>
          <div style={{...SF,fontSize:"1rem",color:C.gold}}>Mes Plans</div>
          <button onClick={()=>setScreen(plan?"home":"landing")} style={{padding:"0.38rem 0.65rem",background:"transparent",border:`1px solid ${C.border}`,color:C.textDim,fontSize:"0.6rem",...MN,cursor:"pointer"}}>← Retour</button>
        </div>

        {domains.length===0&&(
          <div style={{textAlign:"center",padding:"3rem 1rem",color:C.textDim,fontSize:"0.8rem"}}>
            <div style={{fontSize:"2rem",marginBottom:"1rem"}}>✦</div>
            <p>Aucun plan créé pour l'instant.</p>
            <button onClick={startNewPlan} style={{...BG,marginTop:"1.5rem"}}>Créer mon premier plan ✦</button>
          </div>
        )}

        <div style={{display:"flex",flexDirection:"column",gap:"0.75rem",marginBottom:"1.5rem"}}>
          {domains.map(d=>{
            const data=allD[d];
            const ng=data?.plan?.nom_guerre||d;
            const isActive=activeDomain===d;
            const startD=data?.startDate?new Date(data.startDate):null;
            const dn=startD?Math.floor((Date.now()-startD.getTime())/(1000*60*60*24))+1:1;
            return(
              <button key={d} onClick={()=>switchDomain(d)} style={{padding:"1rem 1.2rem",background:isActive?`${C.gold}12`:C.bg2,border:`1px solid ${isActive?C.gold:C.border}`,textAlign:"left",cursor:"pointer",transition:"all 0.2s"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.4rem"}}>
                  <div style={{fontSize:"0.56rem",color:isActive?C.gold:C.goldD,textTransform:"uppercase",letterSpacing:"0.15em",...MN}}>{d} {isActive&&"· ACTIF"}</div>
                  <div style={{fontSize:"0.6rem",color:C.textDim,...MN}}>J{Math.min(dn,90)}/90</div>
                </div>
                <div style={{...SF,fontSize:"0.95rem",color:isActive?C.gold:C.text}}>{ng}</div>
                {data?.plan?.scorecard?.mission_centrale&&<div style={{fontSize:"0.72rem",color:C.textMid,marginTop:"0.3rem",lineHeight:1.5}}>{data.plan.scorecard.mission_centrale.slice(0,80)}…</div>}
              </button>
            );
          })}
        </div>

        {domains.length<3&&(
          <button onClick={startNewPlan} style={{width:"100%",padding:"0.9rem",background:"transparent",border:`1px dashed ${C.goldD}`,color:C.goldD,fontSize:"0.7rem",letterSpacing:"0.12em",textTransform:"uppercase",...MN,cursor:"pointer"}}>
            + Créer un nouveau plan ({domains.length}/3)
          </button>
        )}
      </div>
    );
  }

  return null;
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
