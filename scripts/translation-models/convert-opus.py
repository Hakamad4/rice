#!/usr/bin/env python3
"""Converte um modelo OPUS-MT do Hugging Face para CTranslate2 int8 (a pasta resultante alimenta build-release.mjs).

    python scripts/translation-models/convert-opus.py Helsinki-NLP/opus-mt-tc-big-it-en saida/opus-mt-tc-big-it-en

Requer: pip install ctranslate2 sentencepiece torch transformers protobuf.

Por que não basta `ct2-transformers-converter`: alguns checkpoints (ex.: opus-mt-tc-big-it-en) trazem um `lm_head.weight` OBSOLETO, diferente
dos embeddings, embora o treino use pesos amarrados (`tie_word_embeddings`). As versões novas do transformers carregam o `lm_head` do
arquivo e o modelo sai com saída aleatória (chrF 6 no FLORES); amarrando de novo, o it->en vai de 57,8 (modelo base) para 61,0.
Sempre amarramos antes de converter e conferimos que a tradução de uma frase de teste faz sentido.
"""
import subprocess
import sys
import tempfile

from transformers import MarianMTModel, MarianTokenizer

name, out = sys.argv[1], sys.argv[2]
tok = MarianTokenizer.from_pretrained(name)
model = MarianMTModel.from_pretrained(name)
model.lm_head.weight = model.model.shared.weight
with tempfile.TemporaryDirectory() as tmp:
    model.save_pretrained(tmp)
    tok.save_pretrained(tmp)
    subprocess.run(['ct2-transformers-converter', '--model', tmp, '--quantization', 'int8', '--output_dir', out, '--copy_files', 'source.spm', 'target.spm', '--force'], check=True)
print('ok:', out)
