// THE shared predicate compiler (colecciones.md §3). One grammar, one compiler — reused by
// colecciones inteligentes (regla_json), logros/títulos (condicion_json) and Wrapped filters.
// There is NO second grammar.
//
// Two emit modes over the SAME grammar:
//   - compileCollectionRule(rule)  -> set:  SELECT DISTINCT o.id FROM obra o WHERE <per-obra>
//   - compileCondition(cond)       -> bool: SELECT (CASE WHEN <global> THEN 1 ELSE 0 END) ok
//
// Everything is parametrized: values become ? placeholders in `params` (no string
// concatenation of user values). Field names, operators, metric ids and aliases are all
// validated against whitelists — never interpolated raw.

import { metricScalar } from './metrics.js';

const OBRA_COLS = new Set([
  'categoria',
  'subtipo',
  'anio_obra',
  'decada',
  'idioma_original',
  'pais_origen',
  'saga',
  'formato_habitual',
  'titulo'
]);
const ENTRADA_COLS = new Set([
  'estado',
  'clase_tiempo',
  'valoracion',
  'impacto_emocional',
  'num_reconsumo',
  'fecha',
  'duracion_min'
]);
const AGG_FIELDS = new Set([
  'valoracion_media',
  'impacto_medio',
  'num_entradas',
  'tiempo_total_min',
  'primera_fecha',
  'ultima_fecha',
  'num_reconsumos',
  'max_entradas_por_dia'
]);
const CMP = { '=': '=', '!=': '!=', '>': '>', '>=': '>=', '<': '<', '<=': '<=' };

function aggSql(field, o) {
  switch (field) {
    case 'valoracion_media':
      return `(SELECT AVG(ae.valoracion) FROM entrada ae WHERE ae.obra_id = ${o}.id)`;
    case 'impacto_medio':
      return `(SELECT AVG(ae.impacto_emocional) FROM entrada ae WHERE ae.obra_id = ${o}.id)`;
    case 'num_entradas':
      return `(SELECT COUNT(*) FROM entrada ae WHERE ae.obra_id = ${o}.id)`;
    case 'tiempo_total_min':
      return `(SELECT COALESCE(SUM(ae.duracion_min), 0) FROM entrada ae WHERE ae.obra_id = ${o}.id)`;
    case 'primera_fecha':
      return `(SELECT MIN(ae.fecha) FROM entrada ae WHERE ae.obra_id = ${o}.id)`;
    case 'ultima_fecha':
      return `(SELECT MAX(ae.fecha) FROM entrada ae WHERE ae.obra_id = ${o}.id)`;
    case 'num_reconsumos':
      return `(SELECT COUNT(*) FROM entrada ae WHERE ae.obra_id = ${o}.id AND ae.num_reconsumo > 0)`;
    case 'max_entradas_por_dia':
      return `(SELECT COALESCE(MAX(c), 0) FROM (SELECT COUNT(*) c FROM entrada ae WHERE ae.obra_id = ${o}.id AND ae.fecha IS NOT NULL GROUP BY ae.fecha))`;
    default:
      throw new Error(`agg desconocido: ${field}`);
  }
}

// Build a comparison "lhs OP value", pushing value(s) into params. Handles NULL and the
// set/range/text operators. Returns the SQL fragment.
function cmpSql(lhs, op, valor, params, opts) {
  if (typeof valor === 'string' && valor === 'idioma_base') valor = opts.idiomaBase;
  if ((op === '=' || op === '!=') && valor === null) {
    return `${lhs} IS ${op === '=' ? '' : 'NOT '}NULL`;
  }
  if (CMP[op]) {
    params.push(valor);
    return `${lhs} ${CMP[op]} ?`;
  }
  if (op === 'in') {
    const arr = Array.isArray(valor) ? valor : [valor];
    if (!arr.length) return '0';
    arr.forEach((v) => params.push(v));
    return `${lhs} IN (${arr.map(() => '?').join(', ')})`;
  }
  if (op === 'entre') {
    params.push(valor[0], valor[1]);
    return `${lhs} BETWEEN ? AND ?`;
  }
  if (op === 'contiene') {
    params.push(valor);
    return `${lhs} LIKE '%' || ? || '%'`;
  }
  throw new Error(`Operador no soportado para comparación: ${op}`);
}

