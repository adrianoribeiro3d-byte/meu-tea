// Crachá de identificação: registro da emissão e verificação pelo QR code.
// O QR leva a uma página pública que só confirma se o crachá é válido (nome impresso, código e data):
// nunca mostra condição, CID, laudo, contatos ou qualquer outro dado do cadastro.
const db = require('./db');
const { cifrar, decifrar, token, sha256 } = require('./seguranca');

const PARTICULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);

/** "Luan Assis Alves de Lima" → "Luan A. A. de Lima" (o administrador pode alterar antes de gerar). */
function nomeCurto(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 2) return partes.join(' ');
  const primeiro = partes[0];
  let fim = partes.length - 1;
  const ultimo = [partes[fim]];
  if (fim - 1 > 0 && PARTICULAS.has(partes[fim - 1].toLowerCase())) { ultimo.unshift(partes[fim - 1]); fim -= 1; }
  const meio = partes.slice(1, fim).filter((p) => !PARTICULAS.has(p.toLowerCase())).map((p) => `${p[0].toUpperCase()}.`);
  return [primeiro, ...meio, ...ultimo].join(' ');
}

/** Registra a emissão (substitui crachás anteriores da criança) e devolve o token do QR. */
function registrar(criancaId, nomeImpresso, usuarioId) {
  const bruto = token(16);
  db.transaction(() => {
    db.prepare(`UPDATE crachas SET substituido_em = datetime('now') WHERE crianca_id = ? AND substituido_em IS NULL`).run(criancaId);
    db.prepare('INSERT INTO crachas (crianca_id, token_hash, nome_cifrado, emitido_por) VALUES (?, ?, ?, ?)')
      .run(criancaId, sha256(bruto), cifrar(nomeImpresso), usuarioId);
  })();
  return bruto;
}

/** Situação de um crachá a partir do token do QR: null (não existe), ou { situacao, nome, codigo, emitidoEm }. */
function verificar(bruto) {
  if (!/^[0-9a-f]{32}$/.test(String(bruto || ''))) return null;
  const c = db.prepare(`SELECT k.*, c.codigo, c.ativo, c.anonimizada FROM crachas k JOIN criancas c ON c.id = k.crianca_id
                        WHERE k.token_hash = ?`).get(sha256(bruto));
  if (!c) return null;
  const situacao = !c.ativo || c.anonimizada ? 'cancelado' : c.substituido_em ? 'substituido' : 'valido';
  return { situacao, nome: situacao === 'valido' ? decifrar(c.nome_cifrado) : null, codigo: c.codigo, emitidoEm: c.emitido_em };
}

const ultimaEmissao = (criancaId) => db.prepare(`SELECT emitido_em FROM crachas WHERE crianca_id = ? AND substituido_em IS NULL`).get(criancaId);

module.exports = { nomeCurto, registrar, verificar, ultimaEmissao };
