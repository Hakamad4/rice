# Avisos de terceiros / Third-party notices

O Rice é MIT (veja `LICENSE`). A tradução offline é opcional e usa os componentes abaixo; nada disso vem no instalador além do
`rice-translate` (CTranslate2 + sentencepiece). Os modelos são baixados por idioma, a pedido do usuário.

Rice is MIT (see `LICENSE`). Offline translation is optional and uses the components below; only `rice-translate`
(CTranslate2 + sentencepiece) ships in the installer. Models are downloaded per language, on the user's request.

## Modelos de tradução / Translation models — CC-BY-4.0

Modelos **OPUS-MT**, de Jörg Tiedemann e do grupo **Helsinki-NLP** (Universidade de Helsinque), treinados com os corpora abertos do
projeto OPUS. Licença: **Creative Commons Atribuição 4.0 (CC-BY-4.0)**, https://creativecommons.org/licenses/by/4.0/.

**OPUS-MT** models by Jörg Tiedemann and the **Helsinki-NLP** group (University of Helsinki), trained on the open corpora of the OPUS
project. License: **Creative Commons Attribution 4.0 (CC-BY-4.0)**.

**Alterações / Changes:** os pesos foram convertidos para o formato do CTranslate2 com quantização int8
(`ct2-transformers-converter --quantization int8`); nada mais foi alterado. / The weights were converted to the CTranslate2 format
with int8 quantization; nothing else was changed.

| Modelo / Model | Origem / Source |
| --- | --- |
| `opus-mt-tc-big-en-pt`, `opus-mt-tc-big-en-es`, `opus-mt-tc-big-en-fr`, `opus-mt-tc-big-en-it`, `opus-mt-tc-big-fr-en`, `opus-mt-tc-big-it-en` | https://huggingface.co/Helsinki-NLP |
| `opus-mt-es-en`, `opus-mt-de-en`, `opus-mt-en-de` | https://huggingface.co/Helsinki-NLP |
| `argos-pt-en` | pacote `translate-pt_en` 1.9 do Argos Open Tech (https://github.com/argosopentech/argos-translate), derivado do OPUS-MT, CC-BY-4.0 / `translate-pt_en` 1.9 package from Argos Open Tech, derived from OPUS-MT, CC-BY-4.0 |

Referência / Reference: Jörg Tiedemann and Santhosh Thottingal. *OPUS-MT — Building open translation services for the World.*
Proceedings of the 22nd Annual Conference of the European Association for Machine Translation (EAMT), Lisbon, 2020.

## Motor / Engine

| Componente / Component | Licença / License |
| --- | --- |
| [CTranslate2](https://github.com/OpenNMT/CTranslate2) 4.8.3 (OpenNMT) | MIT |
| [SentencePiece](https://github.com/google/sentencepiece) 0.2.1 (Google) | Apache-2.0 |
| [ruy](https://github.com/google/ruy) (Google, multiplicação de matrizes int8 / int8 matrix multiplication) | Apache-2.0 |
| [spdlog](https://github.com/gabime/spdlog), [cpu_features](https://github.com/google/cpu_features), [cpuinfo](https://github.com/pytorch/cpuinfo) | MIT, Apache-2.0, BSD-2-Clause |
| Accelerate (macOS) | parte do sistema / part of the OS |
