// Capturados na importação, antes de qualquer vi.useFakeTimers(): a espera usa SEMPRE o relógio real.
const realSetTimeout = globalThis.setTimeout;
export const realSleep = (ms: number) => new Promise<void>((r) => realSetTimeout(r, ms));

/**
 * Espera uma condição (que lança ou devolve false enquanto não vale) sem mexer no relógio falso e sem prazo apertado:
 * vi.waitFor tem 1 s por padrão e, com timers falsos, ainda avança o relógio a cada tentativa. O prazo aqui só existe
 * para o teste não travar para sempre (a falha real aparece como a última asserção que não passou).
 */
export async function until(check: () => unknown | Promise<unknown>, timeoutMs = 60_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    try {
      if ((await check()) !== false) return;
    } catch (err) {
      if (performance.now() >= deadline) throw err;
    }
    if (performance.now() >= deadline) throw new Error(`until: condição não satisfeita em ${timeoutMs} ms`);
    await realSleep(2);
  }
}

/**
 * Espera o disco e as promessas pendentes assentarem: `busy()` falso e `progress()` sem mudar por `rounds` leituras seguidas.
 * Substitui o "dorme X ms de verdade" depois de avançar o relógio falso.
 */
export async function quiesce(busy: () => boolean, progress: () => unknown = () => 0, rounds = 8): Promise<void> {
  let stable = 0;
  let last = progress();
  while (stable < rounds) {
    await realSleep(2);
    const now = progress();
    stable = !busy() && now === last ? stable + 1 : 0;
    last = now;
  }
}
