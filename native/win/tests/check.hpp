// Mini framework de testes (sem dependências), para rodar igual no macOS (clang) e no Windows (MSVC).
#pragma once

#include <cstdio>
#include <functional>
#include <string>
#include <vector>

namespace check {

struct Case { std::string name; std::function<void()> fn; };
inline std::vector<Case>& cases() { static std::vector<Case> c; return c; }
inline int& failures() { static int f = 0; return f; }
struct Register { Register(const char* n, std::function<void()> f) { cases().push_back({n, std::move(f)}); } };

}  // namespace check

#define TEST(name) \
  static void test_##name(); \
  static check::Register reg_##name(#name, test_##name); \
  static void test_##name()

#define CHECK(cond) \
  do { if (!(cond)) { std::fprintf(stderr, "  FALHOU %s:%d: %s\n", __FILE__, __LINE__, #cond); check::failures()++; } } while (0)

#define CHECK_EQ(a, b) \
  do { auto _a = (a); auto _b = (b); if (!(_a == _b)) { std::fprintf(stderr, "  FALHOU %s:%d: %s == %s\n", __FILE__, __LINE__, #a, #b); check::failures()++; } } while (0)
