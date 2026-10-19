#include "core.hpp"

#include <algorithm>
#include <cctype>
#include <stdexcept>

namespace rice::translate {

namespace {
constexpr size_t kMinSentenceBytes = 12;  // "Sim." / "Ok." grudam na frase vizinha

bool isSpace(char c) { return c == ' ' || c == '\n' || c == '\t' || c == '\r'; }
std::string trim(const std::string& s) {
  size_t b = 0, e = s.size();
  while (b < e && isSpace(s[b])) b++;
  while (e > b && isSpace(s[e - 1])) e--;
  return s.substr(b, e - b);
}
}  // namespace

std::vector<std::string> splitSentences(const std::string& text) {
  std::vector<std::string> raw;
  std::string cur;
  for (size_t i = 0; i < text.size(); i++) {
    cur += text[i];
    const char c = text[i];
    const bool end = (c == '.' || c == '!' || c == '?') && (i + 1 == text.size() || isSpace(text[i + 1]));
    if (end) {
      // "3.5", "e.g." seguidos de espaço ainda cortam: aceitável para fala transcrita.
      raw.push_back(trim(cur));
      cur.clear();
    }
  }
  if (!trim(cur).empty()) raw.push_back(trim(cur));
  std::vector<std::string> out;
  for (auto& s : raw) {
    if (s.empty()) continue;
    if (!out.empty() && (out.back().size() < kMinSentenceBytes || s.size() < kMinSentenceBytes)) out.back() += " " + s;
    else out.push_back(std::move(s));
  }
  return out;
}

Model& ModelCache::get(const std::string& dir) {
  for (size_t i = 0; i < entries_.size(); i++) {
    if (entries_[i].dir == dir) {
      std::rotate(entries_.begin() + static_cast<long>(i), entries_.begin() + static_cast<long>(i) + 1, entries_.end());
      return *entries_.back().model;
    }
  }
  auto model = loader_(dir);
  if (!model) throw std::runtime_error("model not loaded: " + dir);
  if (entries_.size() >= capacity_) entries_.erase(entries_.begin());
  entries_.push_back({dir, std::move(model)});
  return *entries_.back().model;
}

void ModelCache::unload(const std::string& dir) {
  if (dir.empty()) {
    entries_.clear();
    return;
  }
  entries_.erase(std::remove_if(entries_.begin(), entries_.end(), [&](const Entry& e) { return e.dir == dir; }), entries_.end());
}

namespace {
class SimulatedModel : public Model {
 public:
  std::vector<std::string> translate(const std::vector<std::string>& sentences, const std::string& prefix) override {
    std::vector<std::string> out;
    for (auto s : sentences) {
      std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
      out.push_back(prefix + s);
    }
    return out;
  }
};
}  // namespace

std::unique_ptr<Model> makeSimulatedModel(const std::string&) { return std::make_unique<SimulatedModel>(); }

}  // namespace rice::translate