function compileLeaf(f, ctx, params, opts) {
  const campo = f.campo;
  if (typeof campo !== 'string') throw new Error(`filtro sin campo válido: ${JSON.stringify(f)}`);

  // metrica:MET_* — global scalar (estadisticas.md). Optional param (M6 group-by).
  if (campo.startsWith('metrica:')) {
    const m = metricScalar(campo.slice('metrica:'.length), f.param);
    m.params.forEach((p) => params.push(p)); // metric params appear before the compare value
    return cmpSql(m.sql, f.op, f.valor, params, opts);
  }

  // etiqueta (op tiene/no_tiene). valor = slug, trailing '*' => prefix LIKE.
  if (campo === 'etiqueta') {
    const o = requireObra(ctx);
    const neg = f.op === 'no_tiene';
    if (f.op !== 'tiene' && f.op !== 'no_tiene') throw new Error(`etiqueta usa tiene/no_tiene, no ${f.op}`);
    let match;
    if (typeof f.valor === 'string' && f.valor.endsWith('*')) {
      params.push(f.valor.slice(0, -1) + '%');
      match = 'et.nombre LIKE ?';
    } else {
      params.push(f.valor);
      match = 'et.nombre = ?';
    }
    return `${neg ? 'NOT ' : ''}EXISTS (SELECT 1 FROM obra_etiqueta oe JOIN etiqueta et ON et.id = oe.etiqueta_id WHERE oe.obra_id = ${o}.id AND ${match})`;
  }

  // momento_canon (op tiene/no_tiene; valor destacado|cualquiera)
  if (campo === 'momento_canon') {
    const o = requireObra(ctx);
    const neg = f.op === 'no_tiene';
    if (f.op !== 'tiene' && f.op !== 'no_tiene') throw new Error(`momento_canon usa tiene/no_tiene`);
    const dest = f.valor === 'destacado' ? ' AND mc.destacado = 1' : '';
    return `${neg ? 'NOT ' : ''}EXISTS (SELECT 1 FROM momento_canon mc JOIN entrada me ON me.id = mc.entrada_id WHERE me.obra_id = ${o}.id${dest})`;
  }

  // obra_creador (op =/in; valor persona:<id>)
  if (campo === 'obra_creador') {
    const o = requireObra(ctx);
    const raw = Array.isArray(f.valor) ? f.valor : [f.valor];
    const ids = raw.map((v) => String(v).replace(/^persona:/, ''));
    ids.forEach((id) => params.push(id));
    return `EXISTS (SELECT 1 FROM obra_creador oc WHERE oc.obra_id = ${o}.id AND oc.persona_id IN (${ids.map(() => '?').join(', ')}))`;
  }

  // obra.<col>
  if (campo.startsWith('obra.')) {
    const col = campo.slice('obra.'.length);
    if (!OBRA_COLS.has(col)) throw new Error(`columna de obra no permitida: ${col}`);
    if (ctx.obra) return cmpSql(`${ctx.obra}.${col}`, f.op, f.valor, params, opts);
    if (ctx.entrada) return cmpSql(`(SELECT o2.${col} FROM obra o2 WHERE o2.id = ${ctx.entrada}.obra_id)`, f.op, f.valor, params, opts);
    throw new Error('obra.* requiere ámbito por-obra o por-entrada');
  }

  // agg.<field> (per-obra aggregate over Entradas)
  if (campo.startsWith('agg.')) {
    const field = campo.slice('agg.'.length);
    if (!AGG_FIELDS.has(field)) throw new Error(`agregado no permitido: ${field}`);
    const o = requireObra(ctx);
    return cmpSql(aggSql(field, o), f.op, f.valor, params, opts);
  }

  // entrada.<col>
  if (campo.startsWith('entrada.')) {
    const col = campo.slice('entrada.'.length);
    if (!ENTRADA_COLS.has(col)) throw new Error(`columna de entrada no permitida: ${col}`);
    if (ctx.entrada) return cmpSql(`${ctx.entrada}.${col}`, f.op, f.valor, params, opts);
    if (ctx.obra) {
      const inner = cmpSql(`e2.${col}`, f.op, f.valor, params, opts);
      return `EXISTS (SELECT 1 FROM entrada e2 WHERE e2.obra_id = ${ctx.obra}.id AND ${inner})`;
    }
    throw new Error('entrada.* requiere ámbito por-obra o por-entrada');
  }

  throw new Error(`Espacio de campo desconocido: ${campo}`);
}

