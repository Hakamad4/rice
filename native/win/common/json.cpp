#include "json.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cctype>
#include <cstdlib>

namespace rice::json {

Value& Value::set(const std::string& key, Value v) {
  type_ = Type::Object;
  for (auto& member : object_) {
    if (member.first == key) {
      member.second = std::move(v);
      return *this;
    }
  }
  object_.emplace_back(key, std::move(v));
  return *this;
}

const Value* Value::get(const std::string& key) const {
  if (type_ != Type::Object) return nullptr;
  for (const auto& member : object_) {
    if (member.first == key) return &member.second;
  }
  return nullptr;
}

std::string Value::getString(const std::string& key, const std::string& fallback) const {
  const Value* v = get(key);
  return v && v->isString() ? v->str() : fallback;
}

std::optional<std::string> Value::getStringOpt(const std::string& key) const {
  const Value* v = get(key);
  if (v && v->isString()) return v->str();
  return std::nullopt;
}

std::string escape(const std::string& text) {
  std::string out;
  out.reserve(text.size() + 2);
  for (unsigned char c : text) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '/': out += "\\/"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof buf, "\\u%04X", c);
          out += buf;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
  return out;
}

static std::string formatDouble(double d) {
  if (!std::isfinite(d)) return "null";
  if (d == std::floor(d) && std::fabs(d) < 1e15) {
    char buf[32];
    std::snprintf(buf, sizeof buf, "%.0f", d);
    return buf;
  }
  char buf[40];
  std::snprintf(buf, sizeof buf, "%.17g", d);
  return buf;
}

std::string Value::dump() const {
  switch (type_) {
    case Type::Null: return "null";
    case Type::Bool: return int_ ? "true" : "false";
    case Type::Int: return std::to_string(int_);
    case Type::Double: return formatDouble(double_);
    case Type::String: return "\"" + escape(string_) + "\"";
    case Type::Array: {
      std::string out = "[";
      for (size_t i = 0; i < array_.size(); i++) {
        if (i) out += ",";
        out += array_[i].dump();
      }
      return out + "]";
    }
    case Type::Object: {
      std::vector<const Member*> sorted;
      for (const auto& m : object_) sorted.push_back(&m);
      std::sort(sorted.begin(), sorted.end(), [](const Member* a, const Member* b) { return a->first < b->first; });
      std::string out = "{";
      for (size_t i = 0; i < sorted.size(); i++) {
        if (i) out += ",";
        out += "\"" + escape(sorted[i]->first) + "\":" + sorted[i]->second.dump();
      }
      return out + "}";
    }
  }
  return "null";
}

namespace {

class Parser {
 public:
  explicit Parser(const std::string& text) : s_(text) {}

  std::optional<Value> document() {
    skip();
    auto v = value(0);
    if (!v) return std::nullopt;
    skip();
    if (pos_ != s_.size()) return std::nullopt;
    return v;
  }

 private:
  const std::string& s_;
  size_t pos_ = 0;

  void skip() {
    while (pos_ < s_.size() && (s_[pos_] == ' ' || s_[pos_] == '\t' || s_[pos_] == '\n' || s_[pos_] == '\r')) pos_++;
  }
  bool eat(char c) {
    if (pos_ < s_.size() && s_[pos_] == c) {
      pos_++;
      return true;
    }
    return false;
  }
  bool literal(const char* word) {
    size_t n = std::char_traits<char>::length(word);
    if (s_.compare(pos_, n, word) != 0) return false;
    pos_ += n;
    return true;
  }

  std::optional<Value> value(int depth) {
    if (depth > 64 || pos_ >= s_.size()) return std::nullopt;
    char c = s_[pos_];
    if (c == '{') return object(depth);
    if (c == '[') return array(depth);
    if (c == '"') {
      auto str = string();
      if (!str) return std::nullopt;
      return Value(std::move(*str));
    }
    if (literal("true")) return Value(true);
    if (literal("false")) return Value(false);
    if (literal("null")) return Value(nullptr);
    return number();
  }

