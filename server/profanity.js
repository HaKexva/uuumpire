/* Profanity filter for leaderboard names.

   English is handled by `obscenity` (MIT, zero runtime deps): it matches slurs and swears through
   leetspeak, spacing, stretched letters and other obfuscation far better than a hand-rolled list, and
   it whitelists the usual innocents (so "Scunthorpe" is fine). But it is English-only, so the manual
   lists below carry the rest: CJK (zh-Hant / zh-Hans + a little Japanese — the players are mostly
   TW/JP), matched literally as substrings, plus EXTRA for any term we want to block that obscenity's
   dataset misses. Add to CJK / EXTRA as moderation turns up new names. */
import {
  RegExpMatcher, DataSet, englishDataset, englishRecommendedTransformers,
  skipNonAlphabeticTransformer,
} from 'obscenity';

// obscenity's recommended transformers resolve leetspeak, confusables, case and duplicate letters.
// We add skipNonAlphabeticTransformer (after leet, so digits still resolve) so "f.u.c.k" / "f u c k"
// are caught too, and whitelist a couple of innocents its collapse-duplicates step trips on.
const dataset = new DataSet()
  .addAll(englishDataset)
  .addPhrase((p) => p.addWhitelistedTerm('shiitake').addWhitelistedTerm('shitake'));

const english = new RegExpMatcher({
  ...dataset.build(),
  blacklistMatcherTransformers: [
    ...englishRecommendedTransformers.blacklistMatcherTransformers,
    skipNonAlphabeticTransformer(),
  ],
  whitelistMatcherTransformers: englishRecommendedTransformers.whitelistMatcherTransformers,
});

const CJK = [
  // zh-Hant / zh-Hans
  '騷逼', '骚逼', '傻逼', '傻屄', '屄', '屌', '雞巴', '鸡巴', '雞掰', '機掰', '鸡掰',
  '幹你', '幹妳', '幹您', '干你', '干妳', '幹你娘', '干你娘', '操你媽', '操你妈',
  '肏', '婊子', '賤人', '贱人', '賤貨', '贱货', '妓女', '淫蕩', '淫荡', '龜公', '龟公', '垃圾',
  // ja
  'まんこ', 'ちんこ', 'ちんちん',
];

// extra Latin-script terms to block on top of obscenity's dataset (lowercased substring match after a
// light leet fold). Keep these unambiguous; obscenity already covers the common English profanity.
const EXTRA = [];
function fold(s) {
  return s.toLowerCase()
    .replace(/[4@]/g, 'a').replace(/3/g, 'e').replace(/[1!]/g, 'i').replace(/0/g, 'o')
    .replace(/[5$]/g, 's').replace(/7/g, 't');
}

export function isProfane(name) {
  const raw = String(name || '');
  if (english.hasMatch(raw)) return true;
  for (const w of CJK) if (raw.includes(w)) return true;
  if (EXTRA.length) {
    const f = fold(raw);
    for (const w of EXTRA) if (f.includes(w)) return true;
  }
  return false;
}
