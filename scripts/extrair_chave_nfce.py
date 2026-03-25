import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

import cv2
import numpy as np
import pytesseract
from pyzbar.pyzbar import decode


CHAVE_RE = re.compile(r"\d{44}")
FRASE_CHAVE_RE = re.compile(r"chave\s+de\s+acesso", re.IGNORECASE)


def apenas_digitos(valor: str) -> str:
    return re.sub(r"\D", "", valor or "")


def validar_dv_chave(chave: str) -> bool:
    chave = apenas_digitos(chave)
    if len(chave) != 44:
        return False
    if chave[20:22] != "65":
        return False

    base = chave[:43]
    pesos = [2, 3, 4, 5, 6, 7, 8, 9]
    soma = 0
    peso_idx = 0

    for digito in reversed(base):
        soma += int(digito) * pesos[peso_idx]
        peso_idx = (peso_idx + 1) % len(pesos)

    resto = soma % 11
    dv = 0 if resto < 2 else 11 - resto
    return dv == int(chave[-1])


def extrair_chaves_candidatas(texto: str) -> List[str]:
    if not texto:
        return []

    candidatas = set(CHAVE_RE.findall(apenas_digitos(texto)))

    linhas = [linha.strip() for linha in texto.splitlines() if linha.strip()]
    for idx, linha in enumerate(linhas):
        linha_limpa = apenas_digitos(linha)
        if len(linha_limpa) == 44:
            candidatas.add(linha_limpa)

        if FRASE_CHAVE_RE.search(linha):
            janela = " ".join(linhas[idx : idx + 4])
            digitos = apenas_digitos(janela)
            for inicio in range(0, max(0, len(digitos) - 43)):
                trecho = digitos[inicio : inicio + 44]
                if len(trecho) == 44:
                    candidatas.add(trecho)

    return sorted(candidatas)


def validar_candidatas(candidatas: List[str]) -> List[str]:
    return [chave for chave in candidatas if validar_dv_chave(chave)]


def carregar_imagem(caminho_imagem: str) -> np.ndarray:
    imagem = cv2.imread(str(caminho_imagem))
    if imagem is None:
        raise FileNotFoundError(f"Imagem nao encontrada ou invalida: {caminho_imagem}")
    return imagem


def ler_qrcode(imagem: np.ndarray) -> Dict[str, object]:
    resultado = {"sucesso": False, "raw": "", "chave": "", "erro": ""}
    try:
        codigos = decode(imagem)
    except Exception as exc:
        resultado["erro"] = f"Falha ao decodificar QR Code: {exc}"
        return resultado

    if not codigos:
        resultado["erro"] = "QR Code nao encontrado."
        return resultado

    for codigo in codigos:
        raw = codigo.data.decode("utf-8", errors="ignore")
        chave = extrair_chave_da_url_qrcode(raw) or extrair_primeira_chave(raw)
        if chave:
            resultado.update({"sucesso": True, "raw": raw, "chave": chave, "erro": ""})
            return resultado

    resultado["erro"] = "QR Code lido, mas sem chave de acesso identificada."
    return resultado


def extrair_chave_da_url_qrcode(raw: str) -> str:
    if not raw:
        return ""

    candidatos = []
    parsed = urlparse(raw)
    query = parse_qs(parsed.query)

    if "p" in query:
        for valor in query["p"]:
            candidatos.extend(CHAVE_RE.findall(valor))

    candidatos.extend(CHAVE_RE.findall(raw))

    for candidato in candidatos:
        if validar_dv_chave(candidato):
            return candidato

    return candidatos[0] if candidatos else ""


def extrair_primeira_chave(texto: str) -> str:
    candidatos = extrair_chaves_candidatas(texto)
    return candidatos[0] if candidatos else ""


def preprocessar_para_ocr(imagem: np.ndarray) -> np.ndarray:
    cinza = cv2.cvtColor(imagem, cv2.COLOR_BGR2GRAY)
    contraste = cv2.convertScaleAbs(cinza, alpha=1.8, beta=0)
    blur = cv2.GaussianBlur(contraste, (3, 3), 0)
    _, binaria = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return binaria


def recortar_regiao_inferior(imagem: np.ndarray) -> np.ndarray:
    altura = imagem.shape[0]
    inicio = int(altura * 0.58)
    return imagem[inicio:, :]


def extrair_texto_ocr(imagem: np.ndarray) -> Dict[str, object]:
    regiao = recortar_regiao_inferior(imagem)
    processada = preprocessar_para_ocr(regiao)

    configs = [
        "--oem 3 --psm 6",
        "--oem 3 --psm 11",
    ]

    textos = []
    for config in configs:
        texto = pytesseract.image_to_string(processada, lang="por", config=config)
        if texto:
            textos.append(texto)

    texto_completo = "\n".join(textos).strip()
    candidatas = extrair_chaves_candidatas(texto_completo)
    validas = validar_candidatas(candidatas)

    return {
        "texto": texto_completo,
        "candidatas": candidatas,
        "validas": validas,
    }


def priorizar_chave_ocr(texto_ocr: str, validas: List[str]) -> Optional[str]:
    if not validas:
        return None

    linhas = [linha.strip() for linha in texto_ocr.splitlines() if linha.strip()]
    for idx, linha in enumerate(linhas):
        if FRASE_CHAVE_RE.search(linha):
            janela = " ".join(linhas[idx : idx + 4])
            for chave in validas:
                if chave in apenas_digitos(janela):
                    return chave

    return validas[0]


def classificar_confianca(fonte: str, chave_confirmada: bool) -> str:
    if fonte == "qrcode" and chave_confirmada:
        return "alta"
    if fonte == "ocr" and chave_confirmada:
        return "media"
    return "baixa"


def extrair_chave_acesso_nfce(caminho_imagem: str) -> Dict[str, object]:
    imagem = carregar_imagem(caminho_imagem)

    qr = ler_qrcode(imagem)
    ocr = extrair_texto_ocr(imagem)

    qr_valida = qr["chave"] if qr["chave"] and validar_dv_chave(qr["chave"]) else ""
    ocr_priorizada = priorizar_chave_ocr(ocr["texto"], ocr["validas"])

    if qr_valida:
        return {
            "chave_acesso": qr_valida,
            "fonte": "qrcode",
            "confianca": classificar_confianca("qrcode", True),
        }

    if ocr_priorizada:
        return {
            "chave_acesso": ocr_priorizada,
            "fonte": "ocr",
            "confianca": classificar_confianca("ocr", True),
        }

    erros = []
    if not qr["sucesso"]:
        erros.append(qr["erro"] or "Nao conseguiu ler QR Code.")
    if not ocr["candidatas"]:
        erros.append("Nao encontrou sequencia de 44 digitos no OCR.")
    elif not ocr["validas"]:
        erros.append("As sequencias encontradas no OCR nao passaram na validacao da chave NFC-e.")

    return {
        "erro": " | ".join(erros) if erros else "Nenhuma chave valida foi encontrada.",
        "detalhes": {
            "qr_code": qr,
            "ocr_candidatas": ocr["candidatas"],
            "ocr_validas": ocr["validas"],
        },
    }


if __name__ == "__main__":
    caminho_exemplo = Path("exemplo_nfce.jpg")
    resultado = extrair_chave_acesso_nfce(str(caminho_exemplo))
    print(resultado)
