#!/usr/bin/env python3
"""
Gera os ícones do app (192, 512 e maskable) a partir de um desenho vetorial simples.

    python3 baralho-app/tools/gerar-icones.py

Desenha uma carta branca com um coração vermelho sobre fundo escuro — a mesma
ideia do favicon.svg. Não depende de nenhuma arte externa.
"""
from PIL import Image, ImageDraw
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "web" / "public"

FUNDO = (27, 25, 23, 255)      # #1b1917
CARTA = (255, 255, 255, 255)   # #ffffff
BORDA = (20, 17, 15, 255)      # #14110f
CORACAO = (179, 38, 30, 255)   # #b3261e


def desenhar(tamanho: int, escala_carta: float = 0.74) -> Image.Image:
    """Carta centralizada ocupando `escala_carta` da altura do ícone."""
    img = Image.new("RGBA", (tamanho, tamanho), FUNDO)
    d = ImageDraw.Draw(img)

    altura = tamanho * escala_carta
    largura = altura * 63 / 88          # proporção de carta de pôquer
    cx, cy = tamanho / 2, tamanho / 2
    x0, y0 = cx - largura / 2, cy - altura / 2
    x1, y1 = cx + largura / 2, cy + altura / 2

    raio = max(2, int(largura * 0.09))
    d.rounded_rectangle([x0, y0, x1, y1], radius=raio, fill=CARTA, outline=BORDA, width=max(2, int(largura * 0.035)))

    # coração: dois círculos + um triângulo
    r = largura * 0.19
    hcx, hcy = cx, cy - altura * 0.06
    d.ellipse([hcx - r * 1.35, hcy - r * 0.95, hcx - r * 0.05, hcy + r * 0.35], fill=CORACAO)
    d.ellipse([hcx + r * 0.05, hcy - r * 0.95, hcx + r * 1.35, hcy + r * 0.35], fill=CORACAO)
    d.polygon(
        [
            (hcx - r * 1.32, hcy - r * 0.12),
            (hcx + r * 1.32, hcy - r * 0.12),
            (hcx, hcy + r * 1.55),
        ],
        fill=CORACAO,
    )
    return img


def main() -> None:
    DESTINO.mkdir(parents=True, exist_ok=True)
    saidas = [
        ("icone-192.png", desenhar(192)),
        ("icone-512.png", desenhar(512)),
        # Maskable: a carta fica dentro da zona segura (~80% central).
        ("icone-maskable.png", desenhar(512, escala_carta=0.52)),
    ]
    for nome, imagem in saidas:
        caminho = DESTINO / nome
        imagem.save(caminho, "PNG", optimize=True)
        print(f"{caminho.relative_to(RAIZ)}  {imagem.size[0]}x{imagem.size[1]}  {caminho.stat().st_size} bytes")


if __name__ == "__main__":
    main()
