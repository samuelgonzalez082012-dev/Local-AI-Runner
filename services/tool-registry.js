'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWriteFile } = require('./atomic-file');

const MAX_TOOLS = 300;
const MAX_AUDIT = 500;
const MAX_ARGUMENT_BYTES = 64 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ALLOWED_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value, label) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch (_) { throw new Error(label + ' must contain JSON-compatible values.'); }
  if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > MAX_ARGUMENT_BYTES) throw new Error(label + ' exceeds the 64 KB limit.');
  return JSON.parse(encoded);
}

function sanitizeSchema(schema, depth = 0) {
  if (depth > 12 || !isPlainObject(schema)) throw new Error('Tool parameter schema must be a valid JSON Schema object.');
  const result = {};
  let type = schema.type;
  if (Array.isArray(type)) {
    type = type.filter(item => ALLOWED_TYPES.has(item));
    if (!type.length || type.length !== schema.type.length) throw new Error('Tool schema contains an unsupported type.');
    result.type = [...new Set(type)];
  } else if (type !== undefined) {
    if (!ALLOWED_TYPES.has(type)) throw new Error('Tool schema contains an unsupported type.');
    result.type = type;
  }
  if (schema.description !== undefined) result.description = String(schema.description).slice(0, 500);
  if (schema.title !== undefined) result.title = String(schema.title).slice(0, 120);
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length > 100) throw new Error('Tool schema enum must contain at most 100 values.');
    result.enum = cloneJson(schema.enum, 'Tool schema enum');
  }
  for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
    if (schema[key] !== undefined) {
      const value = Number(schema[key]);
      if (!Number.isFinite(value) || (['minLength','maxLength','minItems','maxItems'].includes(key) && (!Number.isInteger(value) || value < 0))) throw new Error('Tool schema has an invalid ' + key + ' constraint.');
      result[key] = value;
    }
  }
  if (schema.additionalProperties !== undefined) {
    if (typeof schema.additionalProperties !== 'boolean') throw new Error('Tool schema additionalProperties must be a boolean.');
    result.additionalProperties = schema.additionalProperties;
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.length > 100 || schema.required.some(key => typeof key !== 'string' || !key || key.length > 128 || FORBIDDEN_KEYS.has(key))) throw new Error('Tool schema required must contain valid property names.');
    result.required = [...new Set(schema.required)];
  }
  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties) || Object.keys(schema.properties).length > 100) throw new Error('Tool schema properties must be an object with at most 100 keys.');
    result.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      if (!key || key.length > 128 || FORBIDDEN_KEYS.has(key)) throw new Error('Tool schema contains an unsafe property name.');
      result.properties[key] = sanitizeSchema(value, depth + 1);
    }
  }
  if (schema.items !== undefined) result.items = sanitizeSchema(schema.items, depth + 1);
  if (result.minimum !== undefined && result.maximum !== undefined && result.minimum > result.maximum) throw new Error('Tool schema minimum cannot exceed maximum.');
  if (result.minLength !== undefined && result.maxLength !== undefined && result.minLength > result.maxLength) throw new Error('Tool schema minLength cannot exceed maxLength.');
  if (result.minItems !== undefined && result.maxItems !== undefined && result.minItems > result.maxItems) throw new Error('Tool schema minItems cannot exceed maxItems.');
  if (result.type === 'object' || result.properties) result.type = result.type || 'object';
  return result;
}

function matchesType(value, type) {
  switch (type) {
    case 'object': return isPlainObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isSafeInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true;
  }
}

function validateValue(schema, value, label) {
  const types = Array.isArray(schema.type) ? schema.type : (schema.type ? [schema.type] : []);
  if (types.length && !types.some(type => matchesType(value, type))) throw new Error(label + ' must be ' + types.join(' or ') + '.');
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) throw new Error(label + ' must match one of the allowed values.');
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new Error(label + ' is shorter than the minimum length.');
    if (schema.maxLength !== undefined && value.length > schema.maxLength) throw new Error(label + ' exceeds the maximum length.');
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) throw new Error(label + ' is below the minimum value.');
    if (schema.maximum !== undefined && value > schema.maximum) throw new Error(label + ' exceeds the maximum value.');
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) throw new Error(label + ' must be greater than the exclusive minimum.');
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) throw new Error(label + ' must be less than the exclusive maximum.');
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(label + ' contains too few items.');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(label + ' contains too many items.');
    if (schema.items) value.forEach((item, index) => validateValue(schema.items, item, label + '[' + index + ']'));
  }
  if (isPlainObject(value)) {
    const properties = schema.properties || {};
    for (const required of schema.required || []) if (!Object.prototype.hasOwnProperty.call(value, required)) throw new Error(label + '.' + required + ' is required.');
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error(label + ' contains a forbidden property.');
      if (Object.prototype.hasOwnProperty.call(properties, key)) validateValue(properties[key], item, label + '.' + key);
      else if (schema.additionalProperties === false) throw new Error(label + '.' + key + ' is not an allowed parameter.');
      if (Object.keys(value).length > 100) throw new Error(label + ' contains too many parameters.');
    }
  }
}

