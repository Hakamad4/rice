// JSON mínimo, só o que o protocolo dos helpers precisa. Portável (sem Win32).
// Serialização igual à do Foundation com .sortedKeys: chaves em ordem, sem espaços, "/" escapado.
#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace rice::json {

class Value {
 public:
  enum class Type { Null, Bool, Int, Double, String, Array, Object };
  using Array = std::vector<Value>;
  using Member = std::pair<std::string, Value>;
  using Object = std::vector<Member>;

  Value() = default;
  Value(std::nullptr_t) {}
  Value(bool b) : type_(Type::Bool), int_(b ? 1 : 0) {}
  Value(int v) : type_(Type::Int), int_(v) {}
  Value(long v) : type_(Type::Int), int_(v) {}
  Value(long long v) : type_(Type::Int), int_(v) {}
  Value(unsigned v) : type_(Type::Int), int_(v) {}
  Value(unsigned long v) : type_(Type::Int), int_(static_cast<int64_t>(v)) {}
  Value(unsigned long long v) : type_(Type::Int), int_(static_cast<int64_t>(v)) {}
  Value(double v) : type_(Type::Double), double_(v) {}
  Value(const char* s) : type_(Type::String), string_(s) {}
  Value(std::string s) : type_(Type::String), string_(std::move(s)) {}

  static Value array() { Value v; v.type_ = Type::Array; return v; }
  static Value object() { Value v; v.type_ = Type::Object; return v; }

  Type type() const { return type_; }
  bool isNull() const { return type_ == Type::Null; }
  bool isString() const { return type_ == Type::String; }
  bool isArray() const { return type_ == Type::Array; }
  bool isObject() const { return type_ == Type::Object; }
  bool isNumber() const { return type_ == Type::Int || type_ == Type::Double; }

  const std::string& str() const { return string_; }
  bool boolean() const { return int_ != 0; }
  int64_t integer() const { return type_ == Type::Double ? static_cast<int64_t>(double_) : int_; }
  double number() const { return type_ == Type::Double ? double_ : static_cast<double>(int_); }
  const Array& items() const { return array_; }
  const Object& members() const { return object_; }

  /// Acrescenta ao array.
  Value& push(Value v) { array_.push_back(std::move(v)); return *this; }
  /// Define (ou troca) um campo do objeto.
  Value& set(const std::string& key, Value v);
  /// Campo do objeto ou nullptr.
  const Value* get(const std::string& key) const;
  /// Atalhos tolerantes: valor padrão se faltar ou tiver outro tipo.
  std::string getString(const std::string& key, const std::string& fallback = "") const;
  std::optional<std::string> getStringOpt(const std::string& key) const;

  /// JSON compacto, chaves em ordem alfabética.
  std::string dump() const;

 private:
  Type type_ = Type::Null;
  int64_t int_ = 0;
  double double_ = 0;
  std::string string_;
  Array array_;
  Object object_;
};

/// Lê um documento JSON inteiro; nullopt se for inválido (inclusive lixo depois do valor).
std::optional<Value> parse(const std::string& text);

/// Escapa uma string como o Foundation (aspas, barra invertida, "/" e controles).
std::string escape(const std::string& text);

/// Linha de comando do stdin: objeto JSON com `cmd` string. nullopt se a linha for inválida.
struct Command {
  std::string name;
  Value body;
};
std::optional<Command> parseCommand(const std::string& line);

}  // namespace rice::json
