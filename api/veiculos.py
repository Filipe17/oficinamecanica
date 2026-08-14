"""
veiculos.py — CRUD de veículos, vinculados a um cliente.
Mesma estrutura em camadas dos demais módulos.
"""

from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio

veiculos_bp = Blueprint("veiculos", __name__)


@veiculos_bp.route("/api/veiculos", methods=["GET"])
@login_obrigatorio
def listar():
    q = request.args.get("q", "").strip().upper()
    pagina = max(int(request.args.get("pagina", 1)), 1)
    por_pagina = min(int(request.args.get("por_pagina", 20)), 100)

    # JOIN para trazer o nome do cliente junto (evita chamadas extras no front)
    base = ("SELECT v.*, c.nome AS cliente_nome FROM veiculos v "
            "LEFT JOIN clientes c ON c.id = v.cliente_id")
    where, params = "", []
    if q:
        where = "WHERE UPPER(v.placa) LIKE ? OR UPPER(v.modelo) LIKE ? OR UPPER(v.marca) LIKE ? OR UPPER(c.nome) LIKE ?"
        termo = f"%{q}%"
        params = [termo, termo, termo, termo]

    total = query(f"SELECT COUNT(*) AS n FROM veiculos v "
                  f"LEFT JOIN clientes c ON c.id=v.cliente_id {where}",
                  params, fetchone=True)["n"]
    offset = (pagina - 1) * por_pagina
    lista = query(f"{base} {where} ORDER BY v.id DESC LIMIT ? OFFSET ?",
                  params + [por_pagina, offset])
    return jsonify({
        "dados": lista, "total": total, "pagina": pagina,
        "por_pagina": por_pagina,
        "paginas": (total + por_pagina - 1) // por_pagina,
    })


@veiculos_bp.route("/api/veiculos/<int:vid>", methods=["GET"])
@login_obrigatorio
def detalhe(vid):
    v = query("SELECT * FROM veiculos WHERE id=?", (vid,), fetchone=True)
    if not v:
        return jsonify({"erro": "Veículo não encontrado"}), 404
    v["manutencoes"] = query(
        "SELECT id, numero, data, status, total FROM ordens_servico "
        "WHERE veiculo_id=? ORDER BY id DESC", (vid,))
    return jsonify(v)


@veiculos_bp.route("/api/veiculos", methods=["POST"])
@login_obrigatorio
def criar():
    d = request.get_json(force=True)
    res = query(
        "INSERT INTO veiculos (cliente_id, marca, modelo, ano, motor, combustivel, "
        "placa, renavam, cor, quilometragem, chassi, criado_em) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (d.get("cliente_id"), d.get("marca"), d.get("modelo"), d.get("ano"),
         d.get("motor"), d.get("combustivel"), d.get("placa"), d.get("renavam"),
         d.get("cor"), d.get("quilometragem", 0), d.get("chassi"), now()),
        commit=True,
    )
    registrar_log(session["user_id"], "criar_veiculo", d.get("placa"))
    return jsonify({"ok": True, "id": res["_lastid"]}), 201


@veiculos_bp.route("/api/veiculos/<int:vid>", methods=["PUT"])
@login_obrigatorio
def editar(vid):
    d = request.get_json(force=True)
    query(
        "UPDATE veiculos SET cliente_id=?, marca=?, modelo=?, ano=?, motor=?, "
        "combustivel=?, placa=?, renavam=?, cor=?, quilometragem=?, chassi=? WHERE id=?",
        (d.get("cliente_id"), d.get("marca"), d.get("modelo"), d.get("ano"),
         d.get("motor"), d.get("combustivel"), d.get("placa"), d.get("renavam"),
         d.get("cor"), d.get("quilometragem", 0), d.get("chassi"), vid),
        commit=True,
    )
    registrar_log(session["user_id"], "editar_veiculo", str(vid))
    return jsonify({"ok": True})


@veiculos_bp.route("/api/veiculos/<int:vid>", methods=["DELETE"])
@login_obrigatorio
def excluir(vid):
    query("DELETE FROM veiculos WHERE id=?", (vid,), commit=True)
    registrar_log(session["user_id"], "excluir_veiculo", str(vid))
    return jsonify({"ok": True})


@veiculos_bp.route("/api/veiculos/<int:vid>/historico", methods=["GET"])
@login_obrigatorio
def historico_veiculo(vid):
    """
    Retorna o histórico completo do veículo:
    - Todas as OS (abertas e finalizadas)
    - Peças trocadas por OS
    - Serviços realizados por OS
    - Quilometragem registrada em cada OS
    - Evolução de quilometragem
    """
    veiculo = query("SELECT * FROM veiculos WHERE id=?", (vid,), fetchone=True)
    if not veiculo:
        return jsonify({"erro": "Veículo não encontrado"}), 404

    # Todas as OS do veículo ordenadas por data
    # Monta SELECT dinâmico — quilometragem pode não existir em OS antigas
    os_list = query(
        "SELECT o.id, o.numero, o.data, o.status, o.total, o.problema, "
        "o.diagnostico, o.horas_trabalhadas, o.garantia, "
        "o.obs_finais, o.mecanico_id, o.eh_orcamento, "
        "u.nome AS mecanico_nome "
        "FROM ordens_servico o "
        "LEFT JOIN usuarios u ON u.id = o.mecanico_id "
        "WHERE o.veiculo_id=? AND o.eh_orcamento=0 "
        "ORDER BY o.data DESC, o.id DESC",
        (vid,))
    # Adiciona quilometragem=None para compatibilidade
    for os in os_list:
        if "quilometragem" not in os:
            os["quilometragem"] = None

    # Para cada OS, carrega os itens (peças e serviços)
    for os in os_list:
        itens = query(
            "SELECT tipo, descricao, quantidade, valor_unitario, subtotal, codigo "
            "FROM os_itens WHERE os_id=? ORDER BY tipo, descricao",
            (os["id"],))
        os["pecas"]   = [i for i in itens if i["tipo"] == "produto"]
        os["servicos_realizados"] = [i for i in itens if i["tipo"] == "servico"]

    # Estatísticas gerais
    total_os       = len(os_list)
    total_gasto    = sum(float(o.get("total") or 0) for o in os_list)
    total_pecas    = sum(len(o["pecas"]) for o in os_list)
    total_servicos = sum(len(o["servicos_realizados"]) for o in os_list)

    # Evolução de quilometragem (só OS com km registrado)
    kms = [{"data": o["data"], "km": o["quilometragem"], "os": o["numero"]}
           for o in os_list if o.get("quilometragem")]
    kms.sort(key=lambda x: x["data"] or "")

    return jsonify({
        "veiculo": veiculo,
        "os_list": os_list,
        "stats": {
            "total_os": total_os,
            "total_gasto": round(total_gasto, 2),
            "total_pecas": total_pecas,
            "total_servicos": total_servicos,
            "primeira_os": os_list[-1]["data"] if os_list else None,
            "ultima_os": os_list[0]["data"] if os_list else None,
        },
        "evolucao_km": kms,
    })