function validateArguments(schema, args) {
  if (!isPlainObject(args)) throw new Error('Tool arguments must be a JSON object.');
  const safeArgs = cloneJson(args, 'Tool arguments');
  validateValue(schema, safeArgs, 'arguments');
  return safeArgs;
}

function normalizeDefinition(entry) {
  if (!isPlainObject(entry)) throw new Error('Tool registration entry must be an object.');
  const definition = isPlainObject(entry.definition) ? entry.definition : entry;
  const name = String(definition.name || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error('Tool name must contain 1–64 letters, numbers, underscores or hyphens.');
  const description = String(definition.description || '').trim().slice(0, 1000);
  const parameters = sanitizeSchema(definition.parameters || { type: 'object', properties: {} });
  if (parameters.type !== 'object') throw new Error('Tool parameters must use an object schema.');
  return {
    name,
    description,
    parameters,
    source: ['builtin', 'mcp'].includes(entry.source) ? entry.source : 'builtin',
    category: String(entry.category || 'general').slice(0, 60),
    approval: String(entry.approval || 'policy').slice(0, 60)
  };
}

function createToolRegistry({ app }) {
  const auditPath = path.join(app.getPath('userData'), 'tool-audit.json');
  let registry = new Map();
  let history = [];
  let writeQueue = Promise.resolve();

  async function load() {
    try {
      const stat = await fs.lstat(auditPath);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 512 * 1024) throw new Error('Tool audit log is not a supported file.');
      const parsed = JSON.parse(await fs.readFile(auditPath, 'utf8'));
      history = Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string').slice(-MAX_AUDIT) : [];
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Could not load tool audit history:', error.message);
      history = [];
    }
  }

  function register(entries) {
    if (!Array.isArray(entries) || entries.length > MAX_TOOLS) throw new Error('Tool registration must be an array containing at most ' + MAX_TOOLS + ' tools.');
    const next = new Map();
    const errors = [];
    for (const entry of entries) {
      try {
        const item = normalizeDefinition(entry);
        if (next.has(item.name)) throw new Error('Duplicate tool name: ' + item.name);
        next.set(item.name, item);
      } catch (error) {
        errors.push(String(error.message || error).slice(0, 240));
      }
    }
    registry = next;
    return { registered: registry.size, rejected: errors.length, errors: errors.slice(0, 20) };
  }

  function list() {
    return [...registry.values()].map(item => ({
      name: item.name, description: item.description, source: item.source,
      category: item.category, approval: item.approval
    }));
  }

  function validate(name, args) {
    const item = registry.get(String(name || ''));
    if (!item) throw new Error('Tool is not in the current registered tool list.');
    return validateArguments(item.parameters, args === undefined ? {} : args);
  }

  async function persist() {
    const snapshot = JSON.stringify(history.slice(-MAX_AUDIT), null, 2);
    writeQueue = writeQueue.then(async () => {
      await fs.mkdir(path.dirname(auditPath), { recursive: true });
      await atomicWriteFile(auditPath, snapshot, { mode: 0o600 });
    });
    return writeQueue;
  }

  async function record(entry) {
    if (!isPlainObject(entry)) throw new Error('Invalid tool audit entry.');
    const name = String(entry.name || '').slice(0, 64);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error('Invalid tool name in audit entry.');
    const statuses = ['completed', 'failed', 'blocked'];
    const status = statuses.includes(entry.status) ? entry.status : 'failed';
    const item = {
      id: crypto.randomUUID(),
      at: Date.now(),
      name,
      source: entry.source === 'mcp' ? 'mcp' : 'builtin',
      category: String(entry.category || 'general').slice(0, 60),
      status,
      durationMs: Number.isFinite(entry.durationMs) ? Math.max(0, Math.min(3_600_000, Math.round(entry.durationMs))) : null,
      error: String(entry.error || '').slice(0, 240)
    };
    history.push(item);
    history = history.slice(-MAX_AUDIT);
    await persist();
    return item;
  }

  function getAudit(limit = 100) {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
    return history.slice(-safeLimit).reverse();
  }

  return { load, register, list, validate, record, getAudit };
}

module.exports = { createToolRegistry, sanitizeSchema, validateArguments, normalizeDefinition };