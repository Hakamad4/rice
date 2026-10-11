#include "events.hpp"

#include <cstdio>

namespace rice {

namespace {
void writeLine(FILE* stream, const std::string& line) {
  std::fwrite(line.data(), 1, line.size(), stream);
  std::fputc('\n', stream);
  std::fflush(stream);
}
}  // namespace

LineEmitter makeStderrEmitter() {
  return LineEmitter([](const std::string& line) { writeLine(stderr, line); });
}

LineEmitter makeStdoutEmitter() {
  return LineEmitter([](const std::string& line) { writeLine(stdout, line); });
}

}  // namespace rice