  std::optional<Value> number() {
    size_t start = pos_;
    if (pos_ < s_.size() && s_[pos_] == '-') pos_++;
    bool digits = false, fractional = false;
    while (pos_ < s_.size() && std::isdigit(static_cast<unsigned char>(s_[pos_]))) { pos_++; digits = true; }
    if (pos_ < s_.size() && s_[pos_] == '.') {
      fractional = true;
      pos_++;
      while (pos_ < s_.size() && std::isdigit(static_cast<unsigned char>(s_[pos_]))) pos_++;
    }
    if (pos_ < s_.size() && (s_[pos_] == 'e' || s_[pos_] == 'E')) {
      fractional = true;
      pos_++;
      if (pos_ < s_.size() && (s_[pos_] == '+' || s_[pos_] == '-')) pos_++;
      while (pos_ < s_.size() && std::isdigit(static_cast<unsigned char>(s_[pos_]))) pos_++;
    }
    if (!digits) return std::nullopt;
    std::string text = s_.substr(start, pos_ - start);
    if (!fractional) {
      char* end = nullptr;
      long long v = std::strtoll(text.c_str(), &end, 10);
      if (end && *end == '\0') return Value(v);
    }
    return Value(std::strtod(text.c_str(), nullptr));
  }

  static void appendUtf8(std::string& out, uint32_t cp) {
    if (cp < 0x80) {
      out += static_cast<char>(cp);
    } else if (cp < 0x800) {
      out += static_cast<char>(0xC0 | (cp >> 6));
      out += static_cast<char>(0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
      out += static_cast<char>(0xE0 | (cp >> 12));
      out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
      out += static_cast<char>(0x80 | (cp & 0x3F));
    } else {
      out += static_cast<char>(0xF0 | (cp >> 18));
      out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
      out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
      out += static_cast<char>(0x80 | (cp & 0x3F));
    }
  }

  std::optional<uint32_t> hex4() {
    if (pos_ + 4 > s_.size()) return std::nullopt;
    uint32_t v = 0;
    for (int i = 0; i < 4; i++) {
      char c = s_[pos_++];
      v <<= 4;
      if (c >= '0' && c <= '9') v |= static_cast<uint32_t>(c - '0');
      else if (c >= 'a' && c <= 'f') v |= static_cast<uint32_t>(c - 'a' + 10);
      else if (c >= 'A' && c <= 'F') v |= static_cast<uint32_t>(c - 'A' + 10);
      else return std::nullopt;
    }
    return v;
  }

  std::optional<std::string> string() {
    if (!eat('"')) return std::nullopt;
    std::string out;
    while (pos_ < s_.size()) {
      unsigned char c = static_cast<unsigned char>(s_[pos_++]);
      if (c == '"') return out;
      if (c < 0x20) return std::nullopt;
      if (c != '\\') {
        out += static_cast<char>(c);
        continue;
      }
      if (pos_ >= s_.size()) return std::nullopt;
      char e = s_[pos_++];
      switch (e) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u': {
          auto hi = hex4();
          if (!hi) return std::nullopt;
          uint32_t cp = *hi;
          if (cp >= 0xD800 && cp < 0xDC00) {
            if (!(pos_ + 1 < s_.size() && s_[pos_] == '\\' && s_[pos_ + 1] == 'u')) return std::nullopt;
            pos_ += 2;
            auto lo = hex4();
            if (!lo || *lo < 0xDC00 || *lo > 0xDFFF) return std::nullopt;
            cp = 0x10000 + ((cp - 0xD800) << 10) + (*lo - 0xDC00);
          } else if (cp >= 0xDC00 && cp <= 0xDFFF) {
            return std::nullopt;
          }
          appendUtf8(out, cp);
          break;
        }
        default: return std::nullopt;
      }
    }
    return std::nullopt;
  }

  std::optional<Value> array(int depth) {
    eat('[');
    Value out = Value::array();
    skip();
    if (eat(']')) return out;
    for (;;) {
      skip();
      auto v = value(depth + 1);
      if (!v) return std::nullopt;
      out.push(std::move(*v));
      skip();
      if (eat(',')) continue;
      if (eat(']')) return out;
      return std::nullopt;
    }
  }

  std::optional<Value> object(int depth) {
    eat('{');
    Value out = Value::object();
    skip();
    if (eat('}')) return out;
    for (;;) {
      skip();
      auto key = string();
      if (!key) return std::nullopt;
      skip();
      if (!eat(':')) return std::nullopt;
      skip();
      auto v = value(depth + 1);
      if (!v) return std::nullopt;
      out.set(*key, std::move(*v));
      skip();
      if (eat(',')) continue;
      if (eat('}')) return out;
      return std::nullopt;
    }
  }
};

}  // namespace

std::optional<Value> parse(const std::string& text) { return Parser(text).document(); }

std::optional<Command> parseCommand(const std::string& line) {
  auto value = parse(line);
  if (!value || !value->isObject()) return std::nullopt;
  const Value* cmd = value->get("cmd");
  if (!cmd || !cmd->isString()) return std::nullopt;
  Command out;
  out.name = cmd->str();
  out.body = std::move(*value);
  return out;
}

}  // namespace rice::json
