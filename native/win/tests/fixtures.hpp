#pragma once

#include <fstream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <vector>

extern std::string fixturesDir;

inline std::vector<uint8_t> readFixture(const std::string& name) {
  std::ifstream in(fixturesDir + "/" + name, std::ios::binary);
  if (!in) throw std::runtime_error("fixture ausente: " + fixturesDir + "/" + name);
  return std::vector<uint8_t>(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}
inline std::string readFixtureText(const std::string& name) {
  auto b = readFixture(name);
  return std::string(b.begin(), b.end());
}
