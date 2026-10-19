#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "../src/core.hpp"

using namespace rice::translate;

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::fprintf(stderr, "FALHOU %s:%d: %s\n", __FILE__, __LINE__, #cond); failures++; } } while (0)

int main() {
  // Divisão em frases
  auto a = splitSentences("Bom dia a todos. Vamos começar a reunião de hoje? Sim!");
  CHECK(a.size() == 2);                       // "Sim!" é curta: gruda na anterior
  CHECK(a[0] == "Bom dia a todos.");
  CHECK(a[1] == "Vamos começar a reunião de hoje? Sim!");
  CHECK(splitSentences("sem pontuação final").size() == 1);
  CHECK(splitSentences("").empty());
  CHECK(splitSentences("   ").empty());
  CHECK(splitSentences("Versão 3.5 está pronta.").size() == 1);  // ponto sem espaço depois não corta
  auto b = splitSentences("Ok. Entendi tudo o que você falou ontem.");
  CHECK(b.size() == 1);                       // "Ok." curta gruda na seguinte

  // Cache LRU
  int loads = 0;
  ModelCache cache([&](const std::string& d) { loads++; return makeSimulatedModel(d); }, 2);
  cache.get("a"); cache.get("b"); cache.get("a");
  CHECK(loads == 2 && cache.size() == 2);
  cache.get("c");                             // expulsa "b" (o menos recente)
  CHECK(cache.size() == 2 && loads == 3);
  cache.get("a");
  CHECK(loads == 3);                          // "a" continuou carregado
  cache.get("b");
  CHECK(loads == 4);
  cache.unload("a");
  CHECK(cache.size() == 1);
  cache.unload("");
  CHECK(cache.size() == 0);

  // Modelo simulado
  auto m = makeSimulatedModel("x");
  auto r = m->translate({"oi", "tchau"}, ">>pt<<");
  CHECK(r.size() == 2 && r[0] == ">>pt<<OI" && r[1] == ">>pt<<TCHAU");

  if (failures == 0) std::puts("ok");
  return failures == 0 ? 0 : 1;
}