// The count subquery a count_where compares (the "current value"). Reused by both the boolean
// (compileCountWhere) and the progress probe (compileMeasure) — one source of truth.
function countWhereScalar(f, params, opts) {
  const dondeGroup = { match: 'all', filtros: f.donde || [] };
  if (f.sobre === 'entrada') {
    return `(SELECT COUNT(*) FROM entrada cwe WHERE ${compileGroup(dondeGroup, { entrada: 'cwe' }, params, opts)})`;
  }
  if (f.sobre === 'obra') {
    return `(SELECT COUNT(*) FROM obra cwo WHERE ${compileGroup(dondeGroup, { obra: 'cwo' }, params, opts)})`;
  }
  if (f.sobre === 'mes') {
    // donde compares the per-month aggregate agg.num_entradas_mes (the month's entry count).
    // HAVING references the aggregate COUNT(*) directly (SQL-standard) rather than the SELECT
    // alias `n`: SQLite tolerates the alias, PostgreSQL does not — COUNT(*) is valid in BOTH.
    const having = (f.donde || [])
      .map((d) => {
        if (d.campo !== 'agg.num_entradas_mes') throw new Error(`count_where sobre mes solo admite agg.num_entradas_mes`);
        return cmpSql('COUNT(*)', d.op, d.valor, params, opts);
      })
      .join(' AND ') || '1';
    return `(SELECT COUNT(*) FROM (SELECT strftime('%Y-%m', fecha) m, COUNT(*) n FROM entrada WHERE fecha IS NOT NULL GROUP BY m HAVING ${having}))`;
  }
  throw new Error(`count_where 'sobre' no soportado: ${f.sobre}`);
}

function compileCountWhere(f, params, opts) {
  const comparar = f.comparar || {};
  return cmpSql(countWhereScalar(f, params, opts), comparar.op, comparar.valor, params, opts);
}

// The "current value" an `existe` measures: the max obras any single persona accumulates.
function existeScalar(f, params, opts) {
  if (f.sobre !== 'obra_creador') throw new Error(`existe 'sobre' no soportado: ${f.sobre}`);
  const groupBy = f.agrupar_por || 'persona_id';
  if (groupBy !== 'persona_id') throw new Error(`existe agrupar_por no soportado: ${groupBy}`);
  return `(SELECT COALESCE(MAX(c), 0) FROM (SELECT COUNT(DISTINCT obra_id) c FROM obra_creador GROUP BY persona_id) z)`;
}

function compileExiste(f, params, opts) {
  const c = f.comparar || {};
  const having = cmpSql('COUNT(DISTINCT obra_id)', c.op, c.valor, params, opts);
  if (f.sobre !== 'obra_creador') throw new Error(`existe 'sobre' no soportado: ${f.sobre}`);
  if ((f.agrupar_por || 'persona_id') !== 'persona_id') throw new Error(`existe agrupar_por no soportado`);
  return `EXISTS (SELECT 1 FROM obra_creador GROUP BY persona_id HAVING ${having})`;
}

function compileFiltro(f, ctx, params, opts) {
  if (f && Array.isArray(f.filtros)) return compileGroup(f, ctx, params, opts); // nested group
  if (f && f.op === 'count_where') return compileCountWhere(f, params, opts);
  if (f && f.op === 'existe') return compileExiste(f, params, opts);
  return compileLeaf(f, ctx, params, opts);
}

function compileGroup(group, ctx, params, opts) {
  const joiner = group.match === 'any' ? ' OR ' : ' AND ';
  const filtros = group.filtros || [];
  if (!filtros.length) return '1=1';
  return '(' + filtros.map((f) => compileFiltro(f, ctx, params, opts)).join(joiner) + ')';
}

