// Casa o identificador de um processo que usa o microfone com o nome do app de reunião.
// macOS: bundle id exato ou prefixo `id + "."`. Windows: nome do .exe ou nome de família do pacote.
// Os dois conjuntos convivem na mesma tabela (os identificadores não colidem), então o mesmo código
// roda e é testado em qualquer sistema.
#pragma once

#include <optional>
#include <string>

namespace rice {

std::optional<std::string> matchApp(const std::string& identifier);

}  // namespace rice
