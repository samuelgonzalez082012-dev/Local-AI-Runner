'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { clampWidth, widthFromDrag, widthFromKey, maxDockWidth } = require('../dock-resize');

test('clampWidth rounds and constrains widths to the allowed range', () => {
  assert.equal(clampWidth(312.7, 220, 700), 313);
  assert.equal(clampWidth(100, 220, 700), 220);
  assert.equal(clampWidth(900, 220, 700), 700);
  assert.equal(clampWidth(Number.NaN, 220, 700), 220);
});

test('dragging the left edge left makes a right-side dock wider', () => {
  assert.equal(widthFromDrag(360, 500, 420, 'left', 260, 700), 440);
  assert.equal(widthFromDrag(360, 500, 560, 'left', 260, 700), 300);
});

test('dragging the right edge right makes a left-side dock wider', () => {
  assert.equal(widthFromDrag(360, 500, 420, 'right', 220, 700), 280);
  assert.equal(widthFromDrag(360, 500, 560, 'right', 220, 700), 420);
});

test('dragging clamps at both dock limits', () => {
  assert.equal(widthFromDrag(300, 100, -500, 'left', 260, 500), 500);
  assert.equal(widthFromDrag(300, 100, 500, 'right', 220, 420), 420);
});

test('keyboard arrows resize in the expected direction for each edge', () => {
  assert.equal(widthFromKey(360, 'ArrowLeft', 'left', 20, 260, 700), 380);
  assert.equal(widthFromKey(360, 'ArrowRight', 'left', 20, 260, 700), 340);
  assert.equal(widthFromKey(360, 'ArrowRight', 'right', 20, 220, 700), 380);
  assert.equal(widthFromKey(360, 'ArrowLeft', 'right', 20, 220, 700), 340);
  assert.equal(widthFromKey(360, 'Home', 'left', 20, 260, 700), 260);
  assert.equal(widthFromKey(360, 'End', 'right', 20, 220, 700), 700);
  assert.equal(widthFromKey(360, 'Enter', 'right', 20, 220, 700), null);
});

test('dock drag updates are frame-batched and observers do not restore stale saved widths', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'dock-resize.js'), 'utf8');
  assert.match(source, /requestAnimationFrame\(applyDragPosition\)/);
  assert.match(source, /if \(activeDrag\.pointerId !== null\) return;/);
  assert.doesNotMatch(source, /applyWidth\(id, preferredWidths\[id\], false\)/);
  assert.match(source, /attributeFilter: \['hidden'\]/);
});

test('dock width can consume all remaining window space', () => {
  assert.equal(maxDockWidth(1580, 0), 1568);
  assert.equal(maxDockWidth(1580, 420), 1148);
  assert.equal(maxDockWidth(920, 0, 12), 908);
});
