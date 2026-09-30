#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "O Node.js não está instalado. Instale a versão LTS em https://nodejs.org/pt e abra este arquivo de novo."
  open "https://nodejs.org/pt"
  read -r -p "Pressione Enter para fechar..."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Instalando o Meu TEA pela primeira vez. Isso leva alguns minutos..."
  npm install || { read -r -p "Falha na instalação. Pressione Enter para fechar..."; exit 1; }
fi
export MEUTEA_DEMO=1
echo "Meu TEA iniciando... o navegador vai abrir em instantes. Para ENCERRAR, feche esta janela."
(sleep 4; open "http://localhost:3000") &
npm start
