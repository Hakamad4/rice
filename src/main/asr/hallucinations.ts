const WHOLE_LINE: RegExp[] = [
  /^[\s.,!?…\-–—]*$/,
  /^\s*(?:\[[^\]]*\]|\([^)]*\))\s*$/,
  /amara\.org/i,
  /^legendas? (pela|por) comunidade\b.*$/i,
  /^obrigad[oa]s? por (assistir|ter assistido)[.!]*$/i,
  /^inscreva-se( no canal)?[.!]*$/i,
  /^(tchau[,.!\s]*)+$/i,
  // alucinações comuns do whisper em inglês, em silêncio ou ruído
  /^thanks? (you )?for watching[.!]*$/i,
  /^(please )?(like and )?subscribe( to (my|the) channel)?[.!]*$/i,
  /^(you[.!\s]*)+$/i,
  /^subtitles? by\b.*$/i,
];

export function cleanTranscript(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (WHOLE_LINE.some((pattern) => pattern.test(normalized))) return null;
  return normalized;
}
