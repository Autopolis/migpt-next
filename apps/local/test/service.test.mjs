import assert from 'node:assert/strict';
import { renderPlist } from '../macos-service.mjs';
const xml = renderPlist('/opt/Node & Tools/node', '/Users/example/Library/Application Support/MiGPT');
assert.ok(xml.includes('Node &amp; Tools/node'));
assert.ok(xml.includes('Application Support/MiGPT/app.mjs'));
assert.ok(xml.includes('<integer>63</integer>'));
assert.ok(!xml.includes('OPENAI_API_KEY'));
assert.ok(!xml.includes('MI_PASSWORD'));
