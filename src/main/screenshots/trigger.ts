/**
 * Pré-filtro LOCAL e barato (pt/en) de cada fala finalizada: só decide quando vale perguntar à IA se é hora de tirar um print.
 * Palavras fortes (slide, planilha, gráfico…) bastam; palavras fracas (tela, erro, código…) precisam de um "esse/aqui/this/my"
 * junto, ou de um verbo de mostrar. Errar para mais custa só uma pergunta curta (há cooldown); errar para menos, o botão manual cobre.
 */
const strip = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const STRONG = [
  // pt
  /\bslides?\b/, /\bplanilhas?\b/, /\bgraficos?\b/, /\bdashboards?\b/, /\bpaine(l|is)\b/, /\bdiagramas?\b/, /\btabelas?\b/, /\bapresentacao\b/, /\bmockups?\b/, /\bprototipos?\b/, /\bfigma\b/, /\bprints?\b/,
  /\bcompartilh(ar|ando|ei|o|ou|e)\b.*\b(tela|janela|apresentacao|documento|arquivo)\b/, /\b(minha|nossa|a) tela\b.*\bcompartilh/, /\bcompartilhando\b/,
  /\b(vou|vamos|deixa eu|deixe eu|posso|quero) (te |lhes |les |vos )?(mostrar|apresentar|abrir|compartilhar|projetar)\b/, /\bmostrando\b/,
  /\b(olha|olhem|olhe|veja|vejam|repara|reparem|reparam) (so )?(esse|essa|isso|isto|este|esta|aqui|o|a|os|as|aquele|aquela)\b/, /\bta vendo\b/, /\best(a|ao) (voce|voces) vendo\b/, /\b(consegue|conseguem|da pra) ver\b/, /\baqui o(h)?\b/, /\bnesse (ponto|trecho|slide|grafico|documento|codigo|erro)\b/,
  // en
  /\bslides?\b/, /\bspreadsheets?\b/, /\bcharts?\b/, /\bgraphs?\b/, /\bdashboards?\b/, /\bdiagrams?\b/, /\bscreenshots?\b/, /\bmockups?\b/, /\bwireframes?\b/, /\bdemo\b/,
  /\b(share|sharing|shared|present|presenting) (my|the|our|your|this)?\s*(screen|window|deck|slides?)\b/, /\bscreen ?shar(e|ing)\b/,
  /\b(let me|lemme|i'?ll|i will|i'?m going to|going to|gonna|let'?s|can i) (just )?(show|share|pull up|bring up|open|present|walk you through)\b/,
  /\b(look at|check out|take a look|have a look|see) (this|that|these|those|the|my|here)\b/, /\bas you can see\b/, /\b(can|do) you (all )?(see|guys see)\b/, /\bhere'?s (the|a|my|our|an)\b/, /\bhere is (the|a|my|our|an)\b/,
];

const WEAK = /\b(esse|essa|este|esta|isso|neste|nesse|nessa|aqui|minha|nossa|a|o|this|that|here|my|the|our|an?)\s+(tela|erro|codigo|log|pagina|site|documento|arquivo|screen|error|code|page|website|document|file|app|window)\b/;

/** true = vale perguntar à IA. */
export function looksLikeShowing(text: string): boolean {
  const t = strip(text).replace(/\s+/g, ' ');
  if (t.length < 6) return false;
  return STRONG.some((re) => re.test(t)) || (/(tela|erro|codigo|screen|error|code|page|document|file|window)/.test(t) && WEAK.test(t) && /\b(esse|essa|este|esta|isso|aqui|minha|nossa|this|that|here|my|our|ve(r|ja|jam)|olh|mostr|show|see|look|share|compartilh|abr(e|ir)|open)\b/.test(t));
}
