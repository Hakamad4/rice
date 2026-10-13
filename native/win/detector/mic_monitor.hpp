// "Quem está usando o microfone agora": no Windows, o registro (consent store); fora dele, vazio.
#pragma once

#include <string>
#include <vector>

namespace rice {

/// Identificadores (nome do .exe ou nome de família do pacote) dos apps com o mic em uso.
std::vector<std::string> identifiersUsingMic();

/// Decodifica o nome de uma subchave de NonPackaged ("C:#Users#a#Zoom.exe") para o nome do executável ("Zoom.exe").
std::string executableFromConsentKey(const std::string& keyName);

}  // namespace rice
