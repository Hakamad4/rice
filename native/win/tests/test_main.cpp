#include <cstdlib>
#include <exception>

#include "check.hpp"

// Pasta dos fixtures gravados do Swift: RICE_FIXTURES ou o 1º argumento.
std::string fixturesDir;

int main(int argc, char** argv) {
  const char* env = std::getenv("RICE_FIXTURES");
  fixturesDir = argc > 1 ? argv[1] : (env ? env : "");
  int before = 0;
  for (auto& c : check::cases()) {
    std::fprintf(stderr, "- %s\n", c.name.c_str());
    try {
      c.fn();
    } catch (const std::exception& e) {
      std::fprintf(stderr, "  EXCEÇÃO: %s\n", e.what());
      check::failures()++;
    }
    if (check::failures() != before) before = check::failures();
  }
  std::fprintf(stderr, "%zu testes, %d falhas\n", check::cases().size(), check::failures());
  return check::failures() == 0 ? 0 : 1;
}