/** Compile a collection regla_json to `SELECT DISTINCT o.id ...` (set of obra ids). */
export function compileCollectionRule(rule, opts = {}) {
  const o = { idiomaBase: 'es', ...opts };
  const params = [];
  const where = compileGroup(rule, { obra: 'o' }, params, o);

  let sql = `SELECT DISTINCT o.id FROM obra o WHERE ${where}`;

  // pin_excluir / pin_incluir override the rule (manual wins, like etiquetas).
  const excl = (rule.pin_excluir || []).filter(Boolean);
  if (excl.length) {
    sql += ` AND o.id NOT IN (${excl.map(() => '?').join(', ')})`;
    excl.forEach((id) => params.push(id));
  }
  const incl = (rule.pin_incluir || []).filter(Boolean);
  if (incl.length) {
    sql = `${sql} UNION SELECT id FROM obra WHERE id IN (${incl.map(() => '?').join(', ')})`;
    incl.forEach((id) => params.push(id));
  }
  return { sql, params };
}

/** Compile a logro/Wrapped condicion_json to a boolean: `SELECT (...) AS ok` -> 0/1. */
export function compileCondition(cond, opts = {}) {
  const o = { idiomaBase: 'es', ...opts };
  const params = [];
  const bool = compileGroup(cond, {}, params, o); // global scope (no obra row)
  return { sql: `SELECT (CASE WHEN ${bool} THEN 1 ELSE 0 END) AS ok`, params };
}

/**
 * Compile the measurable scalar(s) of a condicion_json, for PROGRESS toward an (often aspirational)
 * umbral — e.g. reconsumos 1/25. NOT a second way to decide unlocking (that stays the boolean above):
 * it reuses the SAME metric/count/existe SQL the boolean embeds, just exposes the bare value so the
 * caller can render "valor / umbral". Returns one probe per measurable leaf at the top level (nested
 * groups and non-numeric leaves are skipped). Each probe is `SELECT <scalar> AS v`. `combine` tells
 * the caller how to fold a compound: 'min' (match:all → weakest clause) or 'max' (match:any).
 */
export function compileMeasure(cond, opts = {}) {
  const o = { idiomaBase: 'es', ...opts };
  const measures = [];
  for (const f of cond.filtros || []) {
    if (!f || Array.isArray(f.filtros)) continue; // skip nested groups
    const params = [];
    if (typeof f.campo === 'string' && f.campo.startsWith('metrica:')) {
      const m = metricScalar(f.campo.slice('metrica:'.length), f.param);
      measures.push({ sql: `SELECT ${m.sql} AS v`, params: m.params, target: f.valor, op: f.op });
    } else if (f.op === 'count_where') {
      const scalar = countWhereScalar(f, params, o);
      const c = f.comparar || {};
      measures.push({ sql: `SELECT ${scalar} AS v`, params, target: c.valor, op: c.op });
    } else if (f.op === 'existe') {
      const scalar = existeScalar(f, params, o);
      const c = f.comparar || {};
      measures.push({ sql: `SELECT ${scalar} AS v`, params, target: c.valor, op: c.op });
    }
    // non-numeric leaves (obra.*/entrada.*/etiqueta in global scope) carry no progress value
  }
  return { measures, combine: cond.match === 'any' ? 'max' : 'min' };
}

/** Fold a measure value vs its umbral into a 0..1 ratio (progress). NULL → 0. For "menor que"
 *  umbrales (p. ej. MET_PCT_HABITO < 30) acercarse = bajar, así que el ratio se invierte. */
export function progressRatio(value, target, op) {
  if (value == null || target == null) return value != null && target == null ? 1 : 0;
  const v = Number(value);
  const t = Number(target);
  if (op === '>=' || op === '>') return t <= 0 ? 1 : Math.max(0, Math.min(1, v / t));
  if (op === '<=' || op === '<') return v <= t ? 1 : v <= 0 ? 0 : Math.max(0, Math.min(1, t / v));
  if (op === '=') return v === t ? 1 : 0;
  return null;
}

function requireObra(ctx) {
  if (!ctx.obra) throw new Error('este campo requiere ámbito por-obra (colección), no global');
  return ctx.obra;
}
