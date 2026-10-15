/** Fator dos intervalos da IA ao vivo (ideias, war room, capturas por fala): 1 normal, 2 no modo leve. Definido pelo main a partir do perfil da máquina. */
let factor = 1;
export const getLightFactor = (): number => factor;
export const setLightFactor = (n: number): void => {
  factor = n >= 1 ? n : 1;
};
