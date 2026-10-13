#!/usr/bin/env python3
"""Quadros FICTÍCIOS (1920x1080) para testar as capturas de tela sem tocar na tela real.
Uso: screenshots-frames.py <saida-dir>
Ordem alfabética = ordem em que a instância de teste os "captura": slide, o mesmo slide (duplicado), rostos (ruído), planilha, diagrama."""
import sys, os
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
FONT = '/System/Library/Fonts/Helvetica.ttc'
def font(size, bold=False):
    return ImageFont.truetype(FONT, size, index=1 if bold else 0)

W, H = 1920, 1080
BG, INK, MUTED, ACCENT = (250, 250, 248), (36, 36, 34), (130, 130, 124), (74, 111, 214)

def canvas(title, subtitle=None):
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 14], fill=ACCENT)
    d.text((120, 90), title, font=font(84, True), fill=INK)
    if subtitle:
        d.text((124, 200), subtitle, font=font(40), fill=MUTED)
    d.text((120, H - 80), 'Acme · Planejamento do trimestre', font=font(30), fill=MUTED)
    return im, d

# 1) slide com barras
im, d = canvas('Metas do trimestre', 'Receita recorrente por frente (em milhares)')
for i, (label, v) in enumerate([('Onboarding', 420), ('Agenda', 310), ('Pesquisa', 190), ('Piloto Acme', 520)]):
    x = 160 + i * 420
    h = int(v * 1.3)
    d.rectangle([x, 900 - h, x + 280, 900], fill=ACCENT if i != 3 else (46, 158, 91))
    d.text((x, 920), label, font=font(36), fill=INK)
    d.text((x + 70, 900 - h - 56), str(v), font=font(44, True), fill=INK)
im.save(os.path.join(out, '1-metas.png'))
im.save(os.path.join(out, '2-metas-igual.png'))

# 2) rostos de videochamada (ruído)
im = Image.new('RGB', (W, H), (28, 28, 30))
d = ImageDraw.Draw(im)
for i, (ini, col) in enumerate([('A', (96, 120, 200)), ('C', (190, 110, 90)), ('M', (90, 160, 120)), ('R', (170, 140, 80))]):
    x, y = 140 + (i % 2) * 880, 120 + (i // 2) * 440
    d.rounded_rectangle([x, y, x + 800, y + 400], radius=24, fill=(44, 44, 48))
    d.ellipse([x + 300, y + 80, x + 500, y + 280], fill=col)
    d.text((x + 372, y + 130), ini, font=font(90, True), fill=(255, 255, 255))
im.save(os.path.join(out, '3-rostos.png'))

# 3) planilha
im, d = canvas('Custos por frente', 'Planilha de orçamento · versão 3')
rows = [('Frente', 'Responsável', 'Orçado', 'Realizado'), ('Onboarding', 'Ana', '120.000', '98.400'), ('Agenda', 'Carlos', '90.000', '71.250'), ('Pesquisa', 'Marina', '45.000', '12.800'), ('Piloto Acme', 'Carlos', '150.000', '134.900')]
for r, row in enumerate(rows):
    y = 330 + r * 100
    d.rectangle([120, y, W - 120, y + 90], fill=(235, 238, 248) if r == 0 else (255, 255, 255), outline=(215, 215, 210))
    for c, cell in enumerate(row):
        d.text((160 + c * 420, y + 24), cell, font=font(38, r == 0), fill=INK)
im.save(os.path.join(out, '4-planilha.png'))

# 4) diagrama
im, d = canvas('Arquitetura do piloto', 'Fluxo dos dados entre as frentes')
boxes = [('App', 160, 420), ('Agenda', 760, 300), ('Pesquisa', 760, 560), ('Relatório', 1360, 420)]
for label, x, y in boxes:
    d.rounded_rectangle([x, y, x + 400, y + 150], radius=22, fill=(255, 255, 255), outline=ACCENT, width=5)
    d.text((x + 70, y + 50), label, font=font(48, True), fill=INK)
for (x1, y1, x2, y2) in [(560, 495, 760, 375), (560, 495, 760, 635), (1160, 375, 1360, 495), (1160, 635, 1360, 495)]:
    d.line([x1, y1, x2, y2], fill=MUTED, width=6)
im.save(os.path.join(out, '5-arquitetura.png'))
