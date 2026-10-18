/* Profanity filter for leaderboard names. A curated multilingual blocklist (English + zh/zh-Hant,
   with a little Japanese): the players are mostly TW/JP, so CJK matters and most npm filters are
   English-only. Names are <= 12 chars, so we match substrings — a name containing any listed term is
   rejected. CJK terms match literally. Latin terms compile to a regex that matches the word with its
   consonants literal and each vowel standing for a vowel OR a censor symbol/digit, with optional
   separators between letters, so f*ck, sh1t, $hit and f.u.c.k are all caught while consonant runs like
   "Benz" are not. It is a blunt instrument, not a classifier: it will over-block the rare innocent word
   that embeds a slur (e.g. "Scunthorpe" contains "cunt"), which on a 12-char handle field is a fair
   trade. Add terms to either list as moderation turns them up. */

const LATIN = [
  'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'bastard', 'slut', 'whore',
  'dick', 'pussy', 'cock', 'wank', 'twat', 'nigger', 'nigga', 'faggot',
  'retard', 'rape', 'jizz', 'dildo', 'nazi', 'hitler',
];

const CJK = [
  // zh-Hant / zh-Hans
  '騷逼', '骚逼', '傻逼', '傻屄', '屄', '屌', '雞巴', '鸡巴', '雞掰', '機掰', '鸡掰',
  '幹你', '幹妳', '幹您', '干你', '干妳', '幹你娘', '干你娘', '操你媽', '操你妈',
  '肏', '婊子', '賤人', '贱人', '賤貨', '贱货', '妓女', '淫蕩', '淫荡', '龜公', '龟公',
  // ja
  'まんこ', 'ちんこ', 'ちんちん',
];

// a vowel slot accepts its own letter, that letter's leet digits, or a censor symbol (f*ck, sh1t) —
// never a different vowel, so "cant" does not collide with "cunt". Separators sit between letters.
const CENSOR = '*#.\\-_';
const VMAP = { a: 'a4@', e: 'e3', i: 'i1!', o: 'o0', u: 'u' };
const SEP = '[^a-z]*';
// consonant-leet folding so $hit / 5hit / 7wat normalize before matching
function fold(s) {
  return s.toLowerCase().replace(/\$/g, 's').replace(/5/g, 's').replace(/7/g, 't');
}
const LATIN_RE = LATIN.map((w) => {
  const body = w.split('').map((c) => (VMAP[c] ? `[${VMAP[c]}${CENSOR}]` : c)).join(SEP);
  return new RegExp(body);
});

export function isProfane(name) {
  const raw = String(name || '');
  for (const w of CJK) if (raw.includes(w)) return true;
  const f = fold(raw);
  for (const re of LATIN_RE) if (re.test(f)) return true;
  return false;
}
