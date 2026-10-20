// Núcleo portável do rice-translate: protocolo, divisão em frases e cache de modelos. O motor (CTranslate2) fica atrás de `Backend`,
// para que os testes e o modo --simulate rodem sem modelo.
#pragma once

#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace rice::translate {

/// Quebra o texto em frases (., !, ?, … seguidos de espaço). Trechos curtos grudam na frase vizinha; frases longas ficam inteiras
/// (o modelo aguenta até ~500 tokens, mas rende melhor por frase). Nunca devolve vazio para texto não vazio.
std::vector<std::string> splitSentences(const std::string& text);

struct Request {
  std::string model;   // pasta do modelo (model.bin + source.spm + target.spm)
  std::string prefix;  // token de idioma alvo, ex. ">>pt<<" (vazio = modelo bilíngue)
  std::string text;
};

/// Um modelo carregado. A destruição libera a RAM por completo.
class Model {
 public:
  virtual ~Model() = default;
  virtual std::vector<std::string> translate(const std::vector<std::string>& sentences, const std::string& prefix) = 0;
};

using ModelLoader = std::function<std::unique_ptr<Model>(const std::string& dir)>;

/// Cache LRU de modelos carregados (a tradução com pivô usa 2 modelos por trecho).
class ModelCache {
 public:
  ModelCache(ModelLoader loader, size_t capacity) : loader_(std::move(loader)), capacity_(capacity) {}
  Model& get(const std::string& dir);
  void unload(const std::string& dir);  // vazio = todos
  size_t size() const { return entries_.size(); }

 private:
  struct Entry {
    std::string dir;
    std::unique_ptr<Model> model;
  };
  ModelLoader loader_;
  size_t capacity_;
  std::vector<Entry> entries_;  // do mais recente (fim) ao mais antigo (início)
};

/// Modelo de mentira para --simulate e testes: devolve "<prefix>texto" em maiúsculas por frase.
std::unique_ptr<Model> makeSimulatedModel(const std::string& dir);

}  // namespace rice::translate
