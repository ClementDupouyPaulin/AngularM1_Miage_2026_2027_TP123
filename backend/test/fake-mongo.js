import mongoose from "mongoose";

/*
 * Simulation minimale de MongoDB pour les tests : filtres, tri et pipelines
 * d'agrégation utilisés par l'application, évalués sur des objets en mémoire.
 * Un opérateur inconnu lève une erreur pour qu'un test ne passe pas par hasard.
 */

export const getPath = (doc, key) =>
  key.split(".").reduce((value, part) => (value == null ? undefined : value[part]), doc);

function equals(actual, expected) {
  if (expected === null) return actual === null || actual === undefined;
  if (Array.isArray(actual)) return actual.some((value) => equals(value, expected));
  return actual !== null && actual !== undefined && String(actual) === String(expected);
}

const isOperatorObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !(value instanceof mongoose.Types.ObjectId) &&
  !(value instanceof Date) &&
  !Array.isArray(value) &&
  Object.keys(value).length > 0 &&
  Object.keys(value).every((key) => key.startsWith("$"));

function matchesCondition(actual, condition) {
  if (!isOperatorObject(condition)) return equals(actual, condition);
  return Object.entries(condition).every(([operator, value]) => {
    switch (operator) {
      case "$in": return value.some((item) => equals(actual, item));
      case "$ne": return !equals(actual, value);
      case "$exists": return (actual !== undefined) === value;
      case "$gt": return actual > value;
      case "$regex": return new RegExp(value, condition.$options).test(actual);
      case "$options": return true;
      case "$elemMatch": return Array.isArray(actual) && actual.some((item) => matches(item, value));
      default: throw new Error(`Opérateur non simulé : ${operator}`);
    }
  });
}

export function matches(doc, filter) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === "$or") return condition.some((sub) => matches(doc, sub));
    if (key === "$and") return condition.every((sub) => matches(doc, sub));
    return matchesCondition(getPath(doc, key), condition);
  });
}

export const compareBy = (spec) => (a, b) => {
  for (const [key, direction] of Object.entries(spec)) {
    const left = getPath(a, key);
    const right = getPath(b, key);
    if (left < right) return -direction;
    if (left > right) return direction;
  }
  return 0;
};

/** Requête chaînable (select, sort, limit, lean) résolue sur un résultat fixe. */
export function fakeQuery(result) {
  let sortSpec = null;
  let limit = 0;
  return {
    select() { return this; },
    lean() { return this; },
    sort(spec) { sortSpec = spec; return this; },
    limit(value) { limit = value; return this; },
    then(resolve, reject) {
      let out = result;
      if (Array.isArray(out)) {
        out = [...out];
        if (sortSpec) out.sort(compareBy(sortSpec));
        if (limit) out = out.slice(0, limit);
      }
      return Promise.resolve(out).then(resolve, reject);
    },
  };
}

function evaluate(expression, doc) {
  if (typeof expression === "string" && expression.startsWith("$")) return getPath(doc, expression.slice(1));
  if (!isOperatorObject(expression)) return expression;
  const [[operator, args]] = Object.entries(expression);
  switch (operator) {
    case "$ifNull": return evaluate(args[0], doc) ?? evaluate(args[1], doc);
    case "$eq": return evaluate(args[0], doc) === evaluate(args[1], doc);
    case "$type": {
      const value = evaluate(args, doc);
      if (value === undefined) return "missing";
      return value === null ? "null" : typeof value;
    }
    default: throw new Error(`Expression non simulée : ${operator}`);
  }
}

function group(rows, spec) {
  const groups = new Map();
  for (const row of rows) {
    const id = evaluate(spec._id, row);
    const key = String(id);
    if (!groups.has(key)) {
      groups.set(key, { _id: id, ...Object.fromEntries(Object.keys(spec).filter((k) => k !== "_id").map((k) => [k, 0])) });
    }
    const target = groups.get(key);
    for (const [field, accumulator] of Object.entries(spec)) {
      if (field === "_id") continue;
      if (!("$sum" in accumulator)) throw new Error(`Accumulateur non simulé : ${field}`);
      target[field] += Number(evaluate(accumulator.$sum, row)) || 0;
    }
  }
  return [...groups.values()];
}

function project(rows, spec) {
  const excluded = Object.entries(spec).filter(([, value]) => value === 0).map(([key]) => key);
  if (excluded.length) {
    return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !excluded.includes(key))));
  }
  return rows.map((row) => Object.fromEntries(["_id", ...Object.keys(spec)].map((key) => [key, row[key]])));
}

/** Exécute un pipeline d'agrégation (y compris celui de mongoose-aggregate-paginate-v2). */
export function runPipeline(source, pipeline) {
  let rows = source.map((row) => ({ ...row }));
  for (const stage of pipeline) {
    const [[name, spec]] = Object.entries(stage);
    switch (name) {
      case "$match": rows = rows.filter((row) => matches(row, spec)); break;
      case "$sort": rows = [...rows].sort(compareBy(spec)); break;
      case "$skip": rows = rows.slice(spec); break;
      case "$limit": rows = rows.slice(0, spec); break;
      case "$count": rows = rows.length ? [{ [spec]: rows.length }] : []; break;
      case "$unwind": {
        const field = spec.slice(1);
        rows = rows.flatMap((row) => (row[field] ?? []).map((item) => ({ ...row, [field]: item })));
        break;
      }
      case "$group": rows = group(rows, spec); break;
      case "$addFields":
        rows = rows.map((row) => ({
          ...row,
          ...Object.fromEntries(Object.entries(spec).map(([key, value]) => [key, evaluate(value, row)])),
        }));
        break;
      case "$project": rows = project(rows, spec); break;
      case "$facet":
        rows = [Object.fromEntries(Object.entries(spec).map(([key, sub]) => [key, runPipeline(rows, sub)]))];
        break;
      default: throw new Error(`Étape non simulée : ${name}`);
    }
  }
  return rows;
}
