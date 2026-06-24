#!/usr/bin/env node
'use strict';
/**
 * First Read — stage 9: render.  *** M2 SKELETON ***
 *
 * Renders candidates.json into a real mobile-first index.html via
 * lib/render.renderSkeleton. The full three-layer renderer (+ degraded mode) lands
 * in Milestone 4; this proves the pipeline yields a publishable page end-to-end.
 */

const fs = require('node:fs');
const path = require('node:path');
const { renderSkeleton } = require('./lib/render');

const candidates = JSON.parse(fs.readFileSync(path.join(__dirname, 'candidates.json'), 'utf8'));
const html = renderSkeleton(candidates.candidates, { generatedAt: candidates.generatedAt });
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.error(`render (skeleton): index.html ← ${candidates.count} candidates (${html.length}b)`);
