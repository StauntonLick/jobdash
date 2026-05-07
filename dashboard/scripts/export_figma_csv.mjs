import fs from "node:fs";

const inputPath = "/Users/jonny/Coding Projects/JobDash/dashboard/src/design/tokens/jobdash.tokens.json";
const outputPath = "/Users/jonny/Coding Projects/JobDash/dashboard/src/design/tokens/jobdash.figma.token-importer.no-header.csv";

const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));

function getByPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc ? acc[key] : undefined), obj);
}

function resolveValue(value, seen = new Set()) {
  if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) {
    const ref = value.slice(1, -1);
    if (seen.has(ref)) {
      throw new Error(`Circular reference: ${ref}`);
    }
    seen.add(ref);

    const target = getByPath(data, ref);
    if (!target || target.$value === undefined) {
      throw new Error(`Missing reference: ${ref}`);
    }

    return resolveValue(target.$value, seen);
  }

  return value;
}

function csvEscape(value) {
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const rows = [];

function add(name, type, value, collection = "JobDash") {
  rows.push([collection, name, value, type]);
}

function walkColor(groupObj, prefix) {
  for (const [key, node] of Object.entries(groupObj)) {
    if (key.startsWith("$")) {
      continue;
    }

    if (node && typeof node === "object" && "$value" in node) {
      const resolved = resolveValue(node.$value);
      const colorValue = typeof resolved === "object" && resolved.hex ? resolved.hex : resolved;
      add(`color/${prefix}${key}`, "color", colorValue);
      continue;
    }

    if (node && typeof node === "object") {
      walkColor(node, `${prefix}${key}/`);
    }
  }
}

for (const groupName of ["primitive", "semantic", "status"]) {
  walkColor(data.color[groupName], `${groupName}/`);
}

for (const groupName of ["radius", "space", "size"]) {
  const group = data[groupName];
  for (const [key, node] of Object.entries(group)) {
    if (key.startsWith("$")) {
      continue;
    }
    const resolved = resolveValue(node.$value);
    const numericValue = typeof resolved === "object" && resolved.value !== undefined ? resolved.value : resolved;
    add(`${groupName}/${key}`, "number", numericValue);
  }
}

for (const sectionName of ["font-size", "font-weight", "line-height"]) {
  const section = data.typography[sectionName];
  for (const [key, node] of Object.entries(section)) {
    if (key.startsWith("$")) {
      continue;
    }
    const resolved = resolveValue(node.$value);
    const numericValue = typeof resolved === "object" && resolved.value !== undefined ? resolved.value : resolved;
    add(`typography/${sectionName}/${key}`, "number", numericValue);
  }
}

const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
fs.writeFileSync(outputPath, csv);

console.log(`Wrote ${outputPath} with ${rows.length - 1} variables.`);
