// Modelo OPUS-MT em CTranslate2 (int8, 1 thread): tokeniza com source.spm, traduz e destokeniza com target.spm.
#pragma once

#include <memory>
#include <string>

#include "core.hpp"

namespace rice::translate {

/// Carrega a pasta do modelo. Lança std::runtime_error com mensagem legível se faltar arquivo ou o modelo for inválido.
std::unique_ptr<Model> loadCt2Model(const std::string& dir, size_t threads, size_t beam);
const char* ct2BackendName();

}  // namespace rice::translate
